/* ── AI EXECUTIVE ANALYSIS (tab: Rendimiento de la Clínica → Analizar con IA) ──
   Benchmarks used here match the Colombia thresholds in metrics.js'
   computeHealthScore(): overhead <65%, acceptance >65%, no-show <12%. */

const MSGS=['Analizando datos de la clínica...','Revisando métricas de pacientes...','Identificando oportunidades de ingresos...','Generando recomendaciones...'];

async function runAnalysis(){
  const btn=document.getElementById('ai-btn');btn.disabled=true;
  document.getElementById('ai-empty').style.display='none';
  document.getElementById('ai-result').style.display='none';
  document.getElementById('ai-loading').style.display='flex';
  let mi=0;const ticker=setInterval(()=>{mi=(mi+1)%MSGS.length;document.getElementById('ai-loading-txt').textContent=MSGS[mi];},1500);

  const data=CURRENT_DATA;
  const m=computeMetrics(data);
  const overheadRate=Math.round(m.overheadRate);
  const acceptanceRate=Math.round(m.acceptanceRate);
  const noShowRate=Math.round(m.noShowRate);
  const months=data.length;
  const fmtMonth=mo=>new Date(mo+'-02').toLocaleDateString('es-CO',{month:'long',year:'numeric'});
  const period=data.length?`${fmtMonth(data[0].month)} – ${fmtMonth(data[data.length-1].month)}`:'desconocido';

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
    const resp=await fetch(WORKER_URL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model:MODEL_ID,max_tokens:1000,messages:[{role:'user',content:prompt}]})});
    const json=await resp.json();
    const raw=json.content.map(b=>b.text||'').join('');
    const r=JSON.parse(raw.replace(/```json|```/g,'').trim());
    if(!r.headline||!Array.isArray(r.actions))throw new Error('Formato de respuesta de IA inesperado');
    clearInterval(ticker);showResult(r);LAST_RESULT=r;
  }catch(e){
    clearInterval(ticker);
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
  document.getElementById('ai-result').innerHTML=`
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
