/* ── TAREAS / NOTIFICACIONES / ROI (Fase 2) ──────────────────────────────
   Consume la API de tareas del Worker (rutas /tareas sobre WORKER_URL).
   Tres piezas de UI: campana en el header, tab "Pendientes" y franja ROI.
   Cargado DESPUÉS de main.js (ver index.html) para que el perfil de la
   clínica ya esté aplicado cuando se calcula el practice_id. */

let TAREAS=[],TAREAS_RESUMEN=null,TAREA_FILTRO='todas';
let TAREAS_CARGANDO=false,TAREAS_ERROR=false;
let TAREA_CONFIRMANDO=null; // (legado) id de la tarea con el selector de resultado abierto
let TAREA_PATCH_PENDIENTE=false;
let TAREA_DETALLE_ID=null; // id de la tarea abierta en la vista de detalle (o null = lista)
let PACIENTES=[]; // base de pacientes (pacientes.json) — para adjuntar listas a tareas

/* Carga la base de pacientes. No bloquea el tablero: si falla, PACIENTES
   queda vacío y la generación con IA simplemente no adjunta pacientes. */
async function loadPacientes(){
  try{
    const resp=await fetch('pacientes.json');
    if(!resp.ok)throw new Error('HTTP '+resp.status);
    const data=await resp.json();
    if(Array.isArray(data))PACIENTES=data;
  }catch(e){PACIENTES=[];}
}

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
    recomputarResumen(); // recalcula el ROI de forma precisa (por paciente) en el cliente
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
    // ROI preciso (por paciente): esperado = lo estimado de quienes agendaron;
    // real = el monto que recepción registró que de verdad entró.
    valor_esperado_cop:sem.reduce((s,t)=>s+valorEsperadoTarea(t),0),
    valor_real_cop:sem.reduce((s,t)=>s+valorRealTarea(t),0),
    valor_recuperado_cop:sem.reduce((s,t)=>s+valorRealTarea(t),0), // compat: ahora = real
    vencidas_count:sem.filter(tareaVencida).length,
  };
}

/* Valor ESPERADO (ROI): lo que la acción debería traer si se concreta. Es la
   estimación — por paciente, el valor pendiente; por tarea sin pacientes, el
   valor estimado — contando solo lo que efectivamente agendó. */
function valorEsperadoTarea(t){
  const ps=Array.isArray(t.pacientes)?t.pacientes:[];
  if(ps.length){
    return ps.filter(p=>p.estado==='agendo_cita').reduce((a,p)=>a+(Number(p.valor_pendiente_cop)||0),0);
  }
  return (t.estado==='completada'&&t.resultado==='agendo_cita')?(Number(t.valor_estimado_cop)||0):0;
}

/* Valor REAL recuperado: el monto que de verdad entró, que registra recepción.
   Por paciente usa monto_real_cop (si aún no lo escribió, cae al esperado);
   por tarea sin pacientes usa valor_real_cop (o el esperado como respaldo). */
function valorRealTarea(t){
  const ps=Array.isArray(t.pacientes)?t.pacientes:[];
  if(ps.length){
    return ps.filter(p=>p.estado==='agendo_cita').reduce((a,p)=>{
      const real=(p.monto_real_cop!==undefined&&p.monto_real_cop!==null)?Number(p.monto_real_cop):Number(p.valor_pendiente_cop);
      return a+(Number(real)||0);
    },0);
  }
  if(t.estado==='completada'&&t.resultado==='agendo_cita'){
    return (t.valor_real_cop!==undefined&&t.valor_real_cop!==null)?(Number(t.valor_real_cop)||0):(Number(t.valor_estimado_cop)||0);
  }
  return 0;
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
  const elVsub=document.getElementById('roi-valor-sub');
  if(!r){elC.textContent='—';elV.textContent='—';elX.textContent='—';if(elVsub)elVsub.textContent='esperado: —';return;}
  elC.textContent=`${r.completadas_semana} de ${r.total_semana}`;
  elV.textContent=fmtCOP(r.valor_real_cop||0);
  if(elVsub)elVsub.textContent=`esperado: ${fmtCOP(r.valor_esperado_cop||0)}`;
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

/* Progreso de contacto de una tarea: cuántos pacientes ya tienen un resultado. */
function tareaProgreso(t){
  const ps=Array.isArray(t.pacientes)?t.pacientes:[];
  const total=ps.length;
  const hechos=ps.filter(p=>p.estado&&p.estado!=='pendiente').length;
  return {total,hechos,pct:total?Math.round(hechos/total*100):0};
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
    const pr=tareaProgreso(t);
    return `
    <div class="tarea-row clickable${done||descartada?' done':''}${vencida?' overdue':''}" role="button" tabindex="0"
      onclick="openTareaDetalle(${t.id})" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();openTareaDetalle(${t.id})}">
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
        ${pr.total?`
        <div class="tarea-prog">
          <div class="tarea-prog-bar"><div class="tarea-prog-fill" style="width:${pr.pct}%"></div></div>
          <span class="tarea-prog-lbl">${pr.hechos}/${pr.total} contactados</span>
        </div>`:''}
      </div>
      <div class="tarea-chevron" aria-hidden="true">›</div>
    </div>`;
  }).join('');
}

/* ── VISTA DETALLE de una tarea: pacientes + barra de progreso + marcado ── */
function mostrarVista(v){
  const l=document.getElementById('vista-lista');
  const d=document.getElementById('vista-detalle');
  if(l)l.style.display=v==='lista'?'':'none';
  if(d)d.style.display=v==='detalle'?'':'none';
}

function openTareaDetalle(id){
  TAREA_DETALLE_ID=id;
  renderTareaDetalle();
  mostrarVista('detalle');
  window.scrollTo({top:0,behavior:'smooth'});
}

function volverALista(){
  TAREA_DETALLE_ID=null;
  mostrarVista('lista');
  renderTareasUI();
}

const P_OPTS=[['agendo_cita','Agendó cita'],['no_respondio','No contestó'],['no_aplicaba','No aplica']];

function renderTareaDetalle(){
  const cont=document.getElementById('vista-detalle');
  if(!cont)return;
  const t=TAREAS.find(x=>x.id===TAREA_DETALLE_ID);
  if(!t){volverALista();return;}
  const done=t.estado==='completada';
  const ps=Array.isArray(t.pacientes)?t.pacientes:[];
  const pr=tareaProgreso(t);
  cont.innerHTML=`
    <button class="td-back" onclick="volverALista()">← Volver a pendientes</button>
    <div class="td-head">
      <div class="td-title">${escapeHtml(t.titulo)}</div>
      <div class="tarea-meta">
        <span class="tarea-badge prio-${t.prioridad}">${escapeHtml(T_PRIORIDAD_LBL[t.prioridad]||t.prioridad)}</span>
        <span class="tarea-badge">${escapeHtml(T_CATEGORIA_LBL[t.categoria]||t.categoria)}</span>
        <span class="tarea-badge">${escapeHtml(T_ASIGNADO_LBL[t.asignado_a]||t.asignado_a)}</span>
        ${t.valor_estimado_cop>0?`<span class="tarea-valor">${fmtCOP(t.valor_estimado_cop)}</span>`:''}
        ${done&&t.resultado?`<span class="tarea-resultado">${escapeHtml(T_RESULTADO_LBL[t.resultado]||t.resultado)}</span>`:''}
      </div>
      ${t.descripcion?`<div class="td-desc">${escapeHtml(t.descripcion)}</div>`:''}
    </div>
    ${done?`<div class="td-done-banner">✓ Tarea completada${t.completado_por?' · por '+escapeHtml(T_ASIGNADO_LBL[t.completado_por]||t.completado_por):''}</div>`:''}
    ${ps.length?`
      <div class="td-progress">
        <div class="td-progress-top"><span>Progreso de contacto</span><span class="td-progress-pct">${pr.hechos} de ${pr.total} contactados · ${pr.pct}%</span></div>
        <div class="td-progress-bar"><div class="td-progress-fill" style="width:${pr.pct}%"></div></div>
      </div>
      <div class="td-pac-list">
        ${ps.map((p,i)=>`
          <div class="td-pac${p.estado&&p.estado!=='pendiente'?' hecho':''}">
            <div class="td-pac-info">
              <div class="td-pac-top">
                <span class="td-pac-nombre">${escapeHtml(p.nombre||'—')}</span>
                ${p.telefono?`<a class="td-pac-tel" href="tel:${escapeHtml(String(p.telefono).replace(/\s+/g,''))}">📞 ${escapeHtml(p.telefono)}</a>`:''}
              </div>
              ${p.accion?`<div class="td-pac-accion">→ ${escapeHtml(p.accion)}</div>`:''}
              ${(p.que_paso||p.ultima_consulta)?`<div class="td-pac-ctx">${p.ultima_consulta?'Última cita '+escapeHtml(fmtFechaCorta(p.ultima_consulta))+': ':''}${escapeHtml(p.que_paso||'')}</div>`:''}
            </div>
            <div class="td-pac-acts">
              ${P_OPTS.map(([v,l])=>`<button class="td-pac-btn${p.estado===v?' sel '+v:''}" ${done?'disabled':''} onclick="marcarPaciente(${i},'${v}')">${l}</button>`).join('')}
            </div>
            ${p.estado==='agendo_cita'?`
            <label class="td-pac-real">
              <span class="td-pac-real-lbl">💵 Monto real recuperado</span>
              <span class="td-pac-real-in">$<input type="number" min="0" step="1000" value="${Number(p.monto_real_cop!=null?p.monto_real_cop:p.valor_pendiente_cop)||0}" ${done?'disabled':''} onchange="setMontoReal(${i},this.value)"></span>
              <span class="td-pac-real-exp">esperado ${fmtCOP(Number(p.valor_pendiente_cop)||0)}</span>
            </label>`:''}
          </div>`).join('')}
      </div>
      ${!done?`<div class="td-actions"><button class="td-complete" onclick="completarTareaDetalle()">Marcar tarea como completada</button><span class="td-save-msg" id="td-save-msg"></span></div>`:''}
    `:(done?'':`
      <div class="td-nopac">
        <div class="td-nopac-lbl">¿Qué pasó con esta tarea?</div>
        <div class="td-pac-acts">
          ${P_OPTS.map(([v,l])=>`<button class="td-pac-btn td-nopac-opt" data-r="${v}" onclick="selNoPac(this)">${l}</button>`).join('')}
        </div>
        <label class="td-pac-real" id="td-nopac-real-wrap" style="display:none">
          <span class="td-pac-real-lbl">💵 Monto real recuperado</span>
          <span class="td-pac-real-in">$<input type="number" id="td-nopac-real" min="0" step="1000" value="${Number(t.valor_estimado_cop)||0}"></span>
          <span class="td-pac-real-exp">esperado ${fmtCOP(Number(t.valor_estimado_cop)||0)}</span>
        </label>
        <div class="td-actions"><button class="td-complete" onclick="completarTareaSinPac()">Completar tarea</button><span class="td-save-msg" id="td-save-msg"></span></div>
      </div>`)}
  `;
}

/* Marca (o desmarca) el resultado de un paciente y lo persiste. Optimista:
   actualiza la vista de una vez y guarda en segundo plano. */
async function marcarPaciente(i,estado){
  const t=TAREAS.find(x=>x.id===TAREA_DETALLE_ID);
  if(!t||!Array.isArray(t.pacientes)||!t.pacientes[i])return;
  const p=t.pacientes[i];
  p.estado=(p.estado===estado)?'pendiente':estado; // toggle
  // Al marcar "agendó" precarga el monto real con el esperado (recepción lo
  // ajusta si volvió por menos); si se desmarca o cambia, se limpia.
  if(p.estado==='agendo_cita'){
    if(p.monto_real_cop===undefined||p.monto_real_cop===null)p.monto_real_cop=Number(p.valor_pendiente_cop)||0;
  }else{
    delete p.monto_real_cop;
  }
  renderTareaDetalle();
  await guardarPacientes(t);
}

/* Registra el monto REAL que trajo un paciente (input en la vista detalle).
   No re-renderiza para no perder el foco del campo; guarda en segundo plano. */
async function setMontoReal(i,val){
  const t=TAREAS.find(x=>x.id===TAREA_DETALLE_ID);
  if(!t||!Array.isArray(t.pacientes)||!t.pacientes[i])return;
  t.pacientes[i].monto_real_cop=Math.max(0,Math.round(Number(val)||0));
  await guardarPacientes(t);
}

/* PATCH de la lista de pacientes; sube la tarea a 'en_proceso' si estaba
   pendiente. Optimista: la vista ya se actualizó, esto persiste. */
async function guardarPacientes(t){
  try{
    const body={pacientes:t.pacientes};
    if(t.estado==='pendiente')body.estado='en_proceso';
    const resp=await fetch(`${WORKER_URL}/tareas/${t.id}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const j=await resp.json().catch(()=>({}));
    if(!resp.ok)throw new Error(j.error||`HTTP ${resp.status}`);
    const idx=TAREAS.findIndex(x=>x.id===t.id);if(idx>=0)TAREAS[idx]=j;
    renderBellBadge();renderBellDropdown();
  }catch(e){
    const m=document.getElementById('td-save-msg');
    if(m){m.className='td-save-msg err';m.textContent='⚠ No se guardó el cambio: '+e.message;}
  }
}

/* Deriva el resultado de la tarea a partir de los pacientes: si al menos uno
   agendó cita, la tarea cuenta como "agendó cita" para el ROI. */
async function completarTareaDetalle(){
  const t=TAREAS.find(x=>x.id===TAREA_DETALLE_ID);if(!t)return;
  const ps=Array.isArray(t.pacientes)?t.pacientes:[];
  const resultado=ps.some(p=>p.estado==='agendo_cita')?'agendo_cita':ps.some(p=>p.estado==='no_respondio')?'no_respondio':'no_aplicaba';
  const m=document.getElementById('td-save-msg');if(m){m.className='td-save-msg';m.textContent='Guardando…';}
  try{
    const resp=await fetch(`${WORKER_URL}/tareas/${t.id}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({estado:'completada',resultado,completado_por:t.asignado_a,pacientes:ps})});
    const j=await resp.json().catch(()=>({}));
    if(!resp.ok)throw new Error(j.error||`HTTP ${resp.status}`);
    const idx=TAREAS.findIndex(x=>x.id===t.id);if(idx>=0)TAREAS[idx]=j;
    recomputarResumen();volverALista();
  }catch(e){if(m){m.className='td-save-msg err';m.textContent='⚠ '+e.message;}}
}

function selNoPac(btn){
  btn.closest('.td-pac-acts').querySelectorAll('.td-nopac-opt').forEach(b=>b.classList.remove('sel'));
  btn.classList.add('sel');
  // El campo de monto real solo tiene sentido si la tarea trajo una cita.
  const wrap=document.getElementById('td-nopac-real-wrap');
  if(wrap)wrap.style.display=btn.dataset.r==='agendo_cita'?'':'none';
}
async function completarTareaSinPac(){
  const t=TAREAS.find(x=>x.id===TAREA_DETALLE_ID);if(!t)return;
  const sel=document.querySelector('#vista-detalle .td-nopac-opt.sel');
  const m=document.getElementById('td-save-msg');
  if(!sel){if(m){m.className='td-save-msg err';m.textContent='Selecciona qué pasó.';}return;}
  const body={estado:'completada',resultado:sel.dataset.r,completado_por:t.asignado_a};
  if(sel.dataset.r==='agendo_cita'){
    const inp=document.getElementById('td-nopac-real');
    body.valor_real_cop=Math.max(0,Math.round(Number(inp&&inp.value)||0));
  }
  if(m){m.className='td-save-msg';m.textContent='Guardando…';}
  try{
    const resp=await fetch(`${WORKER_URL}/tareas/${t.id}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const j=await resp.json().catch(()=>({}));
    if(!resp.ok)throw new Error(j.error||`HTTP ${resp.status}`);
    const idx=TAREAS.findIndex(x=>x.id===t.id);if(idx>=0)TAREAS[idx]=j;
    recomputarResumen();volverALista();
  }catch(e){if(m){m.className='td-save-msg err';m.textContent='⚠ '+e.message;}}
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

/* ── RESUMEN SEMANAL DEL DUEÑO ───────────────────────────────────────────
   Lo que el dueño vería en el correo semanal (por ahora se ve en la app y se
   puede copiar para enviar por correo/WhatsApp). Todo se calcula del lado del
   cliente a partir de las tareas de la semana en curso. */
function buildResumenDueno(){
  const semana=TAREAS_RESUMEN?.semana||tareasLunes();
  const sem=TAREAS.filter(t=>t.semana===semana);
  const completadas=sem.filter(t=>t.estado==='completada');
  const pendientes=sem.filter(tareaAbierta);
  let contactados=0,totalPac=0,agendaron=0;
  sem.forEach(t=>{const ps=Array.isArray(t.pacientes)?t.pacientes:[];totalPac+=ps.length;contactados+=ps.filter(p=>p.estado&&p.estado!=='pendiente').length;agendaron+=ps.filter(p=>p.estado==='agendo_cita').length;});
  return {
    semana,total:sem.length,completadas,pendientes,
    valorReal:sem.reduce((s,t)=>s+valorRealTarea(t),0),
    valorEsperado:sem.reduce((s,t)=>s+valorEsperadoTarea(t),0),
    contactados,totalPac,agendaron,
    vencidas:sem.filter(tareaVencida).length,
  };
}

function abrirResumen(){
  const r=buildResumenDueno();
  const nombre=getWhiteLabel();
  const body=document.getElementById('resumen-body');
  const pacLine=r.totalPac?`<div class="rs-stat"><div class="rs-stat-num">${r.contactados}<span class="rs-stat-den">/${r.totalPac}</span></div><div class="rs-stat-lbl">Pacientes contactados</div></div>`:'';
  body.innerHTML=`
    <div class="rs-sub">Semana del ${fmtDate(r.semana)}</div>
    <div class="rs-hero">
      <div class="rs-hero-lbl">Recuperado real esta semana</div>
      <div class="rs-hero-val">${fmtCOP(r.valorReal||0)}</div>
      <div class="rs-hero-sub">de ${fmtCOP(r.valorEsperado||0)} esperado · ${r.agendaron} cita${r.agendaron===1?'':'s'} agendada${r.agendaron===1?'':'s'}</div>
    </div>
    <div class="rs-stats">
      <div class="rs-stat"><div class="rs-stat-num">${r.completadas.length}<span class="rs-stat-den">/${r.total}</span></div><div class="rs-stat-lbl">Tareas completadas</div></div>
      ${pacLine}
      <div class="rs-stat${r.vencidas>0?' rs-alert':''}"><div class="rs-stat-num">${r.vencidas}</div><div class="rs-stat-lbl">Vencidas</div></div>
    </div>
    ${r.completadas.length?`<div class="rs-section-t">Lo que se logró</div>${r.completadas.map(t=>{
      const v=valorRealTarea(t);
      const ps=Array.isArray(t.pacientes)?t.pacientes:[];
      const cont=ps.filter(p=>p.estado&&p.estado!=='pendiente').length;
      return `<div class="rs-item"><span class="rs-item-dot done"></span><div><div class="rs-item-t">${escapeHtml(t.titulo)}</div><div class="rs-item-sub">${v>0?fmtCOP(v)+' · ':''}${ps.length?cont+' de '+ps.length+' contactados':escapeHtml(T_RESULTADO_LBL[t.resultado]||'')}</div></div></div>`;
    }).join('')}`:''}
    ${r.pendientes.length?`<div class="rs-section-t">Pendiente para esta semana</div>${r.pendientes.map(t=>{
      const ps=Array.isArray(t.pacientes)?t.pacientes:[];
      const falta=ps.filter(p=>!p.estado||p.estado==='pendiente').length;
      return `<div class="rs-item"><span class="rs-item-dot prio-${t.prioridad}"></span><div><div class="rs-item-t">${escapeHtml(t.titulo)}</div><div class="rs-item-sub">${escapeHtml(T_ASIGNADO_LBL[t.asignado_a]||t.asignado_a)}${ps.length?' · '+falta+' pacientes por contactar':''}</div></div></div>`;
    }).join('')}`:''}
    <div class="rs-foot">Generado automáticamente por ${escapeHtml(nombre)} · Intelligence</div>`;
  document.getElementById('resumen-msg').textContent='';
  document.getElementById('resumen-overlay').classList.add('open');
  document.body.style.overflow='hidden';
}
function cerrarResumen(){document.getElementById('resumen-overlay').classList.remove('open');document.body.style.overflow='';}
function resumenOverlayClick(e){if(e.target===document.getElementById('resumen-overlay'))cerrarResumen();}

function resumenTexto(){
  const r=buildResumenDueno();const nombre=getWhiteLabel();
  const L=[];
  L.push(`Resumen semanal — ${nombre}`);
  L.push(`Semana del ${fmtDate(r.semana)}`);
  L.push('');
  L.push(`Recuperado real: ${fmtCOP(r.valorReal||0)} (esperado: ${fmtCOP(r.valorEsperado||0)})`);
  L.push(`Tareas completadas: ${r.completadas.length} de ${r.total}`);
  if(r.totalPac)L.push(`Pacientes contactados: ${r.contactados} de ${r.totalPac} (agendaron: ${r.agendaron})`);
  if(r.vencidas>0)L.push(`Vencidas: ${r.vencidas}`);
  if(r.completadas.length){L.push('');L.push('Lo que se logró:');r.completadas.forEach(t=>{const v=valorRealTarea(t);L.push(`- ${t.titulo}${v>0?' ('+fmtCOP(v)+')':''}`);});}
  if(r.pendientes.length){L.push('');L.push('Pendiente:');r.pendientes.forEach(t=>{L.push(`- ${t.titulo} (${T_ASIGNADO_LBL[t.asignado_a]||t.asignado_a})`);});}
  L.push('');L.push(`Generado por ${nombre} Intelligence.`);
  return L.join('\n');
}
async function copiarResumen(){
  const msg=document.getElementById('resumen-msg');
  try{await navigator.clipboard.writeText(resumenTexto());msg.textContent='✓ Copiado — pégalo en un correo o WhatsApp.';}
  catch(e){msg.textContent='No se pudo copiar automáticamente.';}
}

/* ── init ── */
initTareasAdmin();
loadPacientes();
fetchTareas();
