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
                  THEN COALESCE(valor_estimado_cop, 0) ELSE 0 END) AS valor_esperado_cop,
         SUM(CASE WHEN estado = 'completada' AND resultado = 'agendo_cita'
                  THEN COALESCE(valor_real_cop, valor_estimado_cop, 0) ELSE 0 END) AS valor_real_cop,
         SUM(CASE WHEN fecha_limite IS NOT NULL AND fecha_limite < ?1
                  AND estado IN ('pendiente','en_proceso') THEN 1 ELSE 0 END) AS vencidas_count
       FROM tareas WHERE practice_id = ?2 AND semana = ?3`
    ).bind(hoy, practiceId, semana).first();
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
