/* ── claude-proxy — Cloudflare Worker ──────────────────────────────────────
   Rutas:
     OPTIONS *           → preflight CORS
     POST   /            → proxy a la API de Claude (comportamiento original)
     POST   /tareas      → crear tarea (requiere X-Admin-Key o ?admin_key=)
     GET    /tareas      → listar tareas + resumen ROI de la semana actual
     PATCH  /tareas/:id  → actualizar estado / resultado de una tarea

   Bindings:
     env.ANTHROPIC_API_KEY (secret) — API key del proxy de Claude
     env.ADMIN_KEY         (secret) — clave simple que protege POST /tareas
     env.DB                (D1)     — base de datos de tareas (wrangler.toml)

   Zona horaria: Colombia (UTC-5, sin horario de verano). "Hoy" y "semana
   actual" se calculan con ese offset para que una tarea no aparezca vencida
   a las 7pm de Bogotá solo porque en UTC ya es mañana. */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Key',
  'Access-Control-Max-Age': '86400',
};

const CATEGORIAS = ['recall_inactivos', 'no_shows', 'aceptacion_tratamiento', 'seguimiento_post', 'otro'];
const ASIGNADOS = ['dueno', 'recepcionista'];
const PRIORIDADES = ['alta', 'media', 'baja'];
const ESTADOS = ['pendiente', 'en_proceso', 'completada', 'descartada'];
const RESULTADOS = ['agendo_cita', 'no_respondio', 'no_aplicaba'];
const FUENTES = ['ia_semanal', 'manual'];

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

function ahoraBogota() {
  return new Date(Date.now() - 5 * 3600 * 1000);
}
function hoyBogota() {
  return ahoraBogota().toISOString().slice(0, 10);
}
function lunesSemanaActual() {
  const d = ahoraBogota();
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

/* La columna `pacientes` se guarda como TEXT (JSON). Al leer, la devolvemos
   como arreglo para que la API sea consistente; si está vacía o corrupta, null. */
function hydrateTarea(t) {
  if (t && typeof t.pacientes === 'string' && t.pacientes) {
    try { t.pacientes = JSON.parse(t.pacientes); } catch { t.pacientes = null; }
  }
  return t;
}

/* ── Proxy original hacia la API de Claude ── */
async function handleProxy(request, env) {
  const body = await request.text();
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body,
  });
  const text = await resp.text();
  return new Response(text, {
    status: resp.status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

/* ── POST /tareas ── */
async function crearTarea(request, env, url) {
  if (!env.ADMIN_KEY) return json({ error: 'ADMIN_KEY no configurada en el Worker' }, 500);
  const clave = request.headers.get('X-Admin-Key') || url.searchParams.get('admin_key');
  if (clave !== env.ADMIN_KEY) return json({ error: 'Clave de administración inválida' }, 401);

  let b;
  try { b = await request.json(); } catch { return json({ error: 'Body JSON inválido' }, 400); }

  for (const campo of ['practice_id', 'semana', 'titulo', 'categoria', 'asignado_a', 'prioridad']) {
    if (!b[campo] || typeof b[campo] !== 'string' || !b[campo].trim()) {
      return json({ error: `Campo requerido: ${campo}` }, 400);
    }
  }
  if (!CATEGORIAS.includes(b.categoria)) return json({ error: `categoria inválida (permitidas: ${CATEGORIAS.join(', ')})` }, 400);
  if (!ASIGNADOS.includes(b.asignado_a)) return json({ error: `asignado_a inválido (permitidos: ${ASIGNADOS.join(', ')})` }, 400);
  if (!PRIORIDADES.includes(b.prioridad)) return json({ error: `prioridad inválida (permitidas: ${PRIORIDADES.join(', ')})` }, 400);
  const fuente = b.fuente || 'manual';
  if (!FUENTES.includes(fuente)) return json({ error: `fuente inválida (permitidas: ${FUENTES.join(', ')})` }, 400);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(b.semana)) return json({ error: 'semana debe ser fecha ISO (lunes de la semana, ej. 2026-07-13)' }, 400);
  if (b.fecha_limite && !/^\d{4}-\d{2}-\d{2}$/.test(b.fecha_limite)) return json({ error: 'fecha_limite debe ser fecha ISO' }, 400);
  const valor = Number.isFinite(Number(b.valor_estimado_cop)) ? Math.round(Number(b.valor_estimado_cop)) : 0;

  let pacientesJson = null;
  if (b.pacientes !== undefined && b.pacientes !== null) {
    if (!Array.isArray(b.pacientes)) return json({ error: 'pacientes debe ser un arreglo' }, 400);
    if (b.pacientes.length > 100) return json({ error: 'demasiados pacientes en una tarea (máx 100)' }, 400);
    pacientesJson = JSON.stringify(b.pacientes);
    if (pacientesJson.length > 30000) return json({ error: 'la lista de pacientes es demasiado grande' }, 400);
  }

  try {
    const tarea = await env.DB.prepare(
      `INSERT INTO tareas (practice_id, semana, titulo, descripcion, categoria, asignado_a, prioridad, valor_estimado_cop, fecha_limite, fuente, pacientes)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11) RETURNING *`
    ).bind(
      b.practice_id.trim(), b.semana, b.titulo.trim(), b.descripcion?.trim() || null,
      b.categoria, b.asignado_a, b.prioridad, valor, b.fecha_limite || null, fuente, pacientesJson
    ).first();
    return json(hydrateTarea(tarea), 201);
  } catch (e) {
    console.error('D1 insert error:', e.message);
    return json({ error: 'Error interno al crear la tarea' }, 500);
  }
}

/* ── GET /tareas ── */
async function listarTareas(env, url) {
  const practiceId = url.searchParams.get('practice_id');
  if (!practiceId) return json({ error: 'practice_id es obligatorio' }, 400);
  const estado = url.searchParams.get('estado');
  const asignadoA = url.searchParams.get('asignado_a');
  if (estado && !ESTADOS.includes(estado)) return json({ error: `estado inválido (permitidos: ${ESTADOS.join(', ')})` }, 400);
  if (asignadoA && !ASIGNADOS.includes(asignadoA)) return json({ error: `asignado_a inválido (permitidos: ${ASIGNADOS.join(', ')})` }, 400);

  const hoy = hoyBogota();
  const semana = lunesSemanaActual();

  let sql = `SELECT * FROM tareas WHERE practice_id = ?1`;
  const binds = [practiceId];
  if (estado) { binds.push(estado); sql += ` AND estado = ?${binds.length}`; }
  if (asignadoA) { binds.push(asignadoA); sql += ` AND asignado_a = ?${binds.length}`; }
  binds.push(hoy);
  sql += `
    ORDER BY
      CASE WHEN fecha_limite IS NOT NULL AND fecha_limite < ?${binds.length}
                AND estado IN ('pendiente','en_proceso') THEN 0 ELSE 1 END,
      CASE prioridad WHEN 'alta' THEN 0 WHEN 'media' THEN 1 ELSE 2 END,
      creado_en DESC, id DESC`;

  try {
    const { results } = await env.DB.prepare(sql).bind(...binds).all();
    const r = await env.DB.prepare(
      `SELECT
         COUNT(*) AS total_semana,
         SUM(CASE WHEN estado = 'completada' THEN 1 ELSE 0 END) AS completadas_semana,
         SUM(CASE WHEN estado = 'completada' AND resultado = 'agendo_cita'
                  THEN COALESCE(valor_estimado_cop, 0) ELSE 0 END) AS valor_recuperado_cop,
         SUM(CASE WHEN fecha_limite IS NOT NULL AND fecha_limite < ?1
                  AND estado IN ('pendiente','en_proceso') THEN 1 ELSE 0 END) AS vencidas_count
       FROM tareas WHERE practice_id = ?2 AND semana = ?3`
    ).bind(hoy, practiceId, semana).first();
    return json({
      tareas: (results || []).map(hydrateTarea),
      resumen: {
        semana,
        total_semana: r?.total_semana || 0,
        completadas_semana: r?.completadas_semana || 0,
        valor_recuperado_cop: r?.valor_recuperado_cop || 0,
        vencidas_count: r?.vencidas_count || 0,
      },
    });
  } catch (e) {
    console.error('D1 select error:', e.message);
    return json({ error: 'Error interno al consultar las tareas' }, 500);
  }
}

/* ── PATCH /tareas/:id ── */
async function actualizarTarea(request, env, id) {
  if (!/^\d+$/.test(id)) return json({ error: 'id inválido' }, 400);
  let b;
  try { b = await request.json(); } catch { return json({ error: 'Body JSON inválido' }, 400); }

  if (b.estado && !ESTADOS.includes(b.estado)) return json({ error: `estado inválido (permitidos: ${ESTADOS.join(', ')})` }, 400);
  if (b.resultado && !RESULTADOS.includes(b.resultado)) return json({ error: `resultado inválido (permitidos: ${RESULTADOS.join(', ')})` }, 400);
  if (b.estado === 'completada') {
    if (!b.resultado) return json({ error: 'resultado es requerido al completar una tarea' }, 400);
    if (!b.completado_por || !String(b.completado_por).trim()) return json({ error: 'completado_por es requerido al completar una tarea' }, 400);
  }

  try {
    const existente = await env.DB.prepare(`SELECT * FROM tareas WHERE id = ?1`).bind(Number(id)).first();
    if (!existente) return json({ error: 'Tarea no encontrada' }, 404);

    const sets = [];
    const binds = [];
    if (b.estado) { binds.push(b.estado); sets.push(`estado = ?${binds.length}`); }
    if (b.resultado) { binds.push(b.resultado); sets.push(`resultado = ?${binds.length}`); }
    if (b.completado_por) { binds.push(String(b.completado_por).trim()); sets.push(`completado_por = ?${binds.length}`); }
    if (b.estado === 'completada') {
      binds.push(ahoraBogota().toISOString().replace('T', ' ').slice(0, 19));
      sets.push(`completado_en = ?${binds.length}`);
    }
    if (!sets.length) return json({ error: 'Nada que actualizar (campos permitidos: estado, resultado, completado_por)' }, 400);

    binds.push(Number(id));
    const tarea = await env.DB.prepare(
      `UPDATE tareas SET ${sets.join(', ')} WHERE id = ?${binds.length} RETURNING *`
    ).bind(...binds).first();
    return json(hydrateTarea(tarea));
  } catch (e) {
    console.error('D1 update error:', e.message);
    return json({ error: 'Error interno al actualizar la tarea' }, 500);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (path === '/tareas') {
      if (request.method === 'POST') return crearTarea(request, env, url);
      if (request.method === 'GET') return listarTareas(env, url);
      return json({ error: 'Método no permitido' }, 405);
    }

    const matchId = path.match(/^\/tareas\/(\d+)$/);
    if (matchId) {
      if (request.method === 'PATCH') return actualizarTarea(request, env, matchId[1]);
      return json({ error: 'Método no permitido' }, 405);
    }

    // Ruta original del proxy de Claude — no tocar.
    if (path === '/' && request.method === 'POST') {
      return handleProxy(request, env);
    }

    return json({ error: 'Ruta no encontrada' }, 404);
  },
};
