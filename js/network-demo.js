/* ── DEMO MULTI-SEDE (Fase 3A) ────────────────────────────────────────────
   Demo 100% frontend de una red de 4 sedes para un prospecto de grupo dental.
   Se activa SOLO con ?demo=red (o ?red=true). Es ADITIVO: si el parámetro no
   está, este módulo no hace nada y el comportamiento de sede única es idéntico.

   Reutiliza todo lo del dashboard existente: computeMetrics / computeHealthScore
   / benchmarkStates (mismos umbrales de meta), render(), la paleta y las clases
   de estado (green/amber/red). No introduce estilo visual nuevo.

   NO hay backend, D1 ni persistencia — los datos son sintéticos y deterministas.
   El "Analizar con IA" en este modo devuelve análisis PRE-GENERADOS (cacheados)
   para no quemar tokens durante la demo. */

const NET = {
  active: (() => {
    const p = new URLSearchParams(location.search);
    return p.get('demo') === 'red' || p.get('red') === 'true' || !!p.get('network');
  })(),
  networkId: new URLSearchParams(location.search).get('network') || 'red-dental-sonrisa',
  name: 'Red Dental Sonrisa',
  rol: (new URLSearchParams(location.search).get('rol') || 'dueno').toLowerCase(),  // 'dueno' | 'gerente'
  rolSede: (new URLSearchParams(location.search).get('sede') || '').toLowerCase(),  // practice_id del gerente
  gerenteIdx: 0,
  mode: 'red',        // 'red' = vista consolidada | 'sede' = drill a una sede
  sedeIdx: 0,
  currentName: null,  // lo lee getWhiteLabel() (mayor prioridad en modo red)
  sedes: [],
  fuente: 'd1',       // 'd1' = datos reales de D1 | 'sintetico' = fallback
  filtroMes: '',      // filtro de mes/período de la vista Red
  tareasRed: null,    // cache de tareas consolidadas de la red
  tareaSedeFiltro: '',// filtro por sede en las tareas consolidadas
  analysis: null,     // análisis cacheado de la red (fallback del Asesor IA)
};

/* Estacionalidad mensual (derivada de la forma del demo de sede única). Media
   ≈ 1.0 → escala la producción de cada sede mes a mes. 12 meses: ago→jul. */
const NET_WEIGHTS = [1.044, 1.109, 1.140, 1.250, 1.347, 0.635, 0.698, 0.884, 0.957, 1.023, 0.940, 0.973];
const NET_MONTHS = ['2025-08','2025-09','2025-10','2025-11','2025-12','2026-01','2026-02','2026-03','2026-04','2026-05','2026-06','2026-07'];

/* Perfiles de las 4 sedes. Variación NO aplanada y calibrada contra las metas
   del producto (gastos <65%, aceptación >65%, ausentismo <12%):
   - Chapinero: fuerte (cumple las 4 metas)
   - Usaquén / Suba: promedio
   - Kennedy: débil (incumple 3 metas)  */
const NET_PROFILES = [
  { id:'chapinero', name:'Sede Chapinero', city:'Bogotá · Chapinero',
    avgProd:72, overheadR:0.545, acceptR:0.74, noshowR:0.062, collR:0.975, newPatMo:28, apptsMo:300,
    baseActive:520, growth:8, mix:{h:0.22,r:0.30,c:0.16,o:0.22},
    doctors:[{name:'Dra. Valentina Ríos', share:0.55, acceptR:0.76},{name:'Dr. Andrés Gómez', share:0.45, acceptR:0.71}] },
  { id:'usaquen', name:'Sede Usaquén', city:'Bogotá · Usaquén',
    avgProd:58, overheadR:0.615, acceptR:0.67, noshowR:0.093, collR:0.96, newPatMo:23, apptsMo:262,
    baseActive:470, growth:6, mix:{h:0.24,r:0.32,c:0.12,o:0.22},
    doctors:[{name:'Dra. Camila Torres', share:0.52, acceptR:0.69},{name:'Dr. Felipe Navarro', share:0.48, acceptR:0.66}] },
  { id:'suba', name:'Sede Suba', city:'Bogotá · Suba',
    avgProd:50, overheadR:0.632, acceptR:0.64, noshowR:0.105, collR:0.95, newPatMo:21, apptsMo:240,
    baseActive:430, growth:5, mix:{h:0.25,r:0.32,c:0.10,o:0.21},
    doctors:[{name:'Dr. Julián Mesa', share:0.54, acceptR:0.67},{name:'Dra. Paola Castro', share:0.46, acceptR:0.63}] },
  { id:'kennedy', name:'Sede Kennedy', city:'Bogotá · Kennedy',
    avgProd:38, overheadR:0.685, acceptR:0.52, noshowR:0.163, collR:0.925, newPatMo:14, apptsMo:210,
    baseActive:360, growth:4, mix:{h:0.27,r:0.30,c:0.07,o:0.18},
    doctors:[{name:'Dr. Óscar Peña', share:0.51, acceptR:0.54},{name:'Dra. Marcela Duque', share:0.49, acceptR:0.49}] },
];

const r10k = n => Math.round(n / 10000) * 10000;

/* Genera las 12 filas mensuales de una sede (mismo esquema que el CSV). */
function netBuildData(p) {
  return NET_MONTHS.map((month, k) => {
    const w = NET_WEIGHTS[k];
    const gross = r10k(p.avgProd * 1e6 * w);
    const collections = r10k(gross * p.collR);
    const overhead = r10k(collections * p.overheadR);
    const scheduled = Math.round(p.apptsMo * w);
    const noShows = Math.round(scheduled * p.noshowR);
    const cancellations = Math.round(scheduled * 0.05);
    const presented = Math.round(scheduled * 0.34);
    return {
      month,
      gross_production: gross,
      collections,
      new_patients: Math.round(p.newPatMo * w),
      active_patients: p.baseActive + Math.round(k * p.growth),
      appointments_scheduled: scheduled,
      appointments_completed: scheduled - noShows - cancellations,
      cancellations,
      no_shows: noShows,
      treatment_plans_presented: presented,
      treatment_plans_accepted: Math.round(presented * p.acceptR),
      hygiene_revenue: r10k(gross * p.mix.h),
      restorative_revenue: r10k(gross * p.mix.r),
      cosmetic_revenue: r10k(gross * p.mix.c),
      orthodontic_revenue: r10k(gross * p.mix.o),
      overhead_costs: overhead,
      staff_costs: r10k(overhead * 0.66),
      supplies_costs: r10k(overhead * 0.17),
      net_income: collections - overhead,
    };
  });
}

/* Fallback sintético — solo si D1 no responde (la demo nunca se rompe). */
function netBuildSedes() {
  NET.sedes = NET_PROFILES.map((p, i) => {
    const data = netBuildData(p);
    const m = computeMetrics(data);
    const annualGross = data.reduce((s, r) => s + r.gross_production, 0);
    const doctors = p.doctors.map((d, di) => ({
      name: d.name, sede: p.name,
      production: Math.round(annualGross * d.share),
      acceptance: Math.round(d.acceptR * 100),
      ausentismo: Math.round(m.noShowRate * (di === 0 ? 0.9 : 1.1) * 10) / 10,
    }));
    return { id: p.id, name: p.name, city: p.city, data, metrics: m, doctors, analysis: NET_SEDE_ANALYSIS[p.id], tareas: netBuildTareas(p, i, m) };
  });
}

/* Fuente REAL (Fase 3C): arma NET.sedes desde GET /red/datos (D1). El dashboard
   reusa computeMetrics/computeHealthScore/render sobre estos datos igual que con
   una sede única — sin lógica nueva. */
function netBuildSedesFromDatos(payload) {
  NET.name = payload.nombre || NET.name;
  NET.networkId = payload.network_id || NET.networkId;
  NET.sedes = payload.sedes.map(s => {
    const data = (s.data || []).map(r => ({ ...r }));   // filas crudas de metricas_mensuales
    return {
      id: s.practice_id, name: s.nombre, city: s.ciudad || '', data, metrics: computeMetrics(data),
      doctors: (s.doctors || []).map(d => ({
        name: d.nombre, sede: s.nombre,
        production: Number(d.produccion_cop) || 0,
        acceptance: Number(d.aceptacion) || 0,
        ausentismo: Number(d.ausentismo) || 0,
      })),
      analysis: NET_SEDE_ANALYSIS[s.practice_id] || null,
    };
  });
}

/* ── TAREAS DE DEMO POR SEDE ───────────────────────────────────────────────
   Reponen el tablero de Pendientes (con el overview mensual de "Recuperado
   real") dentro del demo de red, sin backend. Se cargan al hacer drill a una
   sede; las interacciones se guardan en memoria (ver guards en tareas.js). */
function netLunes() {
  const d = new Date();
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const NET_PAC = [
  ['María F. Ríos', '+57 310 456 7890'], ['Carlos A. Gómez', '+57 311 234 5678'],
  ['Luisa Martínez', '+57 312 987 6543'], ['Jorge Patiño', '+57 300 111 2233'],
  ['Diana Vargas', '+57 315 555 4411'], ['Andrés Torres', '+57 320 777 8899'],
  ['Paola Suárez', '+57 301 222 3344'], ['Ricardo Mejía', '+57 313 444 5566'],
  ['Natalia Restrepo', '+57 317 656 2211'], ['Óscar Cardona', '+57 314 909 8877'],
];
/* `off` desplaza el pool para que distintas tareas de la MISMA sede muestren
   pacientes distintos. */
function netPac(sidx, off, list) {
  return list.map((x, i) => {
    const p = NET_PAC[(sidx * 3 + off + i) % NET_PAC.length];
    return {
      id: `P${sidx}-${off}-${i}`, nombre: p[0], telefono: p[1], ultima_consulta: '2026-06-15',
      que_paso: x.q || '', accion: x.a || 'Contactar y reagendar',
      valor_pendiente_cop: x.v, estado: x.e || 'pendiente',
      monto_real_cop: (x.mr === undefined ? null : x.mr),
    };
  });
}

/* Tareas DERIVADAS de las métricas reales de cada sede (como haría la IA):
   cada sede muestra las acciones que le corresponden según sus brechas — la
   sede débil recibe tareas urgentes de no-shows/aceptación, la fuerte tareas
   ligeras de capacidad. `m` = computeMetrics(sede.data). */
function netBuildTareas(p, sidx, m) {
  const semana = netLunes();
  const k = p.avgProd / 58;
  const V = n => Math.round(n * k / 10000) * 10000;
  const ov = m.overheadRate, ac = m.acceptanceRate, ns = m.noShowRate;
  const noShowsMes = Math.max(3, Math.round(m.totalNoShows / 12));
  const planesNoAcMes = Math.max(2, Math.round((m.totalPlansPresented - m.totalPlansAccepted) / 12));
  const gapMes = Math.round((m.totalProduction - m.totalCollections) / 12);
  const inactivosMes = Math.max(6, Math.round(m.avgNewPatPerMonth * 0.6));
  const base = { practice_id: p.id, semana, fuente: 'ia_semanal', resultado: null, fecha_limite: null, completado_por: null, completado_en: null, valor_real_cop: null };
  const tasks = [];
  let id = sidx * 100;
  const push = o => tasks.push({ ...base, id: ++id, estado: 'pendiente', valor_estimado_cop: 0, pacientes: null, ...o });

  // 1. Recall de inactivos — universal. Va COMPLETADA con citas agendadas para
  //    que el overview muestre "Recuperado real" en cada sede.
  push({
    titulo: `Llamar a ${inactivosMes} pacientes inactivos de alto valor`,
    descripcion: 'Pacientes sin cita en 6+ meses con tratamientos pendientes; recuperación de agenda.',
    categoria: 'recall_inactivos', asignado_a: 'recepcionista', prioridad: 'alta',
    estado: 'completada', resultado: 'agendo_cita', completado_por: 'recepcionista', valor_estimado_cop: V(3600000),
    pacientes: netPac(sidx, 0, [
      { v: V(2700000), e: 'agendo_cita', mr: V(2700000), a: 'Cerró valoración de implante con abono a favor' },
      { v: V(320000), e: 'agendo_cita', mr: V(320000), a: 'Agendó resina y control de higiene' },
      { v: V(680000), e: 'no_respondio', a: 'Reintentar llamada esta semana' }]),
  });

  // 2. No-shows — según el ausentismo real de la sede.
  if (ns >= 8) {
    const grave = ns >= 12;
    push({
      titulo: `Reagendar ${noShowsMes} no-shows del mes`,
      descripcion: `Ausentismo en ${Math.round(ns)}% (meta <12%). Reagendar y activar confirmación por WhatsApp 24h antes.`,
      categoria: 'no_shows', asignado_a: 'recepcionista', prioridad: grave ? 'alta' : 'media',
      estado: grave ? 'pendiente' : 'en_proceso', valor_estimado_cop: V(grave ? 2400000 : 1400000),
      pacientes: netPac(sidx, 3, [
        { v: V(850000), a: 'Reagendar endodoncia — prioritario por dolor reportado' },
        { v: V(1350000), e: grave ? 'pendiente' : 'agendo_cita', mr: grave ? undefined : V(1350000), a: 'Reagendar corona; verificar teléfono' },
        ...(grave ? [{ v: V(180000), a: 'Segunda inasistencia — explicar política de confirmación' }] : [])]),
    });
  }

  // 3. Aceptación de tratamientos — si está por debajo/cerca de la meta.
  if (ac < 68) {
    push({
      titulo: `Re-presentar ${planesNoAcMes} planes de tratamiento no aceptados`,
      descripcion: `Aceptación en ${Math.round(ac)}% (meta >65%). Re-presentar los planes de mayor valor y ofrecer financiación a cuotas.`,
      categoria: 'aceptacion_tratamiento', asignado_a: 'dueno', prioridad: ac < 55 ? 'alta' : 'media',
      estado: 'pendiente', valor_estimado_cop: V(ac < 55 ? 5200000 : 3400000),
      pacientes: netPac(sidx, 6, [
        { v: V(3800000), a: 'Re-presentar plan de implante con simulación' },
        { v: V(2700000), a: 'Resolver dudas de costo del plan de 2 coronas' }]),
    });
  }

  // 4. Cobro de cartera — universal (brecha producción vs. cobro).
  push({
    titulo: `Gestionar cobro de cartera (${netM(gapMes)}/mes sin cobrar)`,
    descripcion: 'Saldos de tratamientos ya realizados sin cobrar; recordatorios y planes de pago.',
    categoria: 'otro', asignado_a: 'recepcionista', prioridad: 'media',
    estado: 'pendiente', valor_estimado_cop: Math.max(V(1500000), gapMes),
  });

  // 5. Gastos — solo si están por encima de la meta (sedes débiles).
  if (ov >= 65) {
    push({
      titulo: `Revisar estructura de gastos (${Math.round(ov)}%, meta <65%)`,
      descripcion: 'Comparar personal vs. producción e insumos contra las sedes más eficientes de la red.',
      categoria: 'otro', asignado_a: 'dueno', prioridad: 'media', estado: 'pendiente', valor_estimado_cop: 0,
    });
  }

  // 6. Capacidad — solo si la sede ya cumple todas las metas (sede fuerte).
  if (ov < 55 && ac > 65 && ns < 8) {
    push({
      titulo: 'Evaluar ampliar capacidad — la sede va sobre meta',
      descripcion: 'Cumple las 4 metas; el límite es capacidad instalada. Analizar una tercera silla o extender horario.',
      categoria: 'otro', asignado_a: 'dueno', prioridad: 'baja', estado: 'pendiente', valor_estimado_cop: 0,
    });
  }

  return tasks;
}
/* Carga las tareas de la sede en el tablero (copia fresca cada vez). */
/* Carga el tablero de Pendientes de una sede. En modo D1 (3C) jala las tareas
   reales del Worker por practice_id; en fallback sintético usa las de memoria. */
async function netLoadTareas(i) {
  if (typeof TAREAS === 'undefined') return;
  const s = NET.sedes[i];
  if (NET.fuente !== 'd1') {
    TAREAS = JSON.parse(JSON.stringify(s.tareas || []));
    TAREAS_RESUMEN = null;
    recomputarResumen(); renderTareasUI(); return;
  }
  TAREAS_CARGANDO = true; TAREAS_ERROR = false; renderTareasUI();
  try {
    const resp = await fetch(`${WORKER_URL}/tareas?practice_id=${encodeURIComponent(s.id)}`);
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const j = await resp.json();
    TAREAS = Array.isArray(j.tareas) ? j.tareas : [];
    TAREAS_RESUMEN = j.resumen || null;
    TAREAS_CARGANDO = false;
    recomputarResumen(); renderTareasUI();
  } catch (e) {
    TAREAS = []; TAREAS_CARGANDO = false; TAREAS_ERROR = true; renderTareasUI();
  }
}

/* ── ANÁLISIS IA CACHEADOS (no llaman a la API — evita quemar tokens) ── */
const NET_ANALYSIS = {
  headline: 'La red recaudó $2.500 millones en 12 meses; Chapinero cumple las 4 metas mientras Kennedy arrastra el promedio con 16% de ausentismo y 52% de aceptación.',
  what_happened: 'Las 4 sedes recaudaron ~$2.500M. Chapinero cumple las 4 metas (gastos 55%, aceptación 74%, ausentismo 6%). Usaquén y Suba están en rango. Kennedy incumple 3 metas: gastos 68%, aceptación 52% y ausentismo 16%.',
  why_it_matters: 'La brecha de Kennedy no es de mercado sino de operación: sus indicadores están lejos incluso del promedio de la red. Cerrar esa brecha rinde más que abrir una sede nueva.',
  opportunity: 'Si Kennedy llegara solo al promedio de la red en aceptación y ausentismo, la red recuperaría cerca de $180M al año sin invertir en marketing.',
  actions: [
    { priority: 'URGENT', text: 'Auditar esta semana la agenda y el protocolo de confirmación de Kennedy: 16% de ausentismo es el doble de la meta.' },
    { priority: 'MEDIUM', text: 'Replicar en Kennedy y Suba el guion de presentación de tratamientos de Chapinero (74% de aceptación) en los próximos 30 días.' },
    { priority: 'LOW', text: 'Estandarizar un reporte mensual por sede contra metas para comparar el cierre de cada clínica.' },
  ],
  confidence: 84,
};
const NET_SEDE_ANALYSIS = {
  chapinero: {
    headline: 'Chapinero es la sede más fuerte de la red: cumple las 4 metas y lidera en producción.',
    what_happened: 'Recaudó ~$840M con gastos en 55%, aceptación 74% y ausentismo 6% — todos por encima de la meta del sector.',
    why_it_matters: 'Es el modelo operativo a replicar en el resto de la red; su desempeño no depende de su zona sino de su gestión.',
    opportunity: 'Su límite ya no es la operación sino la capacidad instalada: evaluar una tercera silla o extender horario para capturar más demanda.',
    actions: [
      { priority: 'MEDIUM', text: 'Documentar el guion de aceptación y el protocolo de confirmación de Chapinero para exportarlo a las otras sedes.' },
      { priority: 'LOW', text: 'Analizar la ocupación de sillas para decidir si hay espacio para crecer sin bajar la calidad.' },
    ],
    confidence: 82,
  },
  usaquen: {
    headline: 'Usaquén está en rango, pero con gastos algo altos (61%) y ausentismo cerca del límite.',
    what_happened: 'Recaudó ~$670M con aceptación 67% (sobre meta) y ausentismo 9%. Los gastos operativos en 61% dejan margen de eficiencia.',
    why_it_matters: 'Es una sede sana pero sin palancas de mejora explotadas; pequeños ajustes la acercan al nivel de Chapinero.',
    opportunity: 'Bajar gastos al 57% y subir la aceptación 3-4 puntos suma varios millones al mes sin pacientes nuevos.',
    actions: [
      { priority: 'MEDIUM', text: 'Revisar la estructura de costos de Usaquén contra Chapinero para cerrar la brecha de gastos.' },
      { priority: 'LOW', text: 'Reforzar recordatorios de confirmación para bajar el ausentismo de 9% hacia el 6% de la red líder.' },
    ],
    confidence: 79,
  },
  suba: {
    headline: 'Suba es promedio, con aceptación (64%) apenas por debajo de la meta y ausentismo del 10%.',
    what_happened: 'Recaudó ~$570M. La aceptación de tratamientos (64%) está un punto debajo de la meta y el ausentismo (10%) cerca del límite.',
    why_it_matters: 'Está a un ajuste de entrar en verde; el problema es de conversión y agenda, no de flujo de pacientes.',
    opportunity: 'Subir la aceptación por encima del 65% y bajar el ausentismo mueve la sede de promedio a saludable.',
    actions: [
      { priority: 'MEDIUM', text: 'Estandarizar la presentación de planes de tratamiento en Suba para superar el 65% de aceptación.' },
      { priority: 'LOW', text: 'Activar confirmación por WhatsApp 24h antes para reducir las inasistencias.' },
    ],
    confidence: 78,
  },
  kennedy: {
    headline: 'Kennedy es la sede que más pesa sobre la red: incumple 3 metas (gastos 68%, aceptación 52%, ausentismo 16%).',
    what_happened: 'Recaudó ~$420M con gastos en 68%, aceptación 52% y ausentismo 16% — las tres por fuera de meta. Es la de menor producción y menor eficiencia.',
    why_it_matters: 'El ausentismo del 16% y la aceptación del 52% son problemas de proceso, no de demanda; hoy drenan utilidad de toda la red.',
    opportunity: 'Llevar Kennedy solo al promedio de la red en aceptación y ausentismo recupera cerca de $180M/año — más que abrir una sede nueva.',
    actions: [
      { priority: 'URGENT', text: 'Auditar la agenda y el protocolo de confirmación esta semana: el ausentismo del 16% es el doble de la meta.' },
      { priority: 'MEDIUM', text: 'Implantar el guion de aceptación de Chapinero y acompañar a los doctores en la presentación de tratamientos.' },
      { priority: 'LOW', text: 'Revisar la estructura de gastos para bajar del 68% hacia la meta del 65%.' },
    ],
    confidence: 81,
  },
};

/* ── INIT ── ── Fase 3C: jala los datos reales de la red desde D1 (con fallback
   sintético para que nunca se rompa). */
async function initNetworkDemo() {
  try {
    const resp = await fetch(`${WORKER_URL}/red/datos?network_id=${encodeURIComponent(NET.networkId)}`);
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const payload = await resp.json();
    if (!payload.sedes || !payload.sedes.length) throw new Error('sin sedes');
    netBuildSedesFromDatos(payload);
    NET.fuente = 'd1';
  } catch (e) {
    netBuildSedes();          // fallback: datos sintéticos idénticos
    NET.fuente = 'sintetico';
  }
  NET.analysis = NET_ANALYSIS;

  // Encabezado / marca de la red (sin romper el white-label existente).
  document.title = `${NET.name} — Intelligence Dashboard`;
  const badge = document.querySelector('.demo-badge');
  if (badge) badge.lastChild.textContent = ` Red · ${NET.sedes.length} sedes (datos de demostración)`;

  // Datos base para el drill/chat/forecast (la primera sede).
  ALL = NET.sedes[0].data;
  CURRENT_DATA = NET.sedes[0].data;
  const sel = document.getElementById('fMonth');
  if (sel) { sel.innerHTML = '<option value="">Todos los meses</option>'; popFilters(); }
  if (typeof initChat === 'function') initChat();

  document.getElementById('loading').style.display = 'none';
  document.getElementById('app').style.display = 'block';

  // Rol (simulado por URL para el demo): gerente ve SOLO su sede; dueño ve todo.
  if (NET.rol === 'gerente') {
    const i = NET.sedes.findIndex(s => s.id === NET.rolSede);
    NET.gerenteIdx = i >= 0 ? i : 0;
  }
  const bar = document.getElementById('network-bar');
  if (NET.rol === 'gerente') {
    const sede = NET.sedes[NET.gerenteIdx];
    bar.innerHTML = `
      <div class="nb-inner">
        <div class="nb-title"><span class="nb-badge nb-badge-rol"><i>🔒</i> Gerente</span> <strong>${escapeHtml(sede.name)}</strong></div>
        <div class="nb-rol-note">Ves solo tu sede · el dueño de la red ve todas</div>
      </div>`;
    bar.style.display = 'block';
    setNetworkMode('sede');
  } else {
    bar.innerHTML = `
      <div class="nb-inner">
        <div class="nb-title"><span class="nb-badge">RED</span> <strong>${escapeHtml(NET.name)}</strong> · ${NET.sedes.length} sedes <span class="nb-rol-chip">Dueño</span></div>
        <div class="nb-controls">
          <div class="nb-seg" role="tablist">
            <button class="nb-seg-btn active" id="nb-seg-red" onclick="setNetworkMode('red')">Red completa</button>
            <button class="nb-seg-btn" id="nb-seg-sede" onclick="setNetworkMode('sede')">Sede individual</button>
          </div>
          <select class="nb-sede-select" id="nb-sede-select" style="display:none" onchange="selectSede(this.selectedIndex)">
            ${NET.sedes.map(s => `<option>${escapeHtml(s.name)}</option>`).join('')}
          </select>
        </div>
      </div>`;
    bar.style.display = 'block';
    setNetworkMode('red');
  }
}

/* Alterna entre la vista consolidada (red) y el drill a una sede. Un gerente
   queda bloqueado en su sede (no puede ver la red ni otras sedes). */
function setNetworkMode(mode) {
  if (NET.rol === 'gerente') mode = 'sede';
  NET.mode = mode;
  const red = mode === 'red';
  const segR = document.getElementById('nb-seg-red'); if (segR) segR.classList.toggle('active', red);
  const segS = document.getElementById('nb-seg-sede'); if (segS) segS.classList.toggle('active', !red);
  const selEl = document.getElementById('nb-sede-select'); if (selEl) selEl.style.display = red ? 'none' : '';
  document.getElementById('network-view').style.display = red ? 'block' : 'none';
  document.querySelector('.tab-nav').style.display = red ? 'none' : '';
  document.querySelectorAll('.tab-pane').forEach(p => { p.style.display = red ? 'none' : ''; });
  // Pendientes y la campana son por-clínica: se muestran al drillear una sede,
  // se ocultan en la vista consolidada de red (las tareas consolidadas son 3C).
  const bell = document.getElementById('bell-wrap'); if (bell) bell.style.display = red ? 'none' : '';
  const tabTareas = document.getElementById('tab-btn-tareas'); if (tabTareas) tabTareas.style.display = red ? 'none' : '';
  if (red) {
    NET.currentName = NET.name;
    NET.tareasRed = null;   // refresca las tareas consolidadas al entrar a la red
    applyWhiteLabel();
    renderNetworkView();
  } else {
    selectSede(NET.rol === 'gerente' ? NET.gerenteIdx : (NET.sedeIdx || 0));
  }
}

/* Drill a una sede: reusa el dashboard existente con los datos de esa sede. */
function selectSede(i) {
  if (NET.rol === 'gerente') i = NET.gerenteIdx;   // gerente: siempre su sede
  NET.sedeIdx = i;
  const s = NET.sedes[i];
  ALL = s.data;
  CURRENT_DATA = s.data;
  NET.currentName = s.name;
  const sel = document.getElementById('nb-sede-select');
  if (sel) sel.selectedIndex = i;
  const fm = document.getElementById('fMonth');
  if (fm) fm.value = '';                 // filtro de mes en sync con la sede
  render(s.data);
  if (typeof initChat === 'function') initChat();  // re-arma el contexto del chat con la sede activa
  netLoadTareas(i);                       // carga el tablero de Pendientes de la sede
  applyWhiteLabel();
}

/* ── SEMÁFORO ── reutiliza los umbrales y colores del producto ── */
function netAcceptColor(pct) { return pct > 65 ? 'green' : pct > 55 ? 'amber' : 'red'; }

/* Plantilla del análisis (misma estructura visual que showResult del dashboard). */
function netAnalysisHTML(r) {
  const pc = { URGENT: 'ab-u', MEDIUM: 'ab-m', LOW: 'ab-b' };
  const conf = Number(r.confidence) || 0;
  return `
    <div class="ai-lead">${escapeHtml(r.headline)}</div>
    <div class="ai-blocks">
      <div class="ai-block"><div class="ai-block-lbl">Qué pasó</div><div class="ai-block-txt">${escapeHtml(r.what_happened)}</div></div>
      <div class="ai-block"><div class="ai-block-lbl">Por qué importa</div><div class="ai-block-txt">${escapeHtml(r.why_it_matters)}</div></div>
      <div class="ai-block"><div class="ai-block-lbl">Oportunidad / Riesgo</div><div class="ai-block-txt">${escapeHtml(r.opportunity)}</div></div>
    </div>
    <div class="ai-actions-title">Acciones recomendadas</div>
    ${r.actions.map(a => `<div class="ai-action"><span class="abadge ${pc[a.priority] || 'ab-b'}">${escapeHtml(a.priority)}</span><span>${escapeHtml(a.text)}</span></div>`).join('')}
    <div class="ai-conf"><span class="ai-conf-lbl">Confianza del análisis</span><div class="ai-conf-track"><div class="ai-conf-fill" style="width:${conf}%"></div></div><span class="ai-conf-pct">${conf}%</span></div>`;
}
/* Contexto de red para el Asesor IA: métricas de cada sede + consolidado. */
function netContextoRed() {
  const cop = v => '$' + (Math.round(v / 1e5) / 10).toFixed(1) + 'M';
  const lineas = NET.sedes.map(s => {
    const m = netSedeMetrics(s);
    return `- ${s.name.replace('Sede ', '')}: recaudación ${cop(m.totalCollections)}, gastos ${m.overheadRate.toFixed(0)}% (meta <65%), aceptación ${Math.round(m.acceptanceRate)}% (meta >65%), ausentismo ${m.noShowRate.toFixed(0)}% (meta <12%), pacientes nuevos/mes ${Math.round(m.avgNewPatPerMonth)}`;
  }).join('\n');
  const cm = computeMetrics(netMonthlyCombined());
  const docs = NET.sedes.flatMap(s => s.doctors).sort((a, b) => b.production - a.production).slice(0, 3)
    .map(d => `${d.name} (${d.sede.replace('Sede ', '')}, ${cop(d.production)}, aceptación ${Math.round(d.acceptance)}%)`).join('; ');
  return `RED: ${NET.name} · ${NET.sedes.length} sedes${NET.filtroMes ? ' · ' + NET.filtroMes : ''}
Por sede:
${lineas}
Consolidado red: recaudación ${cop(cm.totalCollections)}, gastos ${cm.overheadRate.toFixed(0)}%, aceptación ${Math.round(cm.acceptanceRate)}%, ausentismo ${cm.noShowRate.toFixed(0)}%.
Top doctores por producción: ${docs}.`;
}

/* Análisis ejecutivo de la RED — llama a la API real con el contexto agregado
   (Fase 3C). Si falla, cae al análisis cacheado para no mostrar error en vivo. */
async function netRunAnalysis() {
  const btn = document.getElementById('net-ai-btn');
  document.getElementById('net-ai-empty').style.display = 'none';
  const el = document.getElementById('net-ai-result');
  el.style.display = 'block';
  if (btn) btn.disabled = true;
  if (NET.fuente !== 'd1') { el.innerHTML = netAnalysisHTML(NET.analysis); return; }
  el.innerHTML = `<div class="ai-loading" style="display:flex"><div class="ld"><span></span><span></span><span></span></div><span style="font-size:13px;color:var(--muted)">Comparando las ${NET.sedes.length} sedes…</span></div>`;
  const prompt = `Eres analista de operaciones de una RED de clínicas dentales colombianas. Compara las sedes, identifica cuál necesita atención y por qué, y da acciones priorizadas para el DUEÑO de la red.

${netContextoRed()}

Responde ÚNICAMENTE con JSON válido (sin markdown): {"headline":"hallazgo principal con la sede y números reales","what_happened":"2-3 frases comparando las sedes","why_it_matters":"2-3 frases de implicación para el dueño de la red","opportunity":"1-2 frases sobre la mayor oportunidad o riesgo","actions":[{"priority":"URGENT","text":"acción esta semana"},{"priority":"MEDIUM","text":"acción en 30 días"},{"priority":"LOW","text":"acción estratégica"}],"confidence":85}
En español, tono colombiano directo. Cita sedes y cifras reales.`;
  try {
    const raw = await netFetchIA(prompt, 1100);
    const r = JSON.parse(raw.replace(/```json|```/g, '').trim());
    if (!r.headline || !Array.isArray(r.actions)) throw new Error('formato');
    el.innerHTML = netAnalysisHTML(r);
  } catch (e) {
    el.innerHTML = netAnalysisHTML(NET.analysis);   // fallback: nunca error ni loading infinito
  }
}

/* Q&A comparativo de la red: pregunta libre + contexto de las 4 sedes (API real). */
async function netAskRed(ev) {
  if (ev && ev.key && ev.key !== 'Enter') return;
  const inp = document.getElementById('net-ask-input');
  const out = document.getElementById('net-ask-answer');
  const q = (inp.value || '').trim();
  if (!q) return;
  out.style.display = 'block';
  out.innerHTML = `<div class="ai-loading" style="display:flex"><div class="ld"><span></span><span></span><span></span></div><span style="font-size:13px;color:var(--muted)">Analizando…</span></div>`;
  const prompt = `Eres el asesor de operaciones del DUEÑO de una red de clínicas dentales. Responde su pregunta comparando las sedes con datos reales.

${netContextoRed()}

Pregunta del dueño: "${q}"

Responde directo y específico, citando sedes y números. Máximo 130 palabras, español, **negrita** en cifras o sedes clave.`;
  try {
    const raw = await netFetchIA(prompt, 400);
    out.innerHTML = `<div class="ai-block-txt">${renderMarkdown(raw)}</div>`;
  } catch (e) {
    out.innerHTML = `<div class="ai-block-txt">No se pudo consultar ahora. Intenta de nuevo en un momento.</div>`;
  }
}

/* ── IA OFFLINE PARA LA DEMO (chat + proyección, sin API) ──────────────────
   El "Analizar con IA" ya usa análisis cacheados. Aquí hacemos lo mismo para el
   Asesor IA (chat) y la Proyección: respuestas deterministas construidas con los
   números REALES de la sede activa (ALL). Cero tokens, cero riesgo de error en
   vivo, y coherente con cada sede. */
const netM = v => '$' + (v / 1e6).toFixed(1) + 'M';

/* Respuesta del chat: enruta por tema y responde con los datos de la sede. */
function netDemoChatReply(q) {
  const m = computeMetrics(ALL), name = getWhiteLabel();
  const ov = Math.round(m.overheadRate), ac = Math.round(m.acceptanceRate), ns = Math.round(m.noShowRate), co = Math.round(m.collectionRate);
  const gap = m.totalProduction - m.totalCollections;
  const serv = [['higiene', m.hygieneRevenue], ['restaurativa', m.restorativeRevenue], ['estética', m.cosmeticRevenue], ['ortodoncia', m.orthoRevenue]].sort((a, b) => b[1] - a[1]);
  const best = [...ALL].sort((a, b) => b.collections - a.collections).slice(0, 2)
    .map(r => new Date(r.month + '-02').toLocaleDateString('es-CO', { month: 'long' }));
  const t = (q || '').toLowerCase();
  if (/ausent|no.?show|inasist|falta/.test(t))
    return `El ausentismo de **${name}** está en **${ns}%** frente a la meta del sector (**<12%**). ${ns >= 12 ? 'Está por encima de la meta y drena agenda pagada: ' : 'Está en rango, pero '}activar confirmación por WhatsApp 24h antes y una lista de reemplazo para huecos suele bajarlo 3-4 puntos en un mes.`;
  if (/acept|tratamiento|plan/.test(t))
    return `La aceptación de tratamientos es **${ac}%** (meta **>65%**). ${ac < 65 ? 'Está debajo de la meta: ' : 'Buen nivel; para subirla aún más, '}re-presentar los planes de mayor valor no aceptados y ofrecer financiación a cuotas es lo que más mueve la aguja sin atender un paciente nuevo.`;
  if (/cobro|cartera|recaud|deud|pend/.test(t))
    return `**${name}** recaudó **${netM(m.totalCollections)}** de **${netM(m.totalProduction)}** producidos — una brecha de **${netM(gap)}** (${co}% de cobro). Esos ${netM(gap)} ya los produjiste: recuperarlos con recordatorios de cartera es la utilidad más directa del trimestre.`;
  if (/gasto|overhead|costo|margen/.test(t))
    return `La tasa de gastos es **${ov}%** (meta **<65%**). ${ov >= 65 ? 'Está por encima de la meta: revisar personal vs. producción e insumos es la palanca principal.' : 'Está controlada; el ingreso neto crece más por cobro y aceptación que por recortar gastos.'}`;
  if (/rentable|servicio|línea|linea|produce/.test(t))
    return `La línea más rentable de **${name}** es **${serv[0][0]}** (${netM(serv[0][1])} en el período), seguida de **${serv[1][0]}** (${netM(serv[1][1])}). Concentrar el recall y las campañas en las dos primeras rinde más que repartir el esfuerzo.`;
  if (/mes|oportun|temporad|estacion|cuándo|cuando/.test(t))
    return `Tus meses más fuertes son **${best[0]}** y **${best[1]}**. Conviene llenar la agenda con anticipación en esas ventanas y usar los meses bajos (inicio de año) para recall y reactivación de inactivos.`;
  // General
  return `En resumen, **${name}**: recaudación **${netM(m.totalCollections)}**, gastos **${ov}%** (meta <65%), aceptación **${ac}%** (meta >65%), ausentismo **${ns}%** (meta <12%). ${ov >= 65 || ac < 65 || ns >= 12 ? 'La mayor oportunidad está en el indicador que hoy está fuera de meta.' : 'Con las metas cumplidas, la palanca es cerrar la brecha de cobro de ' + netM(gap) + '.'} Pregúntame por ausentismo, aceptación, cobro o servicios para el detalle.`;
}

/* Proyección determinista a partir de los datos reales de la sede. */
function netDemoForecast(decision) {
  const m = computeMetrics(ALL), name = getWhiteLabel();
  const avg = m.avgCollections;
  const nd = new Date(); nd.setMonth(nd.getMonth() + 1);
  const nextMonth = nd.toLocaleDateString('es-CO', { month: 'long', year: 'numeric' });
  const ns = Math.round(m.noShowRate), ac = Math.round(m.acceptanceRate);
  const dec = (decision || '').trim();
  const base = Math.round(avg / 1e5) * 1e5;
  const pess = Math.round(base * 0.88 / 1e5) * 1e5;
  const opt = Math.round(base * 1.13 / 1e5) * 1e5;
  return {
    next_month: nextMonth,
    decision_context: dec
      ? `Sobre tu decisión ("${dec}"): con la base actual de ${name} (~${netM(avg)}/mes), el margen para moverla depende de cerrar la brecha operativa antes de sumar costos fijos.`
      : `Proyección de panorama general para ${name} con base en sus últimos ${ALL.length} meses (~${netM(avg)}/mes).`,
    pessimistic: {
      collections: pess, confidence: 73, label: 'Pesimista', driver: 'Ausentismo y agenda floja',
      factors: [`Ausentismo en ${ns}% erosiona citas pagadas`, 'Menos confirmaciones en un mes de temporada baja', 'Cartera sin gestionar se acumula'],
      cost_of_inaction: `${netM(base - pess)} por debajo de tu promedio mensual`,
      cta: 'Blindar la agenda de las próximas 2 semanas con confirmación 24h antes.',
    },
    base: {
      collections: base, confidence: 69, label: 'Caso Base', driver: 'Se mantiene la tendencia actual',
      factors: [`Aceptación estable en ${ac}%`, 'Recall de higiene funcionando', 'Sin cambios de capacidad'],
      cost_of_inaction: null,
      cta: 'Sostener el ritmo de recall y presentación de tratamientos.',
    },
    optimistic: {
      collections: opt, confidence: 56, label: 'Optimista', driver: 'Se cierran brechas de aceptación y cobro',
      factors: ['Re-presentar los planes de alto valor no aceptados', `Bajar el ausentismo del ${ns}% hacia 8%`, 'Cobrar la cartera pendiente del mes'],
      cost_of_inaction: null,
      cta: 'Esta semana: re-presentar los 3 planes de mayor valor sin aceptar.',
    },
    questions: [
      { icon: '📉', text: `Si bajo el ausentismo de ${name} al 8%, ¿cuánto más recaudo?` },
      { icon: '🎯', text: `¿Cuál es mi acción de mayor impacto para ${nextMonth}?` },
      { icon: '💰', text: '¿Cuánto vale cerrar la brecha entre producción y cobro?' },
      { icon: '📆', text: `¿Qué semana de ${nextMonth} debo presionar más la agenda?` },
    ],
  };
}
function netDemoGenerateForecast() {
  const btn = document.getElementById('fc-gen-btn');
  const r = netDemoForecast(typeof fcDecisionText === 'function' ? fcDecisionText() : '');
  FC_RESULT = r;
  renderForecast(r);
  if (btn) { btn.disabled = false; btn.innerHTML = '<svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg> Regenerar'; }
}
/* Respuesta a las preguntas de seguimiento de la proyección (sin API). */
function netDemoForecastAnswer(q) {
  const m = computeMetrics(ALL), name = getWhiteLabel();
  const ns = Math.round(m.noShowRate), gap = m.totalProduction - m.totalCollections;
  const t = (q || '').toLowerCase();
  if (/ausent|no.?show|8%|inasist/.test(t)) {
    const recuperable = Math.round(m.avgCollections * Math.max(0, (ns - 8)) / 100 / 1e5) * 1e5;
    return `Bajar el ausentismo del **${ns}%** al **8%** en ${name} recupera del orden de **${netM(recuperable)}/mes** en citas que hoy se pierden. La palanca es confirmación 24h antes y una lista de reemplazo para llenar los huecos.`;
  }
  if (/brecha|cobro|producci|cartera/.test(t))
    return `La brecha entre producción y cobro es **${netM(gap)}**. Es dinero ya producido: gestionarlo con recordatorios de cartera equivale a casi un mes extra de utilidad sin atender un paciente nuevo.`;
  if (/semana|agenda|presion/.test(t))
    return `Concentra la presión de agenda en la **segunda y tercera semana** del mes, cuando históricamente cae la ocupación. Confirmar con anticipación esas semanas evita los huecos de última hora.`;
  return `Tu acción de mayor impacto en **${name}** es cerrar el indicador que hoy está más lejos de la meta y recuperar la brecha de cobro de **${netM(gap)}**. Ambas suben el ingreso neto sin sumar costos fijos.`;
}

/* ── PENDIENTES CONSOLIDADOS DE LA RED (criterio 3C) ── */
function netTareaSedeNombre(pid) { const s = NET.sedes.find(x => x.id === pid); return s ? s.name.replace('Sede ', '') : pid; }
async function netCargarTareasRed() {
  if (NET.fuente !== 'd1') { NET.tareasRed = { tareas: [], resumen: null }; if (NET.mode === 'red') renderNetworkView(); return; }
  try {
    const resp = await fetch(`${WORKER_URL}/tareas?network_id=${encodeURIComponent(NET.networkId)}`);
    const j = await resp.json();
    NET.tareasRed = { tareas: Array.isArray(j.tareas) ? j.tareas : [], resumen: j.resumen || null };
  } catch (e) { NET.tareasRed = { tareas: [], resumen: null, error: true }; }
  if (NET.mode === 'red') renderNetworkView();
}
function netFiltrarSede(id) { NET.tareaSedeFiltro = id; renderNetworkView(); }
function netAbrirSedeTarea(pid) {
  const i = NET.sedes.findIndex(s => s.id === pid);
  if (i < 0) return;
  setNetworkMode('sede'); selectSede(i);
  const btn = document.getElementById('tab-btn-tareas'); if (btn) switchTab('tareas', btn);
}
function netTareasRedCard() {
  if (NET.tareasRed === null) { setTimeout(netCargarTareasRed, 0); return `<div class="card"><div class="card-title">Pendientes de la red</div><div class="tareas-loading"><div class="spinner" style="width:18px;height:18px;border-width:2px"></div>Cargando tareas…</div></div>`; }
  const r = NET.tareasRed.resumen;
  const abiertas = NET.tareasRed.tareas.filter(t => t.estado === 'pendiente' || t.estado === 'en_proceso');
  const filtro = NET.tareaSedeFiltro || '';
  const vis = filtro ? abiertas.filter(t => t.practice_id === filtro) : abiertas;
  const chips = `<button class="tf-btn${!filtro ? ' active' : ''}" onclick="netFiltrarSede('')">Todas <span class="tf-count">${abiertas.length}</span></button>` +
    NET.sedes.map(s => `<button class="tf-btn${filtro === s.id ? ' active' : ''}" onclick="netFiltrarSede('${s.id}')">${escapeHtml(s.name.replace('Sede ', ''))} <span class="tf-count">${abiertas.filter(t => t.practice_id === s.id).length}</span></button>`).join('');
  const lista = vis.length ? vis.map(t => `
    <div class="tarea-row clickable" role="button" tabindex="0" onclick="netAbrirSedeTarea('${t.practice_id}')">
      <div class="tarea-main">
        <div class="tarea-title">${escapeHtml(t.titulo)}</div>
        <div class="tarea-meta">
          <span class="net-pill blue">${escapeHtml(netTareaSedeNombre(t.practice_id))}</span>
          <span class="tarea-badge prio-${t.prioridad}">${escapeHtml(T_PRIORIDAD_LBL[t.prioridad] || t.prioridad)}</span>
          <span class="tarea-badge">${escapeHtml(T_ASIGNADO_LBL[t.asignado_a] || t.asignado_a)}</span>
          ${t.valor_estimado_cop > 0 ? `<span class="tarea-valor">${fmtCOP(t.valor_estimado_cop)}</span>` : ''}
        </div>
      </div>
      <div class="tarea-chevron" aria-hidden="true">›</div>
    </div>`).join('') : `<div class="tareas-empty">Sin pendientes ${filtro ? 'en esta sede' : 'en la red'}. 🎉</div>`;
  return `<div class="card">
    <div class="card-title">Pendientes de la red <span class="net-hint">clic en una tarea para gestionarla en su sede</span></div>
    <div class="roi-strip" style="margin-bottom:14px">
      <div class="roi-card"><div class="roi-lbl">Recuperado real (semana)</div><div class="roi-val roi-val-money">${fmtCOP(r?.valor_real_cop || 0)}</div><div class="roi-sub">esperado ${fmtCOP(r?.valor_esperado_cop || 0)}</div></div>
      <div class="roi-card"><div class="roi-lbl">Completadas</div><div class="roi-val">${r?.completadas_semana || 0} de ${r?.total_semana || 0}</div><div class="roi-sub">en toda la red</div></div>
      <div class="roi-card${(r?.vencidas_count || 0) > 0 ? ' roi-alert' : ''}"><div class="roi-lbl">Vencidas</div><div class="roi-val">${r?.vencidas_count || 0}</div><div class="roi-sub">requieren atención</div></div>
    </div>
    <div class="tareas-toolbar"><div class="tarea-filters">${chips}</div></div>
    <div class="tareas-list">${lista}</div>
  </div>`;
}

/* ── PROYECCIÓN DE RED CON ESCENARIOS ── */
let NET_FC_CHART = null;
function netForecastSeries() {
  const acc = {};
  NET.sedes.forEach(s => netSedeData(s).forEach(r => { acc[r.month] = (acc[r.month] || 0) + r.collections; }));
  const months = Object.keys(acc).sort();
  return { months, series: months.map(m => acc[m]) };
}
function netForecastFallback(avg, nextMonth, decision) {
  const R = f => Math.round(avg * f / 1e5) * 1e5;
  return {
    next_month: nextMonth,
    decision_context: decision ? `Sobre tu decisión ("${decision}"): con la base de la red (~${netM(avg)}/mes), el margen depende de cerrar la brecha de Kennedy antes de sumar costos fijos.` : `Proyección de panorama general de ${NET.name} (~${netM(avg)}/mes de recaudación consolidada).`,
    pessimistic: { collections: R(0.88), confidence: 72, label: 'Pesimista', driver: 'Ausentismo de Kennedy sin control', factors: ['Kennedy arrastra la red con 16% de ausentismo', 'Menos confirmaciones en temporada baja', 'Cartera sin gestionar en las 4 sedes'], cost_of_inaction: `${netM(avg - R(0.88))} bajo el promedio de la red`, cta: 'Auditar la agenda y confirmación de Kennedy esta semana.' },
    base: { collections: R(1.0), confidence: 68, label: 'Caso Base', driver: 'Se mantiene la tendencia de las 4 sedes', factors: ['Chapinero sostiene el nivel de la red', 'Recall de higiene funcionando', 'Sin cambios de capacidad'], cost_of_inaction: null, cta: 'Sostener el ritmo de recall en toda la red.' },
    optimistic: { collections: R(1.13), confidence: 55, label: 'Optimista', driver: 'Kennedy sube al promedio de la red', factors: ['Kennedy pasa aceptación de 52% a 65%', 'Ausentismo de la red baja hacia 8%', 'Se cobra la cartera pendiente'], cost_of_inaction: null, cta: 'Replicar el guion de Chapinero en Kennedy y Suba.' },
    questions: [{ icon: '🏥', text: '¿Cuánto sube la red si Kennedy llega al promedio?' }, { icon: '📉', text: '¿Qué sede tiene el mayor ausentismo por corregir?' }, { icon: '🎯', text: '¿Cuál es la acción de mayor impacto para la red?' }],
  };
}
async function netForecast() {
  const btn = document.getElementById('net-fc-btn');
  if (btn) { btn.disabled = true; btn.innerHTML = 'Analizando…'; }
  const decision = (document.getElementById('net-fc-decision')?.value || '').trim();
  const { months, series } = netForecastSeries();
  const avg = series.reduce((a, b) => a + b, 0) / (series.length || 1);
  const nd = new Date(); nd.setMonth(nd.getMonth() + 1);
  const nextMonth = nd.toLocaleDateString('es-CO', { month: 'long', year: 'numeric' });
  let r = null;
  if (NET.fuente === 'd1') {
    const prompt = `Eres analista financiero de una RED de ${NET.sedes.length} clínicas dentales colombianas. Proyecta la RECAUDACIÓN CONSOLIDADA de la red para ${nextMonth} en 3 escenarios.

${netContextoRed()}
Promedio mensual de recaudación de la red: ${netM(avg)}.
${decision ? `El dueño evalúa: "${decision}".` : ''}

Responde ÚNICAMENTE con JSON válido: {"next_month":"${nextMonth}","decision_context":"1-2 frases","pessimistic":{"collections":numero,"confidence":72,"label":"Pesimista","driver":"frase corta","factors":["f1","f2","f3"],"cost_of_inaction":"ej: $XM bajo el promedio","cta":"acción"},"base":{"collections":numero,"confidence":68,"label":"Caso Base","driver":"...","factors":["f1","f2","f3"],"cost_of_inaction":null,"cta":"..."},"optimistic":{"collections":numero,"confidence":55,"label":"Optimista","driver":"...","factors":["f1","f2","f3"],"cost_of_inaction":null,"cta":"..."},"questions":[{"icon":"🏥","text":"..."},{"icon":"📉","text":"..."},{"icon":"🎯","text":"..."}]}
Pesimista ~10-15% bajo el promedio, base ~0-5%, optimista ~10-15% arriba. Cita sedes reales (Kennedy, Chapinero). Español, tono colombiano directo.`;
    try {
      const raw = await netFetchIA(prompt, 1200);
      r = JSON.parse(raw.replace(/```json|```/g, '').trim());
      if (!r.base || !r.pessimistic || !r.optimistic) throw new Error('formato');
    } catch (e) { r = null; }
  }
  if (!r) r = netForecastFallback(avg, nextMonth, decision);
  netRenderForecast(r, months, series);
  if (btn) { btn.disabled = false; btn.innerHTML = '↻ Regenerar'; }
}
function netRenderForecast(r, months, series) {
  const cont = document.getElementById('net-fc-result'); if (!cont) return;
  cont.style.display = 'block';
  const scen = [['bad', r.pessimistic], ['base', r.base], ['opt', r.optimistic]];
  const cards = scen.map(([k, s]) => `<div class="fc-scenario sc-${k}">
    <div class="fc-sc-top"><span class="fc-sc-label">${escapeHtml(s.label)}</span><div class="fc-sc-conf"><div class="fc-sc-conf-bar"><div class="fc-sc-conf-fill" style="width:${Number(s.confidence) || 0}%"></div></div>${Number(s.confidence) || 0}%</div></div>
    <div><div class="fc-sc-amount">$${(s.collections / 1e6).toFixed(1)}M</div><div class="fc-sc-period">${escapeHtml(r.next_month)} · red</div></div>
    <div style="font-size:11px;font-weight:600;color:var(--faint);text-transform:uppercase;letter-spacing:.06em">${escapeHtml(s.driver || '')}</div>
    ${s.cost_of_inaction ? `<div class="fc-sc-cost">⚠ ${escapeHtml(s.cost_of_inaction)}</div>` : ''}
    <div class="fc-sc-factors">${(s.factors || []).map(f => `<div class="fc-sc-factor">${escapeHtml(f)}</div>`).join('')}</div>
  </div>`).join('');
  cont.innerHTML = `${r.decision_context ? `<div class="net-fc-context">${escapeHtml(r.decision_context)}</div>` : ''}
    <div class="fc-chart-card" style="margin-bottom:14px"><div style="position:relative;height:200px"><canvas id="net-fc-chart"></canvas></div></div>
    <div class="fc-scenarios" style="display:grid">${cards}</div>`;
  const labels = months.map(m => new Date(m + '-02').toLocaleDateString('es-CO', { month: 'short', year: '2-digit' }));
  const fLabel = r.next_month.split(' ')[0].slice(0, 3);
  const last = series[series.length - 1];
  if (NET_FC_CHART) NET_FC_CHART.destroy();
  NET_FC_CHART = new Chart(document.getElementById('net-fc-chart'), {
    type: 'line',
    data: {
      labels: [...labels, fLabel], datasets: [
        { label: 'Histórico red', data: [...series, null], borderColor: CHART_TEAL, backgroundColor: 'rgba(0,168,139,.08)', tension: .35, fill: true, pointRadius: 3, borderWidth: 2 },
        { label: 'Pesimista', data: [...Array(series.length - 1).fill(null), last, r.pessimistic.collections], borderColor: CHART_RED, borderDash: [3, 3], tension: .2, pointRadius: [...Array(series.length - 1).fill(0), 3, 5], borderWidth: 2 },
        { label: 'Base', data: [...Array(series.length - 1).fill(null), last, r.base.collections], borderColor: CHART_AMBER, borderDash: [8, 5], tension: .2, pointRadius: [...Array(series.length - 1).fill(0), 3, 5], borderWidth: 2 },
        { label: 'Optimista', data: [...Array(series.length - 1).fill(null), last, r.optimistic.collections], borderColor: CHART_GREEN, borderDash: [14, 4], tension: .2, pointRadius: [...Array(series.length - 1).fill(0), 3, 5], borderWidth: 2 },
      ]
    },
    options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, plugins: { legend: { display: true, labels: { font: { size: 10 }, boxWidth: 10 } } }, scales: { x: { ticks: { font: { size: 10 } }, grid: { color: '#21262D' } }, y: { ticks: { font: { size: 10 }, callback: v => '$' + Math.round(v / 1e6) + 'M' }, grid: { color: '#21262D' } } } },
  });
}

/* ── EXPORT CONSOLIDADO DE RED (PDF + Resumen del dueño) ── */
function netResumenDatos() {
  const monthly = netMonthlyCombined();
  const cm = computeMetrics(monthly), hs = computeHealthScore(monthly);
  const filas = NET.sedes.map(s => {
    const m = netSedeMetrics(s), st = benchmarkStates(m), h = computeHealthScore(netSedeData(s));
    return { nombre: s.name.replace('Sede ', ''), m, st, salud: h.total };
  }).sort((a, b) => b.m.totalCollections - a.m.totalCollections);
  const peor = filas.reduce((a, b) => b.salud < a.salud ? b : a);
  const topDoc = NET.sedes.flatMap(s => s.doctors).sort((a, b) => b.production - a.production)[0];
  return { cm, hs, filas, peor, topDoc, r: NET.tareasRed?.resumen, mesLbl: NET.filtroMes ? new Date(NET.filtroMes + '-02').toLocaleDateString('es-CO', { month: 'long', year: 'numeric' }) : `${NET.sedes[0]?.data.length || 12} meses` };
}
function netResumenTexto(d) {
  const cop = v => fmtCOP(v);
  const L = [];
  L.push(`Resumen de red — ${NET.name}`);
  L.push(`${NET.sedes.length} sedes · ${d.mesLbl}`); L.push('');
  L.push(`Salud consolidada: ${d.hs.total}/100 (${d.hs.label})`);
  L.push(`Recaudación: ${cop(d.cm.totalCollections)} · ingreso neto: ${cop(d.cm.totalNetIncome)}`);
  L.push(`Gastos ${d.cm.overheadRate.toFixed(0)}% · aceptación ${Math.round(d.cm.acceptanceRate)}% · ausentismo ${d.cm.noShowRate.toFixed(0)}%`);
  L.push(''); L.push(`Sede que necesita atención: ${d.peor.nombre} (salud ${d.peor.salud}/100)`);
  L.push(''); L.push('Sedes:');
  d.filas.forEach(f => L.push(`- ${f.nombre}: ${cop(f.m.totalCollections)} · gastos ${f.m.overheadRate.toFixed(0)}% · aceptación ${Math.round(f.m.acceptanceRate)}% · ausentismo ${f.m.noShowRate.toFixed(0)}%`));
  if (d.topDoc) { L.push(''); L.push(`Doctor líder: ${d.topDoc.name} (${d.topDoc.sede.replace('Sede ', '')}, ${cop(d.topDoc.production)})`); }
  if (d.r) { L.push(''); L.push(`Pendientes de la red: recuperado real ${cop(d.r.valor_real_cop || 0)} · ${d.r.completadas_semana || 0} de ${d.r.total_semana || 0} completadas${d.r.vencidas_count ? ` · ${d.r.vencidas_count} vencidas` : ''}`); }
  L.push(''); L.push(`Generado por ${NET.name} Intelligence.`);
  return L.join('\n');
}
function abrirResumenRed() {
  const d = netResumenDatos();
  const cop = v => fmtCOP(v);
  const semColor = st => STATE_COLOR[st];
  document.querySelector('.rs-modal-title').textContent = '📄 Resumen de red';
  document.getElementById('resumen-body').innerHTML = `
    <div class="rs-sub">${escapeHtml(NET.name)} · ${NET.sedes.length} sedes · ${d.mesLbl}</div>
    <div class="rs-hero">
      <div class="rs-hero-lbl">Salud consolidada de la red</div>
      <div class="rs-hero-val">${d.hs.total}<span style="font-size:16px;color:var(--muted)">/100</span></div>
      <div class="rs-hero-sub">${d.hs.label} · recaudación ${cop(d.cm.totalCollections)} · ingreso neto ${cop(d.cm.totalNetIncome)}</div>
    </div>
    <div class="rs-stats">
      <div class="rs-stat"><div class="rs-stat-num ${semColor(d.cm.overheadRate < 55 ? 'good' : d.cm.overheadRate < 65 ? 'warn' : 'bad')}">${d.cm.overheadRate.toFixed(0)}%</div><div class="rs-stat-lbl">Gastos · meta &lt;65%</div></div>
      <div class="rs-stat"><div class="rs-stat-num ${semColor(d.cm.acceptanceRate > 65 ? 'good' : d.cm.acceptanceRate > 55 ? 'warn' : 'bad')}">${Math.round(d.cm.acceptanceRate)}%</div><div class="rs-stat-lbl">Aceptación · meta &gt;65%</div></div>
      <div class="rs-stat"><div class="rs-stat-num ${semColor(d.cm.noShowRate < 8 ? 'good' : d.cm.noShowRate < 12 ? 'warn' : 'bad')}">${d.cm.noShowRate.toFixed(0)}%</div><div class="rs-stat-lbl">Ausentismo · meta &lt;12%</div></div>
    </div>
    <div class="rs-section-t">Sede que necesita atención</div>
    <div class="rs-item"><span class="rs-item-dot prio-alta"></span><div><div class="rs-item-t">${escapeHtml(d.peor.nombre)} · salud ${d.peor.salud}/100</div><div class="rs-item-sub">gastos ${d.peor.m.overheadRate.toFixed(0)}% · aceptación ${Math.round(d.peor.m.acceptanceRate)}% · ausentismo ${d.peor.m.noShowRate.toFixed(0)}%</div></div></div>
    <div class="rs-section-t">Todas las sedes</div>
    ${d.filas.map(f => `<div class="rs-item"><span class="rs-item-dot ${f.salud >= 70 ? 'done' : 'prio-media'}"></span><div><div class="rs-item-t">${escapeHtml(f.nombre)}</div><div class="rs-item-sub">${cop(f.m.totalCollections)} · gastos ${f.m.overheadRate.toFixed(0)}% · aceptación ${Math.round(f.m.acceptanceRate)}% · ausentismo ${f.m.noShowRate.toFixed(0)}%</div></div></div>`).join('')}
    ${d.r ? `<div class="rs-section-t">Pendientes de la red</div><div class="rs-item"><span class="rs-item-dot done"></span><div><div class="rs-item-t">Recuperado real ${cop(d.r.valor_real_cop || 0)}</div><div class="rs-item-sub">${d.r.completadas_semana || 0} de ${d.r.total_semana || 0} completadas${d.r.vencidas_count ? ` · ${d.r.vencidas_count} vencidas` : ''}</div></div></div>` : ''}
    <div class="rs-foot">Generado automáticamente por ${escapeHtml(NET.name)} · Intelligence</div>`;
  window.__netResumenTexto = netResumenTexto(d);
  document.getElementById('resumen-msg').textContent = '';
  document.getElementById('resumen-overlay').classList.add('open');
  document.body.style.overflow = 'hidden';
}

/* PDF consolidado de la red — mismo lenguaje visual que el informe de sede. */
function exportRedPDF() {
  const d = netResumenDatos();
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const W = 210, M = 18; let y = 0;
  const C = { teal: [0, 212, 170], dark: [13, 17, 23], surface: [22, 27, 34], text: [230, 237, 243], muted: [125, 133, 144], white: [255, 255, 255], amber: [227, 179, 65], red: [248, 81, 73], green: [63, 185, 80] };
  const rgb = c => doc.setTextColor(c[0], c[1], c[2]), fill = c => doc.setFillColor(c[0], c[1], c[2]);
  const semC = st => st === 'good' ? C.green : st === 'warn' ? C.amber : C.red;
  const cop = v => '$' + (v / 1e6).toFixed(1) + 'M';
  fill(C.dark); doc.rect(0, 0, W, 38, 'F'); fill(C.teal); doc.rect(0, 0, W, 2.5, 'F');
  fill(C.teal); doc.circle(M, 19, 3, 'F');
  rgb(C.white); doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.text(NET.name, M + 7, 16);
  rgb(C.muted); doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.text(`Red de ${NET.sedes.length} sedes · Inteligencia consolidada`, M + 7, 22);
  rgb(C.muted); doc.setFontSize(8); doc.text('Generado el ' + new Date().toLocaleDateString('es-CO', { month: 'long', day: 'numeric', year: 'numeric' }), W - M, 19, { align: 'right' });
  y = 48;
  // KPIs consolidados
  const kpis = [
    { l: 'Salud de la red', v: d.hs.total + '/100', s: d.hs.label },
    { l: 'Recaudación', v: cop(d.cm.totalCollections), s: d.mesLbl },
    { l: 'Ingreso neto', v: cop(d.cm.totalNetIncome), s: (d.cm.totalCollections ? Math.round(d.cm.totalNetIncome / d.cm.totalCollections * 100) : 0) + '% margen' },
    { l: 'Gastos', v: d.cm.overheadRate.toFixed(0) + '%', s: 'Meta: <65%', warn: d.cm.overheadRate >= 65 },
    { l: 'Aceptación', v: Math.round(d.cm.acceptanceRate) + '%', s: 'Meta: >65%', warn: d.cm.acceptanceRate < 65 },
    { l: 'Ausentismo', v: d.cm.noShowRate.toFixed(0) + '%', s: 'Meta: <12%', warn: d.cm.noShowRate >= 12 },
    { l: 'Sede en riesgo', v: d.peor.nombre, s: 'Salud ' + d.peor.salud + '/100', warn: true },
    { l: 'Doctor líder', v: (d.topDoc?.name || '—').replace('Dra. ', '').replace('Dr. ', ''), s: d.topDoc ? cop(d.topDoc.production) : '' },
  ];
  const kW = (W - M * 2 - 9) / 4, kH = 22;
  kpis.forEach((k, i) => {
    const kx = M + (i % 4) * (kW + 3), ky = y + Math.floor(i / 4) * (kH + 4);
    fill(C.surface); doc.roundedRect(kx, ky, kW, kH, 1.5, 1.5, 'F'); fill(k.warn ? C.red : C.teal); doc.rect(kx, ky, kW, 1.5, 'F');
    rgb(C.muted); doc.setFont('helvetica', 'normal'); doc.setFontSize(6.3); doc.text(k.l.toUpperCase(), kx + 4, ky + 7);
    rgb(k.warn ? C.amber : C.white); doc.setFont('helvetica', 'bold'); doc.setFontSize(k.v.length > 9 ? 9 : 12); doc.text(String(k.v), kx + 4, ky + 15);
    rgb(C.muted); doc.setFont('helvetica', 'normal'); doc.setFontSize(6); doc.text(k.s, kx + 4, ky + 20);
  });
  y += kH * 2 + 4 + 12;
  // Tabla comparadora
  rgb(C.muted); doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); doc.text('COMPARATIVA DE SEDES', M, y); y += 4;
  doc.setDrawColor(40, 46, 56); doc.setLineWidth(0.2); doc.line(M, y, W - M, y); y += 6;
  const cols = [M, M + 46, M + 86, M + 120, M + 158];
  rgb(C.muted); doc.setFont('helvetica', 'bold'); doc.setFontSize(6.5);
  ['SEDE', 'RECAUDACIÓN', 'GASTOS', 'AUSENTISMO', 'ACEPTACIÓN'].forEach((h, i) => doc.text(h, cols[i], y));
  y += 5;
  d.filas.forEach(f => {
    rgb(C.text); doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.text(f.nombre, cols[0], y);
    rgb(C.text); doc.setFont('helvetica', 'normal'); doc.text(cop(f.m.totalCollections), cols[1], y);
    rgb(semC(f.st.overhead)); doc.setFont('helvetica', 'bold'); doc.text(f.m.overheadRate.toFixed(1) + '%', cols[2], y);
    rgb(semC(f.st.noShow)); doc.text(f.m.noShowRate.toFixed(1) + '%', cols[3], y);
    rgb(semC(f.st.acceptance)); doc.text(Math.round(f.m.acceptanceRate) + '%', cols[4], y);
    y += 7;
  });
  y += 4;
  // Ranking de doctores
  rgb(C.muted); doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); doc.text('RANKING DE DOCTORES', M, y); y += 4;
  doc.line(M, y, W - M, y); y += 6;
  const docs = NET.sedes.flatMap(s => s.doctors).sort((a, b) => b.production - a.production);
  docs.forEach((dr, i) => {
    rgb(C.muted); doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.text(String(i + 1), M, y);
    rgb(C.text); doc.text(dr.name, M + 6, y);
    rgb(C.muted); doc.setFont('helvetica', 'normal'); doc.text(dr.sede.replace('Sede ', ''), M + 72, y);
    rgb(C.text); doc.text(cop(dr.production), M + 110, y);
    rgb(C.muted); doc.text('aceptación ' + Math.round(dr.acceptance) + '%', M + 138, y);
    y += 6.5;
  });
  // Footer
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) { doc.setPage(p); fill(C.dark); doc.rect(0, 285, W, 12, 'F'); fill(C.teal); doc.rect(0, 285, W, 0.8, 'F'); rgb(C.muted); doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.text(`${NET.name} — Informe consolidado de la red`, M, 291); doc.text(`Página ${p} de ${pages}`, W - M, 291, { align: 'right' }); }
  const slug = NET.name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'Red';
  doc.save(`${slug}_Informe_Red_${new Date().toISOString().slice(0, 10)}.pdf`);
}

/* ── VISTA RED COMPLETA ── */
/* Datos de una sede aplicando el filtro de mes de la vista Red. */
function netSedeData(s) { return NET.filtroMes ? s.data.filter(r => r.month === NET.filtroMes) : s.data; }

/* Filas MENSUALES de la red: suma todas las sedes por mes. Se usa para las
   métricas/salud consolidadas para que computeMetrics use el nº de meses REAL
   (12), no filas×sedes (48). Sin esto, pacientes-nuevos/mes y los activos
   consolidados salían ÷4 (bug de auditoría F1). */
const NET_MCOLS = ['gross_production', 'collections', 'new_patients', 'active_patients', 'appointments_scheduled', 'appointments_completed', 'cancellations', 'no_shows', 'treatment_plans_presented', 'treatment_plans_accepted', 'hygiene_revenue', 'restorative_revenue', 'cosmetic_revenue', 'orthodontic_revenue', 'overhead_costs', 'staff_costs', 'supplies_costs', 'net_income'];
function netMonthlyCombined() {
  const byMonth = {};
  NET.sedes.forEach(s => netSedeData(s).forEach(r => {
    const m = byMonth[r.month] || (byMonth[r.month] = { month: r.month });
    NET_MCOLS.forEach(k => { m[k] = (m[k] || 0) + (Number(r[k]) || 0); });
  }));
  return Object.keys(byMonth).sort().map(k => byMonth[k]);
}

/* Fetch a la API de IA con timeout (evita loading infinito si la API cuelga). */
async function netFetchIA(prompt, maxTokens) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30000);
  try {
    const resp = await fetch(WORKER_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: MODEL_ID, max_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] }), signal: ctrl.signal });
    const j = await resp.json();
    if (j.error) throw new Error(j.error.message || 'API');
    return (j.content || []).map(b => b.text || '').join('');
  } finally { clearTimeout(timer); }
}
function netSedeMetrics(s) { return computeMetrics(netSedeData(s)); }
function netNoShowColor(pct) { return pct < 8 ? 'green' : pct < 12 ? 'amber' : 'red'; }
function netSort(which, key) {
  const st = which === 'comp' ? NET.sortComp : NET.sortDoc;
  if (st && st.key === key) st.dir *= -1;
  else { const s = { key, dir: (key === 'sede' || key === 'name') ? 1 : -1 }; if (which === 'comp') NET.sortComp = s; else NET.sortDoc = s; }
  renderNetworkView();
}
function netSetMes(v) { NET.filtroMes = v; renderNetworkView(); }
function netThSort(which, key, label, meta) {
  const st = which === 'comp' ? NET.sortComp : NET.sortDoc;
  const on = st && st.key === key;
  const ind = on ? (st.dir < 0 ? ' ↓' : ' ↑') : '';
  return `<th class="net-th-sort${on ? ' active' : ''}" onclick="netSort('${which}','${key}')">${label}${meta ? `<span class="net-meta">${meta}</span>` : ''}<span class="net-sort-ind">${ind}</span></th>`;
}

function renderNetworkView() {
  const sedes = NET.sedes;
  if (!NET.sortComp) NET.sortComp = { key: 'recaud', dir: -1 };
  if (!NET.sortDoc) NET.sortDoc = { key: 'production', dir: -1 };

  // Salud consolidada sobre las filas MENSUALES de la red (suma por mes, no
  // filas×sedes) para que meses=12 y pacientes-nuevos/mes salga correcto.
  const monthly = netMonthlyCombined();
  const hs = computeHealthScore(monthly);
  const cm = computeMetrics(monthly);
  const ringOffset = 289 - 289 * hs.total / 100;

  const healthItems = hs.items.map(it => `
    <div class="hs-item">
      <div class="hs-item-head"><span class="hs-item-name">${it.name}</span><span class="hs-item-val ${it.color}">${it.val}</span></div>
      <div class="hs-bar-track"><div class="hs-bar-fill ${it.color}" style="width:${it.score}%"></div></div>
      <div class="hs-item-bench">${it.bench}</div>
    </div>`).join('');

  // Métricas + salud por sede. La sede que necesita atención = menor salud.
  const filas = sedes.map(s => {
    const m = netSedeMetrics(s), h = computeHealthScore(netSedeData(s));
    return { s, m, st: benchmarkStates(m), salud: h.total, sede: s.name.replace('Sede ', ''),
      recaud: m.totalCollections, produccion: m.totalProduction, gastos: m.overheadRate, ausentismo: m.noShowRate, aceptacion: m.acceptanceRate };
  });
  const peor = filas.reduce((a, b) => b.salud < a.salud ? b : a);
  const ck = NET.sortComp.key;
  filas.sort((a, b) => ck === 'sede' ? a.sede.localeCompare(b.sede) * NET.sortComp.dir : (a[ck] - b[ck]) * NET.sortComp.dir);
  const rows = filas.map(f => `<tr${f.s === peor.s ? ' class="net-row-alert"' : ''}>
      <td class="net-sede-name" data-label="Sede">${escapeHtml(f.sede)}<span class="net-sede-city">${escapeHtml(f.s.city)}</span></td>
      <td class="net-num" data-label="Recaudación">${fmtCOP(f.recaud)}</td>
      <td class="net-num" data-label="Producción">${fmtCOP(f.produccion)}</td>
      <td data-label="Gastos"><span class="net-pill ${STATE_COLOR[f.st.overhead]}">${f.gastos.toFixed(1)}%</span></td>
      <td data-label="Ausentismo"><span class="net-pill ${STATE_COLOR[f.st.noShow]}">${f.ausentismo.toFixed(1)}%</span></td>
      <td data-label="Aceptación"><span class="net-pill ${STATE_COLOR[f.st.acceptance]}">${Math.round(f.aceptacion)}%</span></td>
    </tr>`).join('');

  // Ranking de doctores (ordenable por producción / aceptación / ausentismo).
  const docs = sedes.flatMap(s => s.doctors).slice();
  const maxProd = Math.max(...docs.map(d => d.production), 1);
  const dk = NET.sortDoc.key;
  docs.sort((a, b) => (dk === 'name' || dk === 'sede') ? String(a[dk]).localeCompare(String(b[dk])) * NET.sortDoc.dir : (a[dk] - b[dk]) * NET.sortDoc.dir);
  const docRows = docs.map((d, i) => `
    <tr>
      <td class="net-rank" data-label="#">${i + 1}</td>
      <td class="net-doc-name" data-label="Doctor">${escapeHtml(d.name)}</td>
      <td class="net-doc-sede" data-label="Sede">${escapeHtml(d.sede.replace('Sede ', ''))}</td>
      <td class="net-num" data-label="Producción"><div class="net-bar-cell"><span>${fmtCOP(d.production)}</span><div class="net-bar"><div class="net-bar-fill" style="width:${Math.round(d.production / maxProd * 100)}%"></div></div></div></td>
      <td data-label="Aceptación"><span class="net-pill ${netAcceptColor(d.acceptance)}">${Math.round(d.acceptance)}%</span></td>
      <td data-label="Ausentismo"><span class="net-pill ${netNoShowColor(d.ausentismo)}">${Number(d.ausentismo).toFixed(1)}%</span></td>
    </tr>`).join('');

  // Opciones del filtro de mes (a partir de los meses disponibles).
  const meses = (sedes[0]?.data || []).map(r => r.month);
  const mesOpts = ['<option value="">Todos los meses</option>'].concat(meses.map(mo =>
    `<option value="${mo}"${mo === NET.filtroMes ? ' selected' : ''}>${new Date(mo + '-02').toLocaleDateString('es-CO', { month: 'long', year: 'numeric' })}</option>`)).join('');
  const atencionFalla = ['overhead', 'noShow', 'acceptance', 'newPat', 'collection'].filter(k => peor.st[k] === 'bad').length;

  document.getElementById('network-view').innerHTML = `
    <div class="net-filterbar">
      <span class="filter-label">Período</span>
      <select class="nb-sede-select" onchange="netSetMes(this.value)">${mesOpts}</select>
      ${NET.filtroMes ? '<button class="filter-reset" onclick="netSetMes(\'\')">✕ Todos</button>' : ''}
      <div class="net-export-btns">
        <button class="tareas-resumen" onclick="abrirResumenRed()" title="Resumen consolidado de la red">📄 Resumen del dueño</button>
        <button class="tareas-refresh" onclick="exportRedPDF()" title="Exportar informe de red en PDF">⬇ Exportar PDF</button>
      </div>
    </div>
    <div class="net-summary-row">
      <div class="hs-wrap net-health">
        <div class="hs-left">
          <div class="hs-ring-wrap">
            <svg width="110" height="110" viewBox="0 0 110 110">
              <circle cx="55" cy="55" r="46" fill="none" stroke="#21262D" stroke-width="8"/>
              <circle cx="55" cy="55" r="46" fill="none" stroke="${hs.ringColor}" stroke-width="8" stroke-dasharray="289" stroke-dashoffset="${ringOffset}" stroke-linecap="round"/>
            </svg>
            <div class="hs-score-center"><div class="hs-score-num">${hs.total}</div><div class="hs-score-max">/100</div></div>
          </div>
          <div class="hs-label ${hs.labelClass}">${hs.label}</div>
          <div class="net-health-sub">Salud consolidada · ${sedes.length} sedes${NET.filtroMes ? ' · ' + new Date(NET.filtroMes + '-02').toLocaleDateString('es-CO', { month: 'long', year: 'numeric' }) : ''}</div>
        </div>
        <div class="hs-right">${healthItems}</div>
      </div>
      <div class="net-kpi-col">
        <div class="net-attention">
          <div class="net-attention-lbl"><i>⚠</i> Sede que necesita atención</div>
          <div class="net-attention-sede">${escapeHtml(peor.sede)}</div>
          <div class="net-attention-sub">Salud ${peor.salud}/100${atencionFalla ? ' · ' + atencionFalla + ' métrica' + (atencionFalla === 1 ? '' : 's') + ' bajo meta' : ''}</div>
        </div>
        <div class="net-kpi"><div class="net-kpi-lbl">Recaudación de la red</div><div class="net-kpi-val">${fmtCOP(cm.totalCollections)}</div><div class="net-kpi-sub">${NET.filtroMes ? 'el mes seleccionado' : 'últimos ' + (sedes[0]?.data.length || 12) + ' meses'}</div></div>
        <div class="net-kpi"><div class="net-kpi-lbl">Ingreso neto de la red</div><div class="net-kpi-val">${fmtCOP(cm.totalNetIncome)}</div><div class="net-kpi-sub">${cm.totalCollections ? Math.round(cm.totalNetIncome / cm.totalCollections * 100) : 0}% margen</div></div>
      </div>
    </div>

    <div class="card">
      <div class="card-title">Comparativa de sedes <span class="net-hint">toca una columna para ordenar</span></div>
      <div class="net-table-wrap">
        <table class="net-table net-table-cards">
          <thead><tr>
            ${netThSort('comp', 'sede', 'Sede')}
            ${netThSort('comp', 'recaud', 'Recaudación')}
            ${netThSort('comp', 'produccion', 'Producción')}
            ${netThSort('comp', 'gastos', 'Gastos', 'meta &lt;65%')}
            ${netThSort('comp', 'ausentismo', 'Ausentismo', 'meta &lt;12%')}
            ${netThSort('comp', 'aceptacion', 'Aceptación', 'meta &gt;65%')}
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>

    <div class="card">
      <div class="card-title">Ranking de doctores <span class="net-hint">toca una columna para ordenar</span></div>
      <div class="net-table-wrap">
        <table class="net-table net-table-cards">
          <thead><tr>
            <th>#</th>
            ${netThSort('doc', 'name', 'Doctor')}
            ${netThSort('doc', 'sede', 'Sede')}
            ${netThSort('doc', 'production', 'Producción')}
            ${netThSort('doc', 'acceptance', 'Aceptación')}
            ${netThSort('doc', 'ausentismo', 'Ausentismo')}
          </tr></thead>
          <tbody>${docRows}</tbody>
        </table>
      </div>
    </div>

    ${netTareasRedCard()}

    <div class="ai-panel open">
      <div class="ai-panel-header">
        <div class="ai-panel-title"><div class="ai-dot"></div>Análisis Ejecutivo IA — Red</div>
        <button class="ai-btn" id="net-ai-btn" onclick="netRunAnalysis()">
          <svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>
          Analizar con IA
        </button>
      </div>
      <div class="ai-body">
        <div class="ai-empty" id="net-ai-empty"><div class="ai-empty-icon">◈</div>Haz clic en <strong style="color:var(--accent)">Analizar con IA</strong> para el resumen ejecutivo de la red, o pregunta abajo.</div>
        <div class="ai-result" id="net-ai-result" style="display:none"></div>
        <div class="net-ask">
          <div class="net-ask-row">
            <input type="text" id="net-ask-input" class="net-ask-input" placeholder="Pregunta comparativa: ¿qué sede tiene mayor oportunidad en aceptación?" onkeydown="netAskRed(event)">
            <button class="ai-btn" onclick="netAskRed()">Preguntar</button>
          </div>
          <div class="net-ask-chips">
            <button class="fc-ex-chip" onclick="document.getElementById('net-ask-input').value=this.textContent;netAskRed()">¿Qué sede necesita más atención?</button>
            <button class="fc-ex-chip" onclick="document.getElementById('net-ask-input').value=this.textContent;netAskRed()">¿Dónde está la mayor oportunidad de ingresos?</button>
            <button class="fc-ex-chip" onclick="document.getElementById('net-ask-input').value=this.textContent;netAskRed()">¿Qué doctor lidera la red?</button>
          </div>
          <div class="ai-result" id="net-ask-answer" style="display:none;margin-top:12px"></div>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-title">Proyección de red · próximo mes</div>
      <div class="net-fc-bar">
        <input type="text" id="net-fc-decision" class="net-ask-input" placeholder="¿Qué estás evaluando? Ej: abrir una 5ª sede, subir precios de ortodoncia…" onkeydown="if(event.key==='Enter'){event.preventDefault();netForecast();}">
        <button class="ai-btn" id="net-fc-btn" onclick="netForecast()">
          <svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>
          Generar proyección
        </button>
      </div>
      <div class="ai-result" id="net-fc-result" style="display:none;margin-top:14px"></div>
    </div>`;
}
