/* ── TAREAS / NOTIFICACIONES / ROI (Fase 2) ──────────────────────────────
   Consume la API de tareas del Worker (rutas /tareas sobre WORKER_URL).
   Tres piezas de UI: campana en el header, tab "Pendientes" y franja ROI.
   Cargado DESPUÉS de main.js (ver index.html) para que el perfil de la
   clínica ya esté aplicado cuando se calcula el practice_id. */

let TAREAS=[],TAREAS_RESUMEN=null,TAREA_FILTRO='todas';
let TAREAS_CARGANDO=false,TAREAS_ERROR=false;
let TAREA_CONFIRMANDO=null; // id de la tarea con el selector de resultado abierto
let TAREA_PATCH_PENDIENTE=false;

const T_PRIORIDAD_LBL={alta:'Alta',media:'Media',baja:'Baja'};
const T_CATEGORIA_LBL={recall_inactivos:'Recall inactivos',no_shows:'No-shows',aceptacion_tratamiento:'Aceptación de tratamiento',seguimiento_post:'Seguimiento post-tratamiento',otro:'Otro'};
const T_ASIGNADO_LBL={dueno:'Dueño',recepcionista:'Recepción'};
const T_RESULTADO_LBL={agendo_cita:'✓ Agendó cita',no_respondio:'No respondió',no_aplicaba:'No aplicaba'};

/* ── helpers ── */
function tareasPracticeId(){
  const slug=getWhiteLabel().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');
  return slug||'smile-dental';
}
function tareasHoy(){
  const d=new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function tareasLunes(){
  const d=new Date();
  d.setDate(d.getDate()-((d.getDay()+6)%7));
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function tareaVencida(t){return !!t.fecha_limite&&t.fecha_limite<tareasHoy()&&tareaAbierta(t);}
function tareaAbierta(t){return t.estado==='pendiente'||t.estado==='en_proceso';}
function fmtFechaCorta(iso){
  try{return new Date(iso+'T00:00:00').toLocaleDateString('es-CO',{day:'numeric',month:'short'});}catch(e){return iso;}
}

/* ── carga ── */
async function fetchTareas(){
  TAREAS_CARGANDO=true;TAREAS_ERROR=false;renderTareasStatus();
  try{
    const resp=await fetch(`${WORKER_URL}/tareas?practice_id=${encodeURIComponent(tareasPracticeId())}`);
    if(!resp.ok)throw new Error(`HTTP ${resp.status}`);
    const json=await resp.json();
    if(!Array.isArray(json.tareas))throw new Error('Respuesta inesperada del servidor');
    TAREAS=json.tareas;
    TAREAS_RESUMEN=json.resumen||null;
    TAREAS_CARGANDO=false;
    renderTareasUI();
  }catch(e){
    TAREAS_CARGANDO=false;TAREAS_ERROR=true;
    renderTareasUI();
  }
}

/* Recalcula el resumen ROI en local tras un PATCH exitoso — evita repetir
   el GET completo. Válido porque el GET inicial trae TODAS las tareas de la
   clínica (sin filtros de estado). */
function recomputarResumen(){
  const semana=TAREAS_RESUMEN?.semana||tareasLunes();
  const sem=TAREAS.filter(t=>t.semana===semana);
  TAREAS_RESUMEN={
    semana,
    total_semana:sem.length,
    completadas_semana:sem.filter(t=>t.estado==='completada').length,
    valor_recuperado_cop:sem.filter(t=>t.estado==='completada'&&t.resultado==='agendo_cita')
      .reduce((s,t)=>s+(Number(t.valor_estimado_cop)||0),0),
    vencidas_count:sem.filter(tareaVencida).length,
  };
}

/* ── render maestro ── */
function renderTareasUI(){
  renderBellBadge();
  renderBellDropdown();
  renderRoi();
  renderTareaFiltros();
  renderTareasStatus();
  renderTareasLista();
}

/* ── a) campana de notificaciones ── */
function renderBellBadge(){
  const badge=document.getElementById('bell-badge');
  if(!badge)return;
  const n=TAREAS.filter(tareaAbierta).length;
  badge.style.display=n>0?'flex':'none';
  badge.textContent=n>9?'9+':String(n);
}

function renderBellDropdown(){
  const list=document.getElementById('bell-dd-list');
  if(!list)return;
  if(TAREAS_ERROR){list.innerHTML=`<div class="bell-dd-empty">⚠ No se pudieron cargar las tareas</div>`;return;}
  // El Worker ya devuelve el orden de urgencia (vencidas → alta > media > baja),
  // así que las 3 primeras abiertas son las 3 más urgentes.
  const top=TAREAS.filter(tareaAbierta).slice(0,3);
  if(!top.length){list.innerHTML=`<div class="bell-dd-empty">🎉 Sin tareas pendientes</div>`;return;}
  list.innerHTML=top.map(t=>`
    <div class="bell-dd-item" onclick="irATareas()">
      <span class="tarea-prio-dot prio-${t.prioridad}"></span>
      <div class="bell-dd-item-main">
        <div class="bell-dd-item-title">${escapeHtml(t.titulo)}</div>
        <div class="bell-dd-item-meta">
          ${tareaVencida(t)?'<span class="tarea-overdue-lbl">Vencida</span> · ':''}
          ${escapeHtml(T_ASIGNADO_LBL[t.asignado_a]||t.asignado_a)} · Prioridad ${escapeHtml(T_PRIORIDAD_LBL[t.prioridad]||t.prioridad)}
        </div>
      </div>
    </div>`).join('');
}

function toggleBellDropdown(e){
  e.stopPropagation();
  document.getElementById('bell-dropdown').classList.toggle('open');
}
document.addEventListener('click',e=>{
  if(!e.target.closest('#bell-wrap'))document.getElementById('bell-dropdown')?.classList.remove('open');
});

function irATareas(){
  document.getElementById('bell-dropdown').classList.remove('open');
  const btn=document.getElementById('tab-btn-tareas');
  if(btn)switchTab('tareas',btn);
}

/* ── c) franja ROI ── */
function renderRoi(){
  const r=TAREAS_RESUMEN;
  const elC=document.getElementById('roi-completadas');
  const elV=document.getElementById('roi-valor');
  const elX=document.getElementById('roi-vencidas');
  if(!elC)return;
  if(!r){elC.textContent='—';elV.textContent='—';elX.textContent='—';return;}
  elC.textContent=`${r.completadas_semana} de ${r.total_semana}`;
  elV.textContent=fmtCOP(r.valor_recuperado_cop||0);
  elX.textContent=String(r.vencidas_count||0);
  document.getElementById('roi-vencidas-card').classList.toggle('roi-alert',(r.vencidas_count||0)>0);
}

/* ── b) tab de pendientes ── */
function setTareaFiltro(filtro,btn){
  TAREA_FILTRO=filtro;
  document.querySelectorAll('.tf-btn').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  renderTareasLista();
}

function renderTareaFiltros(){
  const abiertas=TAREAS.filter(tareaAbierta);
  const set=(id,n)=>{const el=document.getElementById(id);if(el)el.textContent=String(n);};
  set('tf-count-todas',abiertas.length);
  set('tf-count-dueno',abiertas.filter(t=>t.asignado_a==='dueno').length);
  set('tf-count-recepcionista',abiertas.filter(t=>t.asignado_a==='recepcionista').length);
}

function renderTareasStatus(){
  const el=document.getElementById('tareas-status');
  if(!el)return;
  if(TAREAS_CARGANDO){el.innerHTML=`<div class="tareas-loading"><div class="spinner" style="width:18px;height:18px;border-width:2px"></div>Cargando tareas...</div>`;return;}
  if(TAREAS_ERROR){el.innerHTML=`<div class="tareas-error">⚠ No se pudieron cargar las tareas. Verifica que el Worker esté desplegado con la API de tareas. <button class="tareas-retry" onclick="fetchTareas()">Reintentar</button></div>`;return;}
  el.innerHTML='';
}

function renderTareasLista(){
  const el=document.getElementById('tareas-list');
  if(!el)return;
  if(TAREAS_CARGANDO||TAREAS_ERROR){el.innerHTML='';return;}
  const visibles=TAREA_FILTRO==='todas'?TAREAS:TAREAS.filter(t=>t.asignado_a===TAREA_FILTRO);
  if(!visibles.length){
    el.innerHTML=`<div class="tareas-empty">Sin tareas ${TAREA_FILTRO==='todas'?'':'para este responsable '}por ahora.</div>`;
    return;
  }
  el.innerHTML=visibles.map(t=>{
    const done=t.estado==='completada';
    const descartada=t.estado==='descartada';
    const vencida=tareaVencida(t);
    const confirmando=TAREA_CONFIRMANDO===t.id;
    return `
    <div class="tarea-row${done||descartada?' done':''}${vencida?' overdue':''}">
      <button class="tarea-check${done?' checked':''}" ${done||descartada?'disabled':''}
        onclick="abrirConfirmacion(${t.id})" aria-label="Marcar como completada">
        ${done?'<svg width="11" height="11" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>':''}
      </button>
      <div class="tarea-main">
        <div class="tarea-title">${escapeHtml(t.titulo)}</div>
        ${t.descripcion?`<div class="tarea-desc">${escapeHtml(t.descripcion)}</div>`:''}
        <div class="tarea-meta">
          <span class="tarea-badge prio-${t.prioridad}">${escapeHtml(T_PRIORIDAD_LBL[t.prioridad]||t.prioridad)}</span>
          <span class="tarea-badge">${escapeHtml(T_CATEGORIA_LBL[t.categoria]||t.categoria)}</span>
          <span class="tarea-badge">${escapeHtml(T_ASIGNADO_LBL[t.asignado_a]||t.asignado_a)}</span>
          ${t.fecha_limite?`<span class="tarea-badge${vencida?' badge-overdue':''}">${vencida?'⚠ Venció ':'Límite '}${fmtFechaCorta(t.fecha_limite)}</span>`:''}
          ${t.valor_estimado_cop>0?`<span class="tarea-valor">${fmtCOP(t.valor_estimado_cop)}</span>`:''}
          ${done&&t.resultado?`<span class="tarea-resultado">${escapeHtml(T_RESULTADO_LBL[t.resultado]||t.resultado)}</span>`:''}
          ${descartada?`<span class="tarea-badge">Descartada</span>`:''}
        </div>
        ${confirmando?renderConfirmacion(t):''}
      </div>
    </div>`;
  }).join('');
}

/* Mini-selector inline: el checkbox no se "cierra" hasta elegir resultado */
function renderConfirmacion(t){
  return `
  <div class="tarea-confirm" id="tarea-confirm-${t.id}">
    <div class="tarea-confirm-lbl">¿Qué pasó con esta tarea?</div>
    <div class="tarea-confirm-opts">
      <button class="tc-opt" data-resultado="agendo_cita" onclick="elegirResultado(this)">✓ Agendó cita</button>
      <button class="tc-opt" data-resultado="no_respondio" onclick="elegirResultado(this)">No respondió</button>
      <button class="tc-opt" data-resultado="no_aplicaba" onclick="elegirResultado(this)">No aplicaba</button>
    </div>
    <div class="tarea-confirm-row">
      <label class="tarea-confirm-quien">Completada por
        <select id="tc-quien-${t.id}">
          <option value="recepcionista"${t.asignado_a==='recepcionista'?' selected':''}>Recepción</option>
          <option value="dueno"${t.asignado_a==='dueno'?' selected':''}>Dueño</option>
        </select>
      </label>
      <button class="tc-confirm" onclick="confirmarTarea(${t.id})">Confirmar</button>
      <button class="tc-cancel" onclick="cerrarConfirmacion()">Cancelar</button>
    </div>
    <div class="tc-error" id="tc-error-${t.id}"></div>
  </div>`;
}

function abrirConfirmacion(id){
  if(TAREA_PATCH_PENDIENTE)return;
  TAREA_CONFIRMANDO=id;
  renderTareasLista();
  document.getElementById(`tarea-confirm-${id}`)?.scrollIntoView({block:'nearest',behavior:'smooth'});
}
function cerrarConfirmacion(){TAREA_CONFIRMANDO=null;renderTareasLista();}
function elegirResultado(btn){
  btn.closest('.tarea-confirm-opts').querySelectorAll('.tc-opt').forEach(b=>b.classList.remove('selected'));
  btn.classList.add('selected');
  const err=btn.closest('.tarea-confirm').querySelector('.tc-error');
  if(err)err.textContent='';
}

async function confirmarTarea(id){
  const panel=document.getElementById(`tarea-confirm-${id}`);
  const errEl=document.getElementById(`tc-error-${id}`);
  const sel=panel?.querySelector('.tc-opt.selected');
  if(!sel){if(errEl)errEl.textContent='Selecciona qué pasó antes de confirmar.';return;}
  const resultado=sel.dataset.resultado;
  const completadoPor=document.getElementById(`tc-quien-${id}`)?.value||'recepcionista';

  TAREA_PATCH_PENDIENTE=true;
  panel.querySelectorAll('button,select').forEach(b=>b.disabled=true);
  if(errEl)errEl.textContent='Guardando...';
  try{
    const resp=await fetch(`${WORKER_URL}/tareas/${id}`,{
      method:'PATCH',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({estado:'completada',resultado,completado_por:completadoPor}),
    });
    const json=await resp.json().catch(()=>({}));
    if(!resp.ok)throw new Error(json.error||`HTTP ${resp.status}`);
    // Actualiza el estado local — sin repetir el GET completo
    const idx=TAREAS.findIndex(t=>t.id===id);
    if(idx>=0)TAREAS[idx]=json;
    TAREA_CONFIRMANDO=null;TAREA_PATCH_PENDIENTE=false;
    recomputarResumen();
    renderTareasUI();
  }catch(e){
    TAREA_PATCH_PENDIENTE=false;
    panel?.querySelectorAll('button,select').forEach(b=>b.disabled=false);
    if(errEl)errEl.textContent=`⚠ No se pudo guardar: ${e.message}`;
  }
}

/* ── formulario de administración (uso interno) ──────────────────────────
   Visible solo con ?admin en la URL. Pide la ADMIN_KEY una vez y la guarda
   en sessionStorage (se borra al cerrar la pestaña); viaja en el header
   X-Admin-Key — nunca en la URL. */
const T_ADMIN_KEY_STORE='smile_dental_admin_key';
function initTareasAdmin(){
  if(!new URLSearchParams(window.location.search).has('admin'))return;
  const box=document.getElementById('tarea-admin');
  if(!box)return;
  box.style.display='block';
  document.getElementById('ta-semana').value=tareasLunes();
  const saved=sessionStorage.getItem(T_ADMIN_KEY_STORE);
  if(saved)document.getElementById('ta-key').value=saved;
}

async function crearTareaAdmin(){
  const msg=document.getElementById('ta-msg');
  const val=id=>document.getElementById(id).value.trim();
  const clave=val('ta-key');
  const titulo=val('ta-titulo');
  if(!clave){msg.textContent='⚠ Ingresa la clave de administración.';return;}
  if(!titulo){msg.textContent='⚠ El título es requerido.';return;}
  sessionStorage.setItem(T_ADMIN_KEY_STORE,clave);

  const body={
    practice_id:tareasPracticeId(),
    semana:val('ta-semana')||tareasLunes(),
    titulo,
    descripcion:val('ta-desc'),
    categoria:val('ta-categoria'),
    asignado_a:val('ta-asignado'),
    prioridad:val('ta-prioridad'),
    valor_estimado_cop:Number(val('ta-valor'))||0,
    fecha_limite:val('ta-limite')||null,
    fuente:val('ta-fuente'),
  };

  const btn=document.getElementById('ta-crear');
  btn.disabled=true;msg.textContent='Creando...';
  try{
    const resp=await fetch(`${WORKER_URL}/tareas`,{
      method:'POST',
      headers:{'Content-Type':'application/json','X-Admin-Key':clave},
      body:JSON.stringify(body),
    });
    const json=await resp.json().catch(()=>({}));
    if(!resp.ok)throw new Error(json.error||`HTTP ${resp.status}`);
    msg.textContent=`✓ Tarea #${json.id} creada.`;
    document.getElementById('ta-titulo').value='';
    document.getElementById('ta-desc').value='';
    document.getElementById('ta-valor').value='';
    document.getElementById('ta-limite').value='';
    fetchTareas();
  }catch(e){
    msg.textContent=`⚠ ${e.message}`;
  }finally{btn.disabled=false;}
}

/* ── init ── */
initTareasAdmin();
fetchTareas();
