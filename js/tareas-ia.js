/* ── GENERACIÓN DE TAREAS CON IA (revisión antes de guardar) ──────────────
   Paso 1 de la automatización: reúne las métricas que el dashboard ya calcula,
   le pide a Claude (vía el proxy existente, WORKER_URL) que proponga 3-5 tareas
   de la semana usando TOOL USE (salida estructurada = siempre cumple el schema
   de la tabla `tareas`), las muestra editables, y al aprobar las guarda con
   fuente='ia_semanal'. Humano en el medio a propósito mientras se afina.
   Cargado DESPUÉS de tareas.js (usa sus helpers: tareasLunes, tareasPracticeId,
   T_ADMIN_KEY_STORE, fetchTareas). */

let TIA_PROPUESTAS=[];
let TIA_GENERANDO=false;

const TIA_CAT_OPTS=[
  ['recall_inactivos','Recall inactivos'],
  ['no_shows','No-shows'],
  ['aceptacion_tratamiento','Aceptación de tratamiento'],
  ['seguimiento_post','Seguimiento post-tratamiento'],
  ['otro','Otro']
];

function tiaStatus(html,kind){
  const el=document.getElementById('tia-status');
  if(!el)return;
  el.className='tia-status'+(kind?' tia-'+kind:'');
  el.innerHTML=html;
}

/* Resumen de métricas para el prompt — reusa computeMetrics de metrics.js.
   Usa los datos filtrados actuales (CURRENT_DATA) o, si no hay, todo (ALL). */
function tiaBuildSummary(){
  const data=(typeof CURRENT_DATA!=='undefined'&&CURRENT_DATA.length)?CURRENT_DATA:ALL;
  const m=computeMetrics(data);
  const overhead=Math.round(m.overheadRate),acc=Math.round(m.acceptanceRate),ns=Math.round(m.noShowRate);
  const fmtMonth=mo=>new Date(mo+'-02').toLocaleDateString('es-CO',{month:'long',year:'numeric'});
  const period=data.length?`${fmtMonth(data[0].month)} – ${fmtMonth(data[data.length-1].month)}`:'desconocido';
  const cop=v=>'$'+Math.round(v).toLocaleString('es-CO');
  return `Clínica: ${getWhiteLabel()}
Período: ${period} (${data.length} meses)
Producción bruta: ${cop(m.totalProduction)} COP
Recaudación: ${cop(m.totalCollections)} COP (brecha producida y sin cobrar: ${cop(m.totalProduction-m.totalCollections)})
Ingreso neto: ${cop(m.totalNetIncome)} COP
Tasa de gastos: ${overhead}% (meta <65%)
Pacientes nuevos: ${m.totalNewPat} (~${data.length?Math.round(m.avgNewPatPerMonth):0}/mes) · activos: ${m.activePatients}
Citas: agendadas ${m.totalScheduled}, completadas ${m.totalCompleted}, inasistencias ${m.totalNoShows}
Ausentismo: ${ns}% (meta <12%)
Planes de tratamiento: presentados ${m.totalPlansPresented}, aceptados ${m.totalPlansAccepted}, aceptación ${acc}% (meta >65%)
Ingresos por línea: higiene ${cop(m.hygieneRevenue)}, restaurativa ${cop(m.restorativeRevenue)}, estética ${cop(m.cosmeticRevenue)}, ortodoncia ${cop(m.orthoRevenue)}`;
}

/* Lista de pacientes accionables (excluye los que están al día) para que la IA
   elija de aquí por ID — así no inventa nombres ni teléfonos. */
function tiaPacientesRoster(){
  const acc=(typeof PACIENTES!=='undefined'?PACIENTES:[]).filter(p=>p.motivo&&p.motivo!=='al_dia');
  if(!acc.length)return null;
  return acc.map(p=>`${p.id} | ${p.nombre} | motivo:${p.motivo} | última cita:${p.ultima_consulta||'?'} | qué pasó:${p.que_paso||''} | próximo paso sugerido:${p.proximos_pasos||''} | valor pendiente:$${(p.valor_pendiente_cop||0).toLocaleString('es-CO')}`).join('\n');
}

function tiaProfileText(){
  const p=(typeof PRACTICE_PROFILE!=='undefined')?PRACTICE_PROFILE:null;
  if(!p)return '(sin perfil configurado)';
  const parts=[];
  if(p.location)parts.push('Ubicación: '+p.location);
  if(p.chairs)parts.push('Consultorios: '+p.chairs);
  if(p.doctors)parts.push('Odontólogos: '+p.doctors);
  if(p.insurance&&p.insurance.length)parts.push('Pagadores: '+p.insurance.join(', '));
  if(p.challenge&&p.challenge.length)parts.push('Retos declarados: '+p.challenge.join(', '));
  if(p.goal)parts.push('Meta de ingresos: '+p.goal);
  if(p.notes)parts.push('Notas: '+p.notes);
  return parts.length?parts.join('\n'):'(perfil mínimo)';
}

/* Propuestas DETERMINISTAS para el demo (token-free): mismas reglas metric-driven
   que usaría la IA, con pacientes reales del dataset. Se usan cuando netDemoCache()
   está activo (demo de venta o fallback), para no consumir créditos. */
function tiaDemoPropuestas(){
  const m=computeMetrics(ALL);
  const ov=Math.round(m.overheadRate), ac=Math.round(m.acceptanceRate), ns=Math.round(m.noShowRate);
  const gap=Math.max(0,m.totalProduction-m.totalCollections);
  const pac=(typeof PACIENTES!=='undefined'&&Array.isArray(PACIENTES))?PACIENTES:[];
  const pick=(n,off)=>pac.slice(off,off+n).map(p=>({id:p.id,nombre:p.nombre,telefono:p.telefono,ultima_consulta:p.ultima_consulta,que_paso:p.que_paso,accion:p.proximos_pasos||'Contactar y reagendar',valor_pendiente_cop:Number(p.valor_pendiente_cop)||0}));
  const props=[];
  props.push({titulo:`Gestionar cobro de cartera ($${(gap/1e6).toFixed(1)}M sin cobrar en el período)`,descripcion:'Contactar pacientes con saldos de tratamientos ya realizados; recordatorio y plan de pago.',categoria:'otro',asignado_a:'recepcionista',prioridad:'alta',valor_estimado_cop:Math.round(gap/12/1e5)*1e5,justificacion:`La brecha entre producción y cobro del período es $${(gap/1e6).toFixed(1)}M ya producido.`,_pacientes:pick(3,0)});
  props.push({titulo:'Reactivar pacientes inactivos de alto valor',descripcion:'Llamar a pacientes sin cita en 6+ meses con tratamientos pendientes para recuperar agenda.',categoria:'recall_inactivos',asignado_a:'recepcionista',prioridad:'alta',valor_estimado_cop:3600000,justificacion:'Recuperar inactivos es la vía más rápida de ingresos sin marketing.',_pacientes:pick(3,3)});
  if(ns>=10)props.push({titulo:`Reagendar los no-shows del mes (ausentismo en ${ns}%)`,descripcion:'Reagendar inasistencias y activar confirmación por WhatsApp 24h antes.',categoria:'no_shows',asignado_a:'recepcionista',prioridad:ns>=12?'alta':'media',valor_estimado_cop:2000000,justificacion:`Ausentismo en ${ns}% frente a la meta del sector (<12%).`,_pacientes:pick(2,6)});
  if(ac<68)props.push({titulo:'Re-presentar los planes de tratamiento de mayor valor no aceptados',descripcion:'Re-presentar con simulación y ofrecer financiación a cuotas.',categoria:'aceptacion_tratamiento',asignado_a:'dueno',prioridad:ac<55?'alta':'media',valor_estimado_cop:3400000,justificacion:`Aceptación en ${ac}% frente a la meta (>65%).`,_pacientes:[]});
  if(ov>=65)props.push({titulo:`Revisar la estructura de gastos (${ov}%, meta <65%)`,descripcion:'Comparar personal vs. producción e insumos para bajar la tasa de gastos.',categoria:'otro',asignado_a:'dueno',prioridad:'media',valor_estimado_cop:0,justificacion:`Gastos operativos en ${ov}% frente a la meta (<65%).`,_pacientes:[]});
  return props.slice(0,5);
}

async function generarTareasIA(){
  if(TIA_GENERANDO)return;
  if(typeof ALL==='undefined'||!ALL.length){tiaStatus('⚠ Los datos de la clínica aún no han cargado. Espera un momento y reintenta.','error');return;}
  // Demo de venta (o fallback): propuestas deterministas, sin llamar a la API.
  if(typeof netDemoCache==='function'&&netDemoCache()){
    TIA_PROPUESTAS=tiaDemoPropuestas();
    renderPropuestas();
    tiaStatus('Propuestas de demostración generadas con tus métricas (sin consumir créditos).','');
    return;
  }
  TIA_GENERANDO=true;
  document.getElementById('tia-gen-btn').disabled=true;
  document.getElementById('tia-propuestas').innerHTML='';
  document.getElementById('tia-actions').style.display='none';
  tiaStatus('<span class="tia-spin"></span> Analizando datos y proponiendo tareas…','loading');

  const tool={
    name:'proponer_tareas',
    description:'Registra las tareas operativas propuestas para la semana de la clínica dental.',
    input_schema:{
      type:'object',
      properties:{
        tareas:{
          type:'array',
          description:'Entre 3 y 5 acciones concretas para ESTA semana.',
          items:{
            type:'object',
            properties:{
              titulo:{type:'string',description:'Acción concreta y ejecutable, empieza con un verbo. Máx ~90 caracteres. Ej: "Llamar a los 12 pacientes de higiene sin cita en 8+ meses".'},
              descripcion:{type:'string',description:'1-2 frases con el cómo o el detalle práctico.'},
              categoria:{type:'string',enum:['recall_inactivos','no_shows','aceptacion_tratamiento','seguimiento_post','otro']},
              asignado_a:{type:'string',enum:['dueno','recepcionista'],description:'recepcionista para tareas operativas (llamadas, confirmaciones, recall, cobro); dueno para decisiones estratégicas o revisión de casos de alto valor.'},
              prioridad:{type:'string',enum:['alta','media','baja']},
              valor_estimado_cop:{type:'integer',description:'Valor potencial en COP que se recupera si la acción se concreta. Realista según los números dados. 0 si no aplica.'},
              justificacion:{type:'string',description:'Una frase: por qué esta acción, citando un número real de los datos.'},
              pacientes:{type:'array',description:'Pacientes concretos de la LISTA DE PACIENTES provista que corresponden a esta tarea. Usa solo IDs de esa lista. Déjalo vacío si la tarea no es de contactar pacientes puntuales.',items:{type:'object',properties:{id:{type:'string',description:'ID EXACTO de la lista de pacientes (ej. P003). No inventes IDs.'},accion:{type:'string',description:'Qué hacer específicamente con ESTE paciente (concreto y personalizado a su caso).'}},required:['id','accion']}}
            },
            required:['titulo','descripcion','categoria','asignado_a','prioridad','valor_estimado_cop','justificacion']
          }
        }
      },
      required:['tareas']
    }
  };

  const roster=tiaPacientesRoster();
  const prompt=`Eres un consultor de operaciones para clínicas dentales colombianas. Con base en los datos, propón las 3 a 5 acciones operativas MÁS IMPORTANTES y accionables para ESTA SEMANA. Prioriza lo que mueve ingresos rápido sin atender pacientes nuevos: cerrar la brecha de cobro, recuperar pacientes inactivos, reducir ausentismo y subir la aceptación de tratamientos.

DATOS DE LA CLÍNICA:
${tiaBuildSummary()}

PERFIL DE LA CLÍNICA:
${tiaProfileText()}
${roster?`
LISTA DE PACIENTES (elige de aquí los que van en cada tarea de contacto, usando su ID exacto):
${roster}
`:''}
REFERENCIAS DEL SECTOR (Colombia): gastos operativos <65%, aceptación de tratamientos >65%, ausentismo <12%, pacientes nuevos 20-25+/mes.

Reglas:
- Cada tarea debe ser ejecutable por UNA persona esta semana, no un objetivo vago ("subir la aceptación" no sirve; "re-presentar los 3 planes de mayor valor no aceptados" sí).
- Asigna a 'recepcionista' las llamadas, confirmaciones, recall y gestión de cobro; a 'dueno' las decisiones estratégicas o la revisión de casos de alto valor.
- Estima el valor en COP de forma realista con base en los números dados; no inventes cifras desproporcionadas.${roster?`
- Para las tareas de contacto (recall, no-shows, seguimiento, aceptación), ADJUNTA en 'pacientes' los pacientes concretos de la LISTA DE PACIENTES que correspondan, cada uno con una acción específica a su caso. Usa solo IDs de la lista; agrupa por motivo coherente con la categoría de la tarea.` : ''}
- Redacta en español, tono colombiano directo.

Llama a la herramienta proponer_tareas con las acciones.`;

  try{
    const ctrl=new AbortController();
    const timer=setTimeout(()=>ctrl.abort(),90000);
    let tareas;
    try{
      const resp=await fetch(WORKER_URL,{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({model:MODEL_ID,max_tokens:4000,tools:[tool],tool_choice:{type:'tool',name:'proponer_tareas'},messages:[{role:'user',content:prompt}]}),
        signal:ctrl.signal
      });
      const json=await resp.json();
      if(json.error)throw new Error(json.error.message||'Error de la API de IA');
      const block=(json.content||[]).find(b=>b.type==='tool_use'&&b.name==='proponer_tareas');
      if(!block||!block.input||!Array.isArray(block.input.tareas)){
        if(json.stop_reason==='max_tokens')throw new Error('La respuesta se truncó (demasiadas tareas/pacientes). Reintenta.');
        throw new Error('La IA no devolvió tareas en el formato esperado.');
      }
      tareas=block.input.tareas;
    }finally{clearTimeout(timer);}
    if(!tareas.length)throw new Error('La IA no propuso tareas.');
    // Enriquecer los pacientes elegidos por ID con los datos reales del dataset
    // (nombre/teléfono/contexto los ponemos nosotros; la IA solo eligió id + acción).
    tareas.forEach(t=>{
      t._pacientes=(Array.isArray(t.pacientes)?t.pacientes:[]).map(x=>{
        const p=(typeof PACIENTES!=='undefined'?PACIENTES:[]).find(pp=>pp.id===x.id);
        if(!p)return null;
        return {id:p.id,nombre:p.nombre,telefono:p.telefono,ultima_consulta:p.ultima_consulta,que_paso:p.que_paso,accion:x.accion||p.proximos_pasos||'',valor_pendiente_cop:Number(p.valor_pendiente_cop)||0};
      }).filter(Boolean);
    });
    TIA_PROPUESTAS=tareas.slice(0,5);
    renderPropuestas();
    tiaStatus('','');
  }catch(e){
    tiaStatus('⚠ '+(e.name==='AbortError'?'La generación tardó demasiado. Reintenta.':escapeHtml(e.message)),'error');
  }finally{
    TIA_GENERANDO=false;
    document.getElementById('tia-gen-btn').disabled=false;
  }
}

function tiaOptions(opts,sel){return opts.map(([v,l])=>`<option value="${v}"${v===sel?' selected':''}>${escapeHtml(l)}</option>`).join('');}

function renderPropuestas(){
  const cont=document.getElementById('tia-propuestas');
  cont.innerHTML=TIA_PROPUESTAS.map((t,i)=>`
    <div class="tia-card" data-i="${i}">
      <div class="tia-card-top">
        <label class="tia-inc"><input type="checkbox" class="tia-chk" checked> Incluir</label>
        ${t.justificacion?`<span class="tia-justif">💡 ${escapeHtml(t.justificacion)}</span>`:''}
      </div>
      <input class="tia-f tia-f-titulo" value="${escapeHtml(t.titulo||'')}" maxlength="120" placeholder="Título"/>
      <textarea class="tia-f tia-f-desc" rows="2" maxlength="300" placeholder="Descripción">${escapeHtml(t.descripcion||'')}</textarea>
      <div class="tia-row">
        <label>Categoría<select class="tia-f tia-f-cat">${tiaOptions(TIA_CAT_OPTS,t.categoria)}</select></label>
        <label>Asignado<select class="tia-f tia-f-asig">${tiaOptions([['recepcionista','Recepción'],['dueno','Dueño']],t.asignado_a)}</select></label>
        <label>Prioridad<select class="tia-f tia-f-prio">${tiaOptions([['alta','Alta'],['media','Media'],['baja','Baja']],t.prioridad)}</select></label>
        <label>Valor COP<input type="number" class="tia-f tia-f-valor" min="0" step="1000" value="${Number(t.valor_estimado_cop)||0}"/></label>
      </div>
      ${(t._pacientes&&t._pacientes.length)?`
      <details class="tia-pac">
        <summary>👥 ${t._pacientes.length} paciente${t._pacientes.length===1?'':'s'} adjunto${t._pacientes.length===1?'':'s'}</summary>
        <div class="tia-pac-list">
          ${t._pacientes.map(p=>`<div class="tia-pac-item"><strong>${escapeHtml(p.nombre)}</strong> <span class="tia-pac-tel">${escapeHtml(p.telefono||'')}</span><br><span class="tia-pac-accion">→ ${escapeHtml(p.accion||'')}</span></div>`).join('')}
        </div>
      </details>`:''}
    </div>`).join('');
  document.getElementById('tia-actions').style.display='flex';
  cont.querySelectorAll('.tia-chk').forEach(c=>c.addEventListener('change',updateSaveCount));
  updateSaveCount();
}

function updateSaveCount(){
  const n=document.querySelectorAll('#tia-propuestas .tia-chk:checked').length;
  const b=document.getElementById('tia-save-btn');
  b.textContent=`Guardar ${n} tarea${n===1?'':'s'}`;
  b.disabled=n===0;
}

function descartarPropuestas(){
  TIA_PROPUESTAS=[];
  document.getElementById('tia-propuestas').innerHTML='';
  document.getElementById('tia-actions').style.display='none';
  document.getElementById('tia-save-msg').textContent='';
  tiaStatus('','');
}

async function guardarPropuestas(){
  const clave=document.getElementById('ta-key').value.trim();
  const msg=document.getElementById('tia-save-msg');
  if(!clave){msg.className='tia-save-msg err';msg.textContent='⚠ Ingresa la clave admin arriba.';document.getElementById('ta-key').focus();return;}
  const cards=[...document.querySelectorAll('#tia-propuestas .tia-card')].filter(c=>c.querySelector('.tia-chk').checked);
  if(!cards.length){msg.className='tia-save-msg';msg.textContent='Selecciona al menos una tarea.';return;}
  sessionStorage.setItem(T_ADMIN_KEY_STORE,clave);

  document.getElementById('tia-save-btn').disabled=true;
  document.getElementById('tia-gen-btn').disabled=true;
  msg.className='tia-save-msg';msg.textContent='Guardando…';
  const semana=tareasLunes();
  let ok=0;const errs=[];
  for(const card of cards){
    const idx=Number(card.dataset.i);
    const pacientes=(TIA_PROPUESTAS[idx]&&TIA_PROPUESTAS[idx]._pacientes)||[];
    const body={
      practice_id:tareasPracticeId(),
      semana,
      titulo:card.querySelector('.tia-f-titulo').value.trim(),
      descripcion:card.querySelector('.tia-f-desc').value.trim(),
      categoria:card.querySelector('.tia-f-cat').value,
      asignado_a:card.querySelector('.tia-f-asig').value,
      prioridad:card.querySelector('.tia-f-prio').value,
      valor_estimado_cop:Number(card.querySelector('.tia-f-valor').value)||0,
      fuente:'ia_semanal'
    };
    if(pacientes.length)body.pacientes=pacientes;
    if(!body.titulo){errs.push('una propuesta sin título');continue;}
    try{
      const resp=await fetch(`${WORKER_URL}/tareas`,{method:'POST',headers:{'Content-Type':'application/json','X-Admin-Key':clave},body:JSON.stringify(body)});
      const j=await resp.json().catch(()=>({}));
      if(!resp.ok)throw new Error(j.error||`HTTP ${resp.status}`);
      ok++;
    }catch(e){errs.push(e.message);}
  }
  document.getElementById('tia-gen-btn').disabled=false;
  if(ok){
    descartarPropuestas();
    tiaStatus(`✓ ${ok} tarea${ok===1?'':'s'} creada${ok===1?'':'s'} y agregada${ok===1?'':'s'} al tablero.`+(errs.length?` (${errs.length} con error)`:''),'ok');
    fetchTareas();
  }else{
    document.getElementById('tia-save-btn').disabled=false;
    msg.className='tia-save-msg err';
    msg.textContent='⚠ No se pudo guardar: '+(errs[0]||'error desconocido');
  }
}
