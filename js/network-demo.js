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
    return p.get('demo') === 'red' || p.get('red') === 'true';
  })(),
  name: 'Red Dental Sonrisa',
  mode: 'red',        // 'red' = vista consolidada | 'sede' = drill a una sede
  sedeIdx: 0,
  currentName: null,  // lo lee getWhiteLabel() (mayor prioridad en modo red)
  sedes: [],
  analysis: null,     // análisis cacheado de la red
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

function netBuildSedes() {
  NET.sedes = NET_PROFILES.map(p => {
    const data = netBuildData(p);
    const m = computeMetrics(data);
    const annualGross = data.reduce((s, r) => s + r.gross_production, 0);
    const doctors = p.doctors.map(d => ({
      name: d.name, sede: p.name,
      production: Math.round(annualGross * d.share),
      acceptance: Math.round(d.acceptR * 100),
    }));
    return { id: p.id, name: p.name, city: p.city, data, metrics: m, doctors, analysis: NET_SEDE_ANALYSIS[p.id] };
  });
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

/* ── INIT ── */
function initNetworkDemo() {
  netBuildSedes();
  NET.analysis = NET_ANALYSIS;

  // Encabezado / marca de la red (sin romper el white-label existente).
  document.title = `${NET.name} — Intelligence Dashboard`;
  const badge = document.querySelector('.demo-badge');
  if (badge) badge.lastChild.textContent = ' Demo de red — 4 sedes (datos ficticios)';

  // Datos base para el drill/chat/forecast (la primera sede).
  ALL = NET.sedes[0].data;
  CURRENT_DATA = NET.sedes[0].data;
  const sel = document.getElementById('fMonth');
  if (sel) { sel.innerHTML = '<option value="">Todos los meses</option>'; popFilters(); }
  if (typeof initChat === 'function') initChat();

  document.getElementById('loading').style.display = 'none';
  document.getElementById('app').style.display = 'block';

  // Barra de red (toggle Red/Sede + selector de sede).
  const bar = document.getElementById('network-bar');
  bar.innerHTML = `
    <div class="nb-inner">
      <div class="nb-title"><span class="nb-badge">RED</span> <strong>${escapeHtml(NET.name)}</strong> · ${NET.sedes.length} sedes</div>
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

/* Alterna entre la vista consolidada (red) y el drill a una sede. */
function setNetworkMode(mode) {
  NET.mode = mode;
  const red = mode === 'red';
  document.getElementById('nb-seg-red').classList.toggle('active', red);
  document.getElementById('nb-seg-sede').classList.toggle('active', !red);
  document.getElementById('nb-sede-select').style.display = red ? 'none' : '';
  document.getElementById('network-view').style.display = red ? 'block' : 'none';
  document.querySelector('.tab-nav').style.display = red ? 'none' : '';
  document.querySelectorAll('.tab-pane').forEach(p => { p.style.display = red ? 'none' : ''; });
  if (red) {
    NET.currentName = NET.name;
    applyWhiteLabel();
    renderNetworkView();
  } else {
    selectSede(NET.sedeIdx || 0);
  }
}

/* Drill a una sede: reusa el dashboard existente con los datos de esa sede. */
function selectSede(i) {
  NET.sedeIdx = i;
  const s = NET.sedes[i];
  ALL = s.data;
  CURRENT_DATA = s.data;
  NET.currentName = s.name;
  const sel = document.getElementById('nb-sede-select');
  if (sel) sel.selectedIndex = i;
  render(s.data);
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
function netRunAnalysis() {
  document.getElementById('net-ai-empty').style.display = 'none';
  const el = document.getElementById('net-ai-result');
  el.innerHTML = netAnalysisHTML(NET.analysis);
  el.style.display = 'block';
  document.getElementById('net-ai-btn').disabled = true;
}

/* ── VISTA RED COMPLETA ── */
function renderNetworkView() {
  const sedes = NET.sedes;
  // Salud consolidada: se calcula sobre los datos combinados de las 4 sedes.
  const combined = sedes.flatMap(s => s.data);
  const hs = computeHealthScore(combined);
  const cm = computeMetrics(combined);
  const ringOffset = 289 - 289 * hs.total / 100;

  const healthItems = hs.items.map(it => `
    <div class="hs-item">
      <div class="hs-item-head"><span class="hs-item-name">${it.name}</span><span class="hs-item-val ${it.color}">${it.val}</span></div>
      <div class="hs-bar-track"><div class="hs-bar-fill ${it.color}" style="width:${it.score}%"></div></div>
      <div class="hs-item-bench">${it.bench}</div>
    </div>`).join('');

  // Tabla comparadora de sedes (semáforo en gastos/ausentismo/aceptación).
  const rows = sedes.map(s => {
    const m = s.metrics, st = benchmarkStates(m);
    return `<tr>
      <td class="net-sede-name">${escapeHtml(s.name.replace('Sede ', ''))}<span class="net-sede-city">${escapeHtml(s.city)}</span></td>
      <td class="net-num">${fmtCOP(m.totalCollections)}</td>
      <td><span class="net-pill ${STATE_COLOR[st.overhead]}">${m.overheadRate.toFixed(1)}%</span></td>
      <td><span class="net-pill ${STATE_COLOR[st.noShow]}">${m.noShowRate.toFixed(1)}%</span></td>
      <td><span class="net-pill ${STATE_COLOR[st.acceptance]}">${Math.round(m.acceptanceRate)}%</span></td>
    </tr>`;
  }).join('');

  // Ranking de los 8 doctores por producción (aceptación con semáforo).
  const docs = sedes.flatMap(s => s.doctors).sort((a, b) => b.production - a.production);
  const maxProd = docs[0].production;
  const docRows = docs.map((d, i) => `
    <tr>
      <td class="net-rank">${i + 1}</td>
      <td class="net-doc-name">${escapeHtml(d.name)}</td>
      <td class="net-doc-sede">${escapeHtml(d.sede.replace('Sede ', ''))}</td>
      <td class="net-num"><div class="net-bar-cell"><span>${fmtCOP(d.production)}</span><div class="net-bar"><div class="net-bar-fill" style="width:${Math.round(d.production / maxProd * 100)}%"></div></div></div></td>
      <td><span class="net-pill ${netAcceptColor(d.acceptance)}">${d.acceptance}%</span></td>
    </tr>`).join('');

  document.getElementById('network-view').innerHTML = `
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
          <div class="net-health-sub">Salud consolidada · ${sedes.length} sedes</div>
        </div>
        <div class="hs-right">${healthItems}</div>
      </div>
      <div class="net-kpi-col">
        <div class="net-kpi"><div class="net-kpi-lbl">Recaudación de la red</div><div class="net-kpi-val">${fmtCOP(cm.totalCollections)}</div><div class="net-kpi-sub">últimos 12 meses</div></div>
        <div class="net-kpi"><div class="net-kpi-lbl">Ingreso neto de la red</div><div class="net-kpi-val">${fmtCOP(cm.totalNetIncome)}</div><div class="net-kpi-sub">${cm.totalCollections ? Math.round(cm.totalNetIncome / cm.totalCollections * 100) : 0}% margen</div></div>
        <div class="net-kpi"><div class="net-kpi-lbl">Pacientes nuevos / mes</div><div class="net-kpi-val">${Math.round(cm.avgNewPatPerMonth)}</div><div class="net-kpi-sub">sumando las 4 sedes</div></div>
      </div>
    </div>

    <div class="card">
      <div class="card-title">Comparativa de sedes</div>
      <div class="net-table-wrap">
        <table class="net-table">
          <thead><tr><th>Sede</th><th>Recaudación</th><th>Gastos <span class="net-meta">meta &lt;65%</span></th><th>Ausentismo <span class="net-meta">meta &lt;12%</span></th><th>Aceptación <span class="net-meta">meta &gt;65%</span></th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>

    <div class="card">
      <div class="card-title">Ranking de doctores · producción y aceptación</div>
      <div class="net-table-wrap">
        <table class="net-table">
          <thead><tr><th>#</th><th>Doctor</th><th>Sede</th><th>Producción (12m)</th><th>Aceptación</th></tr></thead>
          <tbody>${docRows}</tbody>
        </table>
      </div>
    </div>

    <div class="ai-panel open">
      <div class="ai-panel-header">
        <div class="ai-panel-title"><div class="ai-dot"></div>Análisis Ejecutivo IA — Red</div>
        <button class="ai-btn" id="net-ai-btn" onclick="netRunAnalysis()">
          <svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>
          Analizar con IA
        </button>
      </div>
      <div class="ai-body">
        <div class="ai-empty" id="net-ai-empty"><div class="ai-empty-icon">◈</div>Haz clic en <strong style="color:var(--accent)">Analizar con IA</strong> para el resumen ejecutivo de la red.</div>
        <div class="ai-result" id="net-ai-result" style="display:none"></div>
      </div>
    </div>`;
}
