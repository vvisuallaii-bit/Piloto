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
const MODELO_IA = 'claude-sonnet-4-5';   // mismo modelo que usa el frontend (core.js)

/* ── Blindaje del proxy público (POST /) ──────────────────────────────────
   La URL del Worker es pública (el frontend la llama desde el navegador), así
   que el proxy es abusable: cualquiera podría gastar la API key de Anthropic.
   Estas 4 capas acotan el daño sin romper la app: allowlist de modelos, tope
   de max_tokens, chequeo de Origin y rate-limit por IP. */
const MODELOS_PERMITIDOS = new Set([
  'claude-sonnet-4-5',
  'claude-haiku-4-5',
  'claude-haiku-4-5-20251001',
]);
const MAX_TOKENS_TOPE = 4096;      // el frontend usa 4000; nadie puede pedir respuestas enormes
const PROXY_BODY_MAX = 60000;      // bytes; el prompt más grande (roster de pacientes) cabe de sobra
const RL_MAX_POR_MIN = 20;         // solicitudes por IP por minuto al proxy

/* Solo se acepta el proxy desde nuestros propios sitios. Frena el abuso desde
   el navegador de terceros (un curl puede falsear el Origin, pero para eso
   están el rate-limit y los topes por request). */
function originPermitido(origin) {
  if (!origin) return false;
  try {
    const h = new URL(origin).hostname;
    return (
      h === 'smile-dental-intelligence.pages.dev' ||
      h.endsWith('.smile-dental-intelligence.pages.dev') ||  // deploys por hash de CF Pages
      h === 'vvisuallaii-bit.github.io' ||
      h === 'localhost' || h === '127.0.0.1'
    );
  } catch { return false; }
}

/* Rate-limit por IP con ventana fija de 1 minuto sobre D1. Fail-open: si D1
   falla, no bloquea (mejor dejar pasar que tumbar la app). */
async function rateLimited(env, ip) {
  if (!ip) return false;
  const win = Math.floor(Date.now() / 60000);
  const bucket = `${ip}:${win}`;
  try {
    const row = await env.DB.prepare(
      `INSERT INTO rate_limit (bucket, win, count) VALUES (?1, ?2, 1)
       ON CONFLICT(bucket) DO UPDATE SET count = count + 1 RETURNING count`
    ).bind(bucket, win).first();
    if (Math.random() < 0.05) {  // limpieza probabilística de ventanas viejas
      await env.DB.prepare(`DELETE FROM rate_limit WHERE win < ?1`).bind(win - 2).run().catch(() => {});
    }
    return (row?.count || 0) > RL_MAX_POR_MIN;
  } catch {
    return false;
  }
}

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

/* ── Proxy hacia la API de Claude — con blindaje (ver constantes arriba) ── */
async function handleProxy(request, env) {
  // 1. Solo desde nuestros orígenes.
  const origin = request.headers.get('Origin');
  if (!originPermitido(origin)) return json({ error: 'Origen no autorizado' }, 403);

  // 2. Rate-limit por IP.
  const ip = request.headers.get('CF-Connecting-IP') || '';
  if (await rateLimited(env, ip)) return json({ error: 'Demasiadas solicitudes. Intenta de nuevo en un minuto.' }, 429);

  // 3. Tamaño del cuerpo.
  const body = await request.text();
  if (body.length > PROXY_BODY_MAX) return json({ error: 'Solicitud demasiado grande' }, 413);

  // 4. Modelo permitido + tope de max_tokens (evita respuestas caras/enormes).
  let parsed;
  try { parsed = JSON.parse(body); } catch { return json({ error: 'Body JSON inválido' }, 400); }
  if (!parsed || !MODELOS_PERMITIDOS.has(parsed.model)) {
    return json({ error: 'Modelo no permitido' }, 400);
  }
  if (typeof parsed.max_tokens === 'number' && parsed.max_tokens > MAX_TOKENS_TOPE) {
    parsed.max_tokens = MAX_TOKENS_TOPE;  // recorta en vez de rechazar
  }

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(parsed),
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

/* ── GET /tareas ── acepta practice_id (una sede, como siempre) o network_id
   (agrega todas las sedes de la red). Sin filtro → 400 (comportamiento actual). */
async function listarTareas(env, url) {
  const practiceId = url.searchParams.get('practice_id');
  const networkId = url.searchParams.get('network_id');
  const estado = url.searchParams.get('estado');
  const asignadoA = url.searchParams.get('asignado_a');
  if (estado && !ESTADOS.includes(estado)) return json({ error: `estado inválido (permitidos: ${ESTADOS.join(', ')})` }, 400);
  if (asignadoA && !ASIGNADOS.includes(asignadoA)) return json({ error: `asignado_a inválido (permitidos: ${ASIGNADOS.join(', ')})` }, 400);

  // Resolver el conjunto de sedes: una (practice_id) o todas las de la red.
  let practiceIds;
  if (practiceId) {
    practiceIds = [practiceId];
  } else if (networkId) {
    const { results: ps } = await env.DB.prepare(`SELECT practice_id FROM practices WHERE network_id = ?1`).bind(networkId).all();
    practiceIds = (ps || []).map(p => p.practice_id);
    if (!practiceIds.length) return json({ error: `Red sin sedes o inexistente: ${networkId}` }, 404);
  } else {
    return json({ error: 'practice_id o network_id es obligatorio' }, 400);
  }

  const hoy = hoyBogota();
  const semana = lunesSemanaActual();
  const inList = practiceIds.map((_, i) => `?${i + 1}`).join(',');

  let sql = `SELECT * FROM tareas WHERE practice_id IN (${inList})`;
  const binds = [...practiceIds];
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
    // Resumen de la semana (agrega sobre el mismo conjunto de sedes).
    const rIn = practiceIds.map((_, i) => `?${i + 2}`).join(',');    // ?1 = hoy
    const r = await env.DB.prepare(
      `SELECT
         COUNT(*) AS total_semana,
         SUM(CASE WHEN estado = 'completada' THEN 1 ELSE 0 END) AS completadas_semana,
         SUM(CASE WHEN estado = 'completada' AND resultado = 'agendo_cita'
                  THEN COALESCE(valor_estimado_cop, 0) ELSE 0 END) AS valor_esperado_cop,
         SUM(CASE WHEN estado = 'completada' AND resultado = 'agendo_cita'
                  THEN COALESCE(valor_real_cop, valor_estimado_cop, 0) ELSE 0 END) AS valor_real_cop,
         SUM(CASE WHEN fecha_limite IS NOT NULL AND fecha_limite < ?1
                  AND estado IN ('pendiente','en_proceso') THEN 1 ELSE 0 END) AS vencidas_count
       FROM tareas WHERE practice_id IN (${rIn}) AND semana = ?${practiceIds.length + 2}`
    ).bind(hoy, ...practiceIds, semana).first();
    // Nota: este resumen es a nivel tarea (rápido, del servidor). El cliente lo
    // recalcula con precisión por paciente. valor_recuperado_cop se conserva
    // como alias del esperado por compatibilidad con clientes viejos.
    const esperado = r?.valor_esperado_cop || 0;
    return json({
      tareas: (results || []).map(hydrateTarea),
      resumen: {
        semana,
        total_semana: r?.total_semana || 0,
        completadas_semana: r?.completadas_semana || 0,
        valor_esperado_cop: esperado,
        valor_real_cop: r?.valor_real_cop || 0,
        valor_recuperado_cop: esperado,
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
    if (b.pacientes !== undefined) {
      if (!Array.isArray(b.pacientes)) return json({ error: 'pacientes debe ser un arreglo' }, 400);
      const pj = JSON.stringify(b.pacientes);
      if (pj.length > 30000) return json({ error: 'la lista de pacientes es demasiado grande' }, 400);
      binds.push(pj); sets.push(`pacientes = ?${binds.length}`);
    }
    if (b.valor_real_cop !== undefined) {
      // Monto real recuperado por la tarea (null lo limpia). Solo tiene sentido
      // en tareas sin pacientes; con pacientes el real va por paciente en el JSON.
      const vr = b.valor_real_cop === null ? null : Number(b.valor_real_cop);
      if (vr !== null && !Number.isFinite(vr)) return json({ error: 'valor_real_cop debe ser un número o null' }, 400);
      binds.push(vr === null ? null : Math.max(0, Math.round(vr)));
      sets.push(`valor_real_cop = ?${binds.length}`);
    }
    if (!sets.length) return json({ error: 'Nada que actualizar (campos permitidos: estado, resultado, completado_por, pacientes, valor_real_cop)' }, 400);

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

/* ══════════════════════════════════════════════════════════════════════════
   GENERACIÓN AUTOMÁTICA DE TAREAS (Paso 2 — cron sin navegador)
   Replica en el Worker lo que hacía el navegador: arma el resumen de métricas
   (computeMetrics), el roster de pacientes y el perfil desde D1, le pide a
   Claude 3-5 tareas vía TOOL USE (salida estructurada), enriquece los pacientes
   por ID y las inserta con fuente='ia_semanal'. Anti-duplicados por semana.
   ══════════════════════════════════════════════════════════════════════════ */

/* Port de metrics.js::computeMetrics — agrega sobre las filas mensuales. */
function computeMetrics(data) {
  const sum = k => data.reduce((s, r) => s + (Number(r[k]) || 0), 0);
  const months = data.length || 1;
  const totalCollections = sum('collections');
  const totalProduction = sum('gross_production');
  const totalPlansPresented = sum('treatment_plans_presented');
  const totalScheduled = sum('appointments_scheduled');
  const totalNewPat = sum('new_patients');
  return {
    months,
    totalCollections, totalProduction,
    totalNetIncome: sum('net_income'),
    totalOverhead: sum('overhead_costs'),
    totalNewPat,
    totalCompleted: sum('appointments_completed'),
    totalScheduled,
    totalNoShows: sum('no_shows'),
    totalPlansPresented,
    totalPlansAccepted: sum('treatment_plans_accepted'),
    hygieneRevenue: sum('hygiene_revenue'),
    restorativeRevenue: sum('restorative_revenue'),
    cosmeticRevenue: sum('cosmetic_revenue'),
    orthoRevenue: sum('orthodontic_revenue'),
    activePatients: data.length ? Number(data[data.length - 1].active_patients) || 0 : 0,
    overheadRate: totalCollections ? sum('overhead_costs') / totalCollections * 100 : 0,
    acceptanceRate: totalPlansPresented ? sum('treatment_plans_accepted') / totalPlansPresented * 100 : 0,
    noShowRate: totalScheduled ? sum('no_shows') / totalScheduled * 100 : 0,
    avgNewPatPerMonth: totalNewPat / months,
  };
}

// Formateo local (el runtime de Workers no trae locale es-CO fiable para Intl).
const MESES_ES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
function mesLargo(month) {
  const [y, m] = String(month).split('-').map(Number);
  return (MESES_ES[m - 1] || month) + ' de ' + y;
}
function copFmt(v) {
  const num = Math.round(Number(v) || 0);
  const s = Math.abs(num).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return '$' + (num < 0 ? '-' : '') + s;
}

/* Port de tareas-ia.js::tiaBuildSummary. `rows` viene ordenado por month ASC. */
function construirResumen(nombre, rows) {
  const m = computeMetrics(rows);
  const overhead = Math.round(m.overheadRate), acc = Math.round(m.acceptanceRate), ns = Math.round(m.noShowRate);
  const period = rows.length ? `${mesLargo(rows[0].month)} – ${mesLargo(rows[rows.length - 1].month)}` : 'desconocido';
  return `Clínica: ${nombre}
Período: ${period} (${rows.length} meses)
Producción bruta: ${copFmt(m.totalProduction)} COP
Recaudación: ${copFmt(m.totalCollections)} COP (brecha producida y sin cobrar: ${copFmt(m.totalProduction - m.totalCollections)})
Ingreso neto: ${copFmt(m.totalNetIncome)} COP
Tasa de gastos: ${overhead}% (meta <65%)
Pacientes nuevos: ${m.totalNewPat} (~${rows.length ? Math.round(m.avgNewPatPerMonth) : 0}/mes) · activos: ${m.activePatients}
Citas: agendadas ${m.totalScheduled}, completadas ${m.totalCompleted}, inasistencias ${m.totalNoShows}
Ausentismo: ${ns}% (meta <12%)
Planes de tratamiento: presentados ${m.totalPlansPresented}, aceptados ${m.totalPlansAccepted}, aceptación ${acc}% (meta >65%)
Ingresos por línea: higiene ${copFmt(m.hygieneRevenue)}, restaurativa ${copFmt(m.restorativeRevenue)}, estética ${copFmt(m.cosmeticRevenue)}, ortodoncia ${copFmt(m.orthoRevenue)}`;
}

/* Port de tareas-ia.js::tiaPacientesRoster — excluye pacientes al día. */
function rosterPacientes(pacientes) {
  const acc = (pacientes || []).filter(p => p.motivo && p.motivo !== 'al_dia');
  if (!acc.length) return null;
  return acc.map(p => `${p.pid} | ${p.nombre} | motivo:${p.motivo} | última cita:${p.ultima_consulta || '?'} | qué pasó:${p.que_paso || ''} | próximo paso sugerido:${p.proximos_pasos || ''} | valor pendiente:${copFmt(p.valor_pendiente_cop || 0)}`).join('\n');
}

/* Port de tareas-ia.js::tiaProfileText — `perfil` es objeto JSON o null. */
function perfilTexto(perfil) {
  if (!perfil) return '(sin perfil configurado)';
  const parts = [];
  if (perfil.location) parts.push('Ubicación: ' + perfil.location);
  if (perfil.chairs) parts.push('Consultorios: ' + perfil.chairs);
  if (perfil.doctors) parts.push('Odontólogos: ' + perfil.doctors);
  if (perfil.insurance && perfil.insurance.length) parts.push('Pagadores: ' + perfil.insurance.join(', '));
  if (perfil.challenge && perfil.challenge.length) parts.push('Retos declarados: ' + perfil.challenge.join(', '));
  if (perfil.goal) parts.push('Meta de ingresos: ' + perfil.goal);
  if (perfil.notes) parts.push('Notas: ' + perfil.notes);
  return parts.length ? parts.join('\n') : '(perfil mínimo)';
}

/* Herramienta (tool use) — idéntica al schema del frontend. */
function toolProponerTareas() {
  return {
    name: 'proponer_tareas',
    description: 'Registra las tareas operativas propuestas para la semana de la clínica dental.',
    input_schema: {
      type: 'object',
      properties: {
        tareas: {
          type: 'array',
          description: 'Entre 3 y 5 acciones concretas para ESTA semana.',
          items: {
            type: 'object',
            properties: {
              titulo: { type: 'string', description: 'Acción concreta y ejecutable, empieza con un verbo. Máx ~90 caracteres.' },
              descripcion: { type: 'string', description: '1-2 frases con el cómo o el detalle práctico.' },
              categoria: { type: 'string', enum: ['recall_inactivos', 'no_shows', 'aceptacion_tratamiento', 'seguimiento_post', 'otro'] },
              asignado_a: { type: 'string', enum: ['dueno', 'recepcionista'], description: 'recepcionista para tareas operativas (llamadas, confirmaciones, recall, cobro); dueno para decisiones estratégicas o revisión de casos de alto valor.' },
              prioridad: { type: 'string', enum: ['alta', 'media', 'baja'] },
              valor_estimado_cop: { type: 'integer', description: 'Valor potencial en COP que se recupera si la acción se concreta. Realista según los números dados. 0 si no aplica.' },
              justificacion: { type: 'string', description: 'Una frase: por qué esta acción, citando un número real de los datos.' },
              pacientes: { type: 'array', description: 'Pacientes concretos de la LISTA DE PACIENTES provista que corresponden a esta tarea. Usa solo IDs de esa lista. Déjalo vacío si la tarea no es de contactar pacientes puntuales.', items: { type: 'object', properties: { id: { type: 'string', description: 'ID EXACTO de la lista de pacientes (ej. P003). No inventes IDs.' }, accion: { type: 'string', description: 'Qué hacer específicamente con ESTE paciente.' } }, required: ['id', 'accion'] } }
            },
            required: ['titulo', 'descripcion', 'categoria', 'asignado_a', 'prioridad', 'valor_estimado_cop', 'justificacion']
          }
        }
      },
      required: ['tareas']
    }
  };
}

/* Port de tareas-ia.js::prompt. */
function construirPrompt(nombre, rows, pacientes, perfil) {
  const roster = rosterPacientes(pacientes);
  return `Eres un consultor de operaciones para clínicas dentales colombianas. Con base en los datos, propón las 3 a 5 acciones operativas MÁS IMPORTANTES y accionables para ESTA SEMANA. Prioriza lo que mueve ingresos rápido sin atender pacientes nuevos: cerrar la brecha de cobro, recuperar pacientes inactivos, reducir ausentismo y subir la aceptación de tratamientos.

DATOS DE LA CLÍNICA:
${construirResumen(nombre, rows)}

PERFIL DE LA CLÍNICA:
${perfilTexto(perfil)}
${roster ? `
LISTA DE PACIENTES (elige de aquí los que van en cada tarea de contacto, usando su ID exacto):
${roster}
` : ''}
REFERENCIAS DEL SECTOR (Colombia): gastos operativos <65%, aceptación de tratamientos >65%, ausentismo <12%, pacientes nuevos 20-25+/mes.

Reglas:
- Cada tarea debe ser ejecutable por UNA persona esta semana, no un objetivo vago.
- Asigna a 'recepcionista' las llamadas, confirmaciones, recall y gestión de cobro; a 'dueno' las decisiones estratégicas o la revisión de casos de alto valor.
- Estima el valor en COP de forma realista con base en los números dados; no inventes cifras desproporcionadas.${roster ? `
- Para las tareas de contacto (recall, no-shows, seguimiento, aceptación), ADJUNTA en 'pacientes' los pacientes concretos de la LISTA DE PACIENTES que correspondan, cada uno con una acción específica a su caso. Usa solo IDs de la lista; agrupa por motivo coherente con la categoría de la tarea.` : ''}
- Redacta en español, tono colombiano directo.

Llama a la herramienta proponer_tareas con las acciones.`;
}

/* Genera (y por defecto inserta) las tareas de la semana para UNA clínica.
   opts: { dryRun } no inserta; { force } ignora el anti-duplicados. */
async function generarParaPractica(env, practice, opts = {}) {
  const practice_id = practice.practice_id;
  const semana = lunesSemanaActual();

  if (!opts.force) {
    const dup = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM tareas WHERE practice_id = ?1 AND semana = ?2 AND fuente = 'ia_semanal'`
    ).bind(practice_id, semana).first();
    if (dup && dup.n > 0) {
      return { practice_id, semana, skipped: true, motivo: `ya existen ${dup.n} tareas ia_semanal para esta semana` };
    }
  }

  const { results: rows } = await env.DB.prepare(
    `SELECT * FROM metricas_mensuales WHERE practice_id = ?1 ORDER BY month ASC`
  ).bind(practice_id).all();
  if (!rows || !rows.length) return { practice_id, semana, error: 'sin métricas en D1 para esta clínica' };

  const { results: pacientes } = await env.DB.prepare(
    `SELECT * FROM pacientes WHERE practice_id = ?1`
  ).bind(practice_id).all();

  let perfil = null;
  try { perfil = practice.perfil ? JSON.parse(practice.perfil) : null; } catch { perfil = null; }

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: MODELO_IA,
      max_tokens: 4000,
      tools: [toolProponerTareas()],
      tool_choice: { type: 'tool', name: 'proponer_tareas' },
      messages: [{ role: 'user', content: construirPrompt(practice.nombre || practice_id, rows, pacientes || [], perfil) }],
    }),
  });
  const data = await resp.json();
  if (!resp.ok || data.error) throw new Error(data.error?.message || `API de IA HTTP ${resp.status}`);
  const block = (data.content || []).find(b => b.type === 'tool_use' && b.name === 'proponer_tareas');
  if (!block || !block.input || !Array.isArray(block.input.tareas)) {
    if (data.stop_reason === 'max_tokens') throw new Error('la respuesta de la IA se truncó (max_tokens)');
    throw new Error('la IA no devolvió tareas en el formato esperado');
  }

  // Enriquecer los pacientes elegidos por ID con los datos reales del roster.
  const byId = new Map((pacientes || []).map(p => [p.pid, p]));
  const propuestas = block.input.tareas.slice(0, 5).map(t => {
    const _pacientes = (Array.isArray(t.pacientes) ? t.pacientes : []).map(x => {
      const p = byId.get(x.id);
      if (!p) return null;
      return { id: p.pid, nombre: p.nombre, telefono: p.telefono, ultima_consulta: p.ultima_consulta, que_paso: p.que_paso, accion: x.accion || p.proximos_pasos || '', valor_pendiente_cop: Number(p.valor_pendiente_cop) || 0 };
    }).filter(Boolean);
    return { ...t, _pacientes };
  });

  if (opts.dryRun) return { practice_id, semana, dry_run: true, propuestas };

  const ids = [];
  for (const t of propuestas) {
    const titulo = String(t.titulo || '').trim().slice(0, 200);
    if (!titulo) continue;
    const categoria = CATEGORIAS.includes(t.categoria) ? t.categoria : 'otro';
    const asignado_a = ASIGNADOS.includes(t.asignado_a) ? t.asignado_a : 'recepcionista';
    const prioridad = PRIORIDADES.includes(t.prioridad) ? t.prioridad : 'media';
    const valor = Number.isFinite(Number(t.valor_estimado_cop)) ? Math.round(Number(t.valor_estimado_cop)) : 0;
    const descripcion = t.descripcion ? String(t.descripcion).trim() : null;
    const pacientesJson = t._pacientes && t._pacientes.length ? JSON.stringify(t._pacientes) : null;
    const row = await env.DB.prepare(
      `INSERT INTO tareas (practice_id, semana, titulo, descripcion, categoria, asignado_a, prioridad, valor_estimado_cop, fuente, pacientes)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'ia_semanal', ?9) RETURNING id`
    ).bind(practice_id, semana, titulo, descripcion, categoria, asignado_a, prioridad, valor, pacientesJson).first();
    ids.push(row?.id);
  }
  return { practice_id, semana, created: ids.length, ids };
}

/* ── POST /tareas/generar ── disparo manual del cron (protegido con ADMIN_KEY).
   ?practice_id= una clínica (por defecto: todas las activas)
   ?dry_run=1   devuelve las propuestas sin insertarlas
   ?force=1     ignora el anti-duplicados de la semana */
async function generarEndpoint(request, env, url) {
  if (!env.ADMIN_KEY) return json({ error: 'ADMIN_KEY no configurada en el Worker' }, 500);
  const clave = request.headers.get('X-Admin-Key') || url.searchParams.get('admin_key');
  if (clave !== env.ADMIN_KEY) return json({ error: 'Clave de administración inválida' }, 401);

  const practiceId = url.searchParams.get('practice_id');
  const dryRun = url.searchParams.get('dry_run') === '1';
  const force = url.searchParams.get('force') === '1';

  let practices;
  if (practiceId) {
    const p = await env.DB.prepare(`SELECT * FROM practices WHERE practice_id = ?1`).bind(practiceId).first();
    if (!p) return json({ error: `Clínica no encontrada: ${practiceId}` }, 404);
    practices = [p];
  } else {
    const { results } = await env.DB.prepare(`SELECT * FROM practices WHERE activo = 1`).all();
    practices = results || [];
  }

  const resultados = [];
  for (const practice of practices) {
    try { resultados.push(await generarParaPractica(env, practice, { dryRun, force })); }
    catch (e) { resultados.push({ practice_id: practice.practice_id, error: e.message }); }
  }
  return json({ resultados });
}

/* ══════════════════════════════════════════════════════════════════════════
   MODELO MULTI-SEDE (Fase 3B) — networks → practices → doctors + agregados.
   Retro-compatible: una sede única es una red de 1 sede. Mismos guardrails de
   validación que la API de tareas (X-Admin-Key, campos requeridos, slugs).
   ══════════════════════════════════════════════════════════════════════════ */
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function requireAdmin(request, url, env) {
  if (!env.ADMIN_KEY) return json({ error: 'ADMIN_KEY no configurada en el Worker' }, 500);
  const clave = request.headers.get('X-Admin-Key') || url.searchParams.get('admin_key');
  if (clave !== env.ADMIN_KEY) return json({ error: 'Clave de administración inválida' }, 401);
  return null;
}

/* ── POST /networks ── crea una red (grupo/dueño). */
async function crearNetwork(request, env, url) {
  const err = requireAdmin(request, url, env); if (err) return err;
  let b; try { b = await request.json(); } catch { return json({ error: 'Body JSON inválido' }, 400); }
  const id = String(b.network_id || '').trim();
  if (!SLUG_RE.test(id)) return json({ error: 'network_id inválido (slug: minúsculas, números y guiones)' }, 400);
  if (!b.nombre || !String(b.nombre).trim()) return json({ error: 'Campo requerido: nombre' }, 400);
  try {
    const row = await env.DB.prepare(`INSERT INTO networks (network_id, nombre, plan) VALUES (?1, ?2, ?3) RETURNING *`)
      .bind(id, String(b.nombre).trim(), b.plan ? String(b.plan).trim() : null).first();
    return json(row, 201);
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return json({ error: 'La red ya existe' }, 409);
    console.error('D1 network insert:', e.message); return json({ error: 'Error interno al crear la red' }, 500);
  }
}

/* ── POST /practices ── crea una sede dentro de una red. */
async function crearPractice(request, env, url) {
  const err = requireAdmin(request, url, env); if (err) return err;
  let b; try { b = await request.json(); } catch { return json({ error: 'Body JSON inválido' }, 400); }
  const id = String(b.practice_id || '').trim(), nid = String(b.network_id || '').trim();
  if (!SLUG_RE.test(id)) return json({ error: 'practice_id inválido (slug)' }, 400);
  if (!SLUG_RE.test(nid)) return json({ error: 'network_id inválido (slug)' }, 400);
  if (!b.nombre || !String(b.nombre).trim()) return json({ error: 'Campo requerido: nombre' }, 400);
  const net = await env.DB.prepare(`SELECT 1 FROM networks WHERE network_id = ?1`).bind(nid).first();
  if (!net) return json({ error: `Red inexistente: ${nid}` }, 400);
  try {
    const row = await env.DB.prepare(
      `INSERT INTO practices (practice_id, network_id, nombre, ciudad, direccion, perfil, activo)
       VALUES (?1, ?2, ?3, ?4, ?5, NULL, 1) RETURNING *`
    ).bind(id, nid, String(b.nombre).trim(), b.ciudad ? String(b.ciudad).trim() : null, b.direccion ? String(b.direccion).trim() : null).first();
    return json(row, 201);
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return json({ error: 'La sede ya existe' }, 409);
    console.error('D1 practice insert:', e.message); return json({ error: 'Error interno al crear la sede' }, 500);
  }
}

/* ── POST /doctors ── crea un odontólogo en una sede. */
async function crearDoctor(request, env, url) {
  const err = requireAdmin(request, url, env); if (err) return err;
  let b; try { b = await request.json(); } catch { return json({ error: 'Body JSON inválido' }, 400); }
  const pid = String(b.practice_id || '').trim();
  if (!SLUG_RE.test(pid)) return json({ error: 'practice_id inválido (slug)' }, 400);
  if (!b.nombre || !String(b.nombre).trim()) return json({ error: 'Campo requerido: nombre' }, 400);
  if (b.fecha_ingreso && !/^\d{4}-\d{2}-\d{2}$/.test(b.fecha_ingreso)) return json({ error: 'fecha_ingreso debe ser fecha ISO' }, 400);
  const pr = await env.DB.prepare(`SELECT 1 FROM practices WHERE practice_id = ?1`).bind(pid).first();
  if (!pr) return json({ error: `Sede inexistente: ${pid}` }, 400);
  try {
    const row = await env.DB.prepare(`INSERT INTO doctors (practice_id, nombre, fecha_ingreso) VALUES (?1, ?2, ?3) RETURNING *`)
      .bind(pid, String(b.nombre).trim(), b.fecha_ingreso || null).first();
    return json(row, 201);
  } catch (e) {
    console.error('D1 doctor insert:', e.message); return json({ error: 'Error interno al crear el odontólogo' }, 500);
  }
}

/* ── GET /practices?network_id= ── lista las sedes de una red (para el selector). */
async function listarPractices(env, url) {
  const nid = url.searchParams.get('network_id');
  if (!nid) return json({ error: 'network_id es obligatorio' }, 400);
  const net = await env.DB.prepare(`SELECT * FROM networks WHERE network_id = ?1`).bind(nid).first();
  if (!net) return json({ error: `Red no encontrada: ${nid}` }, 404);
  const { results } = await env.DB.prepare(
    `SELECT p.practice_id, p.network_id, p.nombre, p.ciudad, p.direccion, p.activo,
            (SELECT COUNT(1) FROM doctors d WHERE d.practice_id = p.practice_id) AS doctores
     FROM practices p WHERE p.network_id = ?1 ORDER BY p.nombre`
  ).bind(nid).all();
  return json({ network_id: nid, nombre: net.nombre, plan: net.plan, sedes: results || [] });
}

/* ── GET /red/metricas?network_id= ── métricas agregadas de la red + por sede.
   Reusa computeMetrics por sede y agrega con promedio ponderado por volumen. */
async function metricasRed(env, url) {
  const nid = url.searchParams.get('network_id');
  if (!nid) return json({ error: 'network_id es obligatorio' }, 400);
  const net = await env.DB.prepare(`SELECT * FROM networks WHERE network_id = ?1`).bind(nid).first();
  if (!net) return json({ error: `Red no encontrada: ${nid}` }, 404);
  const { results: practices } = await env.DB.prepare(`SELECT * FROM practices WHERE network_id = ?1 ORDER BY nombre`).bind(nid).all();
  if (!practices || !practices.length) return json({ error: 'La red no tiene sedes' }, 404);

  const acc = { col: 0, prod: 0, net: 0, ov: 0, newp: 0, sched: 0, comp: 0, noshow: 0, pres: 0, acc: 0, active: 0, meses: 0 };
  const round1 = n => Math.round(n * 10) / 10;
  const sedes = [];
  for (const p of practices) {
    const { results: rows } = await env.DB.prepare(`SELECT * FROM metricas_mensuales WHERE practice_id = ?1 ORDER BY month ASC`).bind(p.practice_id).all();
    const m = computeMetrics(rows || []);
    sedes.push({
      practice_id: p.practice_id, nombre: p.nombre, ciudad: p.ciudad, meses: (rows || []).length,
      recaudacion_cop: Math.round(m.totalCollections), produccion_cop: Math.round(m.totalProduction), ingreso_neto_cop: Math.round(m.totalNetIncome),
      tasa_gastos: round1(m.overheadRate), tasa_aceptacion: round1(m.acceptanceRate), tasa_ausentismo: round1(m.noShowRate),
      tasa_cobro: round1(m.totalProduction ? m.totalCollections / m.totalProduction * 100 : 0),
      pacientes_nuevos: m.totalNewPat, pacientes_activos: m.activePatients,
    });
    acc.col += m.totalCollections; acc.prod += m.totalProduction; acc.net += m.totalNetIncome; acc.ov += m.totalOverhead;
    acc.newp += m.totalNewPat; acc.sched += m.totalScheduled; acc.comp += m.totalCompleted; acc.noshow += m.totalNoShows;
    acc.pres += m.totalPlansPresented; acc.acc += m.totalPlansAccepted; acc.active += m.activePatients; acc.meses = Math.max(acc.meses, (rows || []).length);
  }
  const red = {
    sedes: practices.length, meses: acc.meses,
    recaudacion_cop: Math.round(acc.col), produccion_cop: Math.round(acc.prod), ingreso_neto_cop: Math.round(acc.net),
    tasa_gastos: round1(acc.col ? acc.ov / acc.col * 100 : 0),
    tasa_aceptacion: round1(acc.pres ? acc.acc / acc.pres * 100 : 0),
    tasa_ausentismo: round1(acc.sched ? acc.noshow / acc.sched * 100 : 0),
    tasa_cobro: round1(acc.prod ? acc.col / acc.prod * 100 : 0),
    pacientes_nuevos: acc.newp, pacientes_activos: acc.active,
  };
  return json({ network_id: nid, nombre: net.nombre, plan: net.plan, red, sedes });
}

export default {
  async scheduled(event, env, ctx) {
    // Cron semanal (lunes 7am Bogotá / 12:00 UTC). Genera para cada clínica activa.
    const run = (async () => {
      const { results: practices } = await env.DB.prepare(`SELECT * FROM practices WHERE activo = 1`).all();
      for (const practice of (practices || [])) {
        try {
          const r = await generarParaPractica(env, practice);
          console.log('cron generar:', JSON.stringify(r));
        } catch (e) {
          console.error('cron error', practice.practice_id, '-', e.message);
        }
      }
    })();
    ctx.waitUntil(run);
    await run;
  },

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

    if (path === '/tareas/generar') {
      if (request.method === 'POST') return generarEndpoint(request, env, url);
      return json({ error: 'Método no permitido' }, 405);
    }

    // ── Modelo multi-sede (Fase 3B) ──
    if (path === '/networks' && request.method === 'POST') return crearNetwork(request, env, url);
    if (path === '/practices') {
      if (request.method === 'POST') return crearPractice(request, env, url);
      if (request.method === 'GET') return listarPractices(env, url);
      return json({ error: 'Método no permitido' }, 405);
    }
    if (path === '/doctors' && request.method === 'POST') return crearDoctor(request, env, url);
    if (path === '/red/metricas' && request.method === 'GET') return metricasRed(env, url);

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
