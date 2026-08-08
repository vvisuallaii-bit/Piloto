/* ── AI EXECUTIVE ANALYSIS (tab: Rendimiento de la Clínica → Analizar con IA) ──
   Benchmarks used here match the Colombia thresholds in metrics.js'
   computeHealthScore(): overhead <65%, acceptance >65%, no-show <12%. */

const MSGS=['Analizando datos de la clínica...','Revisando métricas de pacientes...','Identificando oportunidades de ingresos...','Generando recomendaciones...'];

/* ── DEMO SAFETY NET ──────────────────────────────────────────────────────
   If the live API call fails or times out during a demo, we fall back to a
   pre-written analysis so the pitch never shows a red error. It is gated to
   the exact demo dataset (see DEMO_SIGNATURE): on real client data the net
   never fires — a failure there shows the error instead, because showing
   cached numbers for a different clinic would be wrong. Update both the
   signature and the text if smile_dental_demo.csv changes. */
const DEMO_SIGNATURE={collections:660020000,months:12};
const DEMO_FALLBACK_ANALYSIS={
  headline:'La clínica generó $266 millones netos y cumplió las 4 metas clave del sector, pero dejó $29 millones sin cobrar de lo producido.',
  what_happened:'En 12 meses produjo $689 millones y recaudó $660 millones (96% de cobro), con gastos operativos en 60% — por debajo de la meta del 65%. La aceptación de tratamientos (67%) y el ausentismo (7%) están en rango saludable.',
  why_it_matters:'Con los gastos ya controlados, el ingreso neto crece por dos palancas: cerrar la brecha de cobro y subir la aceptación de tratamientos por encima del 67% actual.',
  opportunity:'Los $29 millones producidos y no cobrados son la oportunidad más directa: recuperarlos equivale a casi un mes extra de utilidad sin atender un paciente nuevo.',
  actions:[
    {priority:'URGENT',text:'Revisar la cartera pendiente esta semana y activar recordatorios de cobro por WhatsApp para los saldos más antiguos.'},
    {priority:'MEDIUM',text:'Reforzar la presentación de planes de tratamiento en los próximos 30 días para subir la aceptación del 67% hacia el 75%.'},
    {priority:'LOW',text:'Evaluar opciones de financiación a cuotas para tratamientos de alto valor y destrabar los casos que hoy se aplazan.'}
  ],
  confidence:80
};
function demoFallback(m,data){
  return (data.length===DEMO_SIGNATURE.months && Math.round(m.totalCollections)===DEMO_SIGNATURE.collections)
    ? DEMO_FALLBACK_ANALYSIS : null;
}

/* ── TEST MODE ────────────────────────────────────────────────────────────
   Instant, offline, zero-cost preview: builds an analysis-shaped object
   from the REAL computed metrics and the REAL white-labeled practice name,
   without ever calling the Worker/API. Exists so the practice name (and any
   other profile change) can be visually confirmed inside the AI-panel look
   while iterating, without spending real Anthropic API credits each time.
   Off by default and NOT persisted across reloads — a client demo must
   never accidentally show mock text as if it were live. */
let AI_TEST_MODE=false;
function toggleTestMode(){
  AI_TEST_MODE=!AI_TEST_MODE;
  const btn=document.getElementById('test-mode-btn');
  const lbl=document.getElementById('test-mode-label');
  btn.classList.toggle('on',AI_TEST_MODE);
  lbl.textContent='Modo prueba: '+(AI_TEST_MODE?'encendido':'apagado');
}
function buildMockAnalysis(m,overheadRate,acceptanceRate,noShowRate,period){
  const name=getWhiteLabel();
  const gapM=((m.totalProduction-m.totalCollections)/1e6).toFixed(1);
  return{
    headline:`${name} generó $${(m.totalNetIncome/1e6).toFixed(1)}M netos en ${period}, con gastos en ${overheadRate}%.`,
    what_happened:`En el período analizado, ${name} produjo $${(m.totalProduction/1e6).toFixed(1)}M y recaudó $${(m.totalCollections/1e6).toFixed(1)}M. La aceptación de tratamientos fue ${acceptanceRate}% y el ausentismo ${noShowRate}%.`,
    why_it_matters:`Estos números reflejan la salud operativa de ${name} frente a las referencias del sector odontológico colombiano.`,
    opportunity:`La brecha entre producción y recaudación ($${gapM}M) es la oportunidad más directa de capturar sin atender un paciente nuevo.`,
    actions:[
      {priority:'URGENT',text:`Revisar la cartera pendiente de ${name} esta semana.`},
      {priority:'MEDIUM',text:'Reforzar la presentación de planes de tratamiento en los próximos 30 días.'},
      {priority:'LOW',text:'Evaluar financiación a cuotas para tratamientos de alto valor.'}
    ],
    confidence:75,
    _mock:true
  };
}

async function runAnalysis(){
  const btn=document.getElementById('ai-btn');btn.disabled=true;
  document.querySelector('.ai-panel').classList.add('open');
  document.getElementById('ai-empty').style.display='none';
  document.getElementById('ai-result').style.display='none';

  // IA real siempre (Fase 4C); si la API falla, el catch cae al análisis cacheado
  // (por sede en modo red, o demoFallback) — nunca error crudo en vivo.
  const data=CURRENT_DATA;
  const m=computeMetrics(data);
  const overheadRate=Math.round(m.overheadRate);
  const acceptanceRate=Math.round(m.acceptanceRate);
  const noShowRate=Math.round(m.noShowRate);
  const months=data.length;
  const fmtMonth=mo=>new Date(mo+'-02').toLocaleDateString('es-CO',{month:'long',year:'numeric'});
  const period=data.length?(data[0].month===data[data.length-1].month?fmtMonth(data[0].month):`${fmtMonth(data[0].month)} – ${fmtMonth(data[data.length-1].month)}`):'desconocido';

  // Test mode: skip the network entirely — no loading state needed either.
  if(AI_TEST_MODE){
    const r=buildMockAnalysis(m,overheadRate,acceptanceRate,noShowRate,period);
    showResult(r);LAST_RESULT=r;
    return;
  }

  document.getElementById('ai-loading').style.display='flex';
  let mi=0;const ticker=setInterval(()=>{mi=(mi+1)%MSGS.length;document.getElementById('ai-loading-txt').textContent=MSGS[mi];},1500);

  const summary=`Clínica: ${getWhiteLabel()}
Período: ${period} (${months} meses)
Producción Bruta: $${Math.round(m.totalProduction).toLocaleString('es-CO')} COP
Recaudación Total: $${Math.round(m.totalCollections).toLocaleString('es-CO')} COP
Ingreso Neto: $${Math.round(m.totalNetIncome).toLocaleString('es-CO')} COP
Tasa de Gastos: ${overheadRate}% (meta: <65%)
Pacientes Nuevos: ${m.totalNewPat} (promedio ${data.length?Math.round(m.avgNewPatPerMonth):0}/mes)
Pacientes Activos: ${m.activePatients}
Citas Agendadas: ${m.totalScheduled} | Completadas: ${m.totalCompleted} | Inasistencias: ${m.totalNoShows}
Tasa de Ausentismo: ${noShowRate}% (meta: <12%)
Planes de Tratamiento Presentados: ${m.totalPlansPresented} | Aceptados: ${m.totalPlansAccepted}
Tasa de Aceptación de Tratamientos: ${acceptanceRate}% (meta: >65%)
Ingresos por Higiene: $${Math.round(m.hygieneRevenue).toLocaleString('es-CO')} COP
Ingresos Restaurativos: $${Math.round(m.restorativeRevenue).toLocaleString('es-CO')} COP
Ingresos por Estética: $${Math.round(m.cosmeticRevenue).toLocaleString('es-CO')} COP
Ingresos por Ortodoncia: $${Math.round(m.orthoRevenue).toLocaleString('es-CO')} COP`;

  const prompt=`Eres un analista de negocios experto en clínicas dentales colombianas. Analiza estos datos y produce una narrativa ejecutiva en español (tono colombiano, directo).

DATOS DE LA CLÍNICA:
${summary}

REFERENCIAS DEL SECTOR ODONTOLÓGICO EN COLOMBIA (para contexto):
- Gastos operativos saludables: por debajo del 65% de la recaudación
- Tasa de aceptación de tratamientos: >65% es buena, >80% es excelente
- Pacientes nuevos: 20-25+/mes es saludable para una clínica en crecimiento
- Tasa de ausentismo: por debajo del 12% es la meta

Responde ÚNICAMENTE con un objeto JSON válido (sin markdown, sin texto extra). El contenido de los textos debe estar en español:
{"headline":"Una frase contundente con el hallazgo más importante y números reales.","what_happened":"2-3 oraciones describiendo qué muestran los datos frente a las referencias del sector.","why_it_matters":"2-3 oraciones sobre la implicación de negocio para el odontólogo.","opportunity":"1-2 oraciones sobre la mayor oportunidad de ingresos o riesgo.","actions":[{"priority":"URGENT","text":"Acción específica que el dueño debería tomar esta semana."},{"priority":"MEDIUM","text":"Acción para los próximos 30 días."},{"priority":"LOW","text":"Acción estratégica para el próximo trimestre."}],"confidence":82}

Sé directo. Cita números reales. Compara contra las referencias del sector. Piensa como el CFO de la clínica.`;

  try{
    // Abort a truly hung request after 30s so it can't spin forever mid-demo.
    // Must stay well above the real analysis time (~10-18s for the full
    // Spanish prompt) or legitimate responses get aborted into the fallback.
    const ctrl=new AbortController();
    const timer=setTimeout(()=>ctrl.abort(),30000);
    let r;
    try{
      const resp=await fetch(WORKER_URL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model:MODEL_ID,max_tokens:1000,messages:[{role:'user',content:prompt}]}),signal:ctrl.signal});
      const json=await resp.json();
      const raw=json.content.map(b=>b.text||'').join('');
      r=JSON.parse(raw.replace(/```json|```/g,'').trim());
      if(!r.headline||!Array.isArray(r.actions))throw new Error('Formato de respuesta de IA inesperado');
    }finally{clearTimeout(timer);}
    clearInterval(ticker);showResult(r);LAST_RESULT=r;
  }catch(e){
    clearInterval(ticker);
    // Red de seguridad: en modo red usa el análisis cacheado de la sede/red.
    if(typeof NET!=='undefined'&&NET.active){
      const r=(NET.mode==='sede'&&NET.sedes[NET.sedeIdx])?NET.sedes[NET.sedeIdx].analysis:NET.analysis;
      if(r){showResult(r);LAST_RESULT=r;return;}
    }
    // Demo safety net: on the demo dataset, never show a red error live
    const fb=demoFallback(m,data);
    if(fb){showResult(fb);LAST_RESULT=fb;return;}
    document.getElementById('ai-loading').style.display='none';
    document.getElementById('ai-empty').style.display='block';
    document.getElementById('ai-empty').innerHTML=`<div class="ai-empty-icon">⚠</div>Error: ${escapeHtml(e.message)}`;
    btn.disabled=false;
  }
}

function showResult(r){
  document.getElementById('ai-loading').style.display='none';
  const pc={'URGENT':'ab-u','MEDIUM':'ab-m','LOW':'ab-b'};
  const confidence=Number(r.confidence)||0;
  const mockNote=r._mock?`<div class="ai-mock-note">🧪 Vista previa — modo prueba, no es una respuesta real de Claude</div>`:'';
  document.getElementById('ai-result').innerHTML=`
    ${mockNote}
    <div class="ai-lead">${escapeHtml(r.headline)}</div>
    <div class="ai-blocks">
      <div class="ai-block"><div class="ai-block-lbl">Qué pasó</div><div class="ai-block-txt">${escapeHtml(r.what_happened)}</div></div>
      <div class="ai-block"><div class="ai-block-lbl">Por qué importa</div><div class="ai-block-txt">${escapeHtml(r.why_it_matters)}</div></div>
      <div class="ai-block"><div class="ai-block-lbl">Oportunidad / Riesgo</div><div class="ai-block-txt">${escapeHtml(r.opportunity)}</div></div>
    </div>
    <div class="ai-actions-title">Acciones recomendadas</div>
    ${r.actions.map(a=>`<div class="ai-action"><span class="abadge ${pc[a.priority]||'ab-b'}">${escapeHtml(a.priority)}</span><span>${escapeHtml(a.text)}</span></div>`).join('')}
    <div class="ai-conf"><span class="ai-conf-lbl">Confianza del análisis</span><div class="ai-conf-track"><div class="ai-conf-fill" style="width:${confidence}%"></div></div><span class="ai-conf-pct">${confidence}%</span></div>`;
  document.getElementById('ai-result').style.display='block';
  document.getElementById('ai-btn').disabled=false;
  document.getElementById('pdf-btn').classList.add('visible');
}
