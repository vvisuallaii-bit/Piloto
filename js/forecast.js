/* ── REVENUE FORECAST (tab: Proyección) ── */

/* Rellena el campo de decisión con una idea de ejemplo (sigue siendo editable). */
function fillDecision(txt){
  const el=document.getElementById('fc-decision');
  if(!el)return;
  el.value=txt;
  el.focus();
}

/* La decisión que evalúa el dueño, en sus propias palabras (texto libre). */
function fcDecisionText(){
  return (document.getElementById('fc-decision')?.value||'').trim();
}

async function generateForecast(){
  if(!ALL.length)return;
  // Demo de red: proyección determinista con los datos reales de la sede (sin API).
  if(typeof NET!=='undefined'&&NET.active){ netDemoGenerateForecast(); return; }
  const btn=document.getElementById('fc-gen-btn');
  btn.disabled=true;btn.innerHTML='<svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg> Analizando...';

  const decisionText=fcDecisionText();
  const decisionDesc=decisionText||'un panorama general de la clínica (el dueño no especificó una decisión puntual)';
  const dataCtx=buildForecastDataContext();
  const nextMonthDate=new Date();
  nextMonthDate.setMonth(nextMonthDate.getMonth()+1);
  const nextMonth=nextMonthDate.toLocaleDateString('es-CO',{month:'long',year:'numeric'});

  const prompt=`Eres un analista financiero especializado en clínicas dentales colombianas. Analiza los datos históricos y genera una proyección para el próximo mes (${nextMonth}).

El dueño está evaluando esta decisión, escrita en sus propias palabras:
"${decisionDesc}"

Toma esa decisión en serio y adáptala a ESTA clínica: los 3 escenarios, el "decision_context", los factores, los CTA y las preguntas de seguimiento deben estar directamente relacionados con lo que el dueño escribió (si mencionó contratar, un costo, un precio, un horario, etc., razona su impacto concreto en la recaudación con los números reales). Si el texto es vago o general, haz una proyección de panorama general.

${dataCtx}

ESTACIONALIDAD DENTAL COLOMBIA:
- Enero/Febrero: lentos (inicio de año, ajuste presupuestal familias)
- Marzo-Mayo: recuperación (rutinas, primas de servicios)
- Junio-Julio: moderado (vacaciones mitad de año)
- Agosto-Octubre: fuerte (regreso a clases, primas de mitad de año)
- Noviembre-Diciembre: fuerte (primas fin de año, bonos)

Aplica estacionalidad de ${nextMonth}. Usa COP para todos los valores.

Responde ÚNICAMENTE con JSON válido, sin markdown:
{
  "next_month": "${nextMonth}",
  "decision_context": "1-2 oraciones sobre como la decision afecta estas proyecciones",
  "pessimistic": {
    "collections": 45000000,
    "confidence": 72,
    "label": "Pesimista",
    "driver": "Frase corta del riesgo principal",
    "factors": ["Por que podria ocurrir", "Factor 2", "Factor 3"],
    "cost_of_inaction": "ej: $8.2M COP por debajo de tu promedio mensual",
    "cta": "Una accion especifica para evitar este escenario"
  },
  "base": {
    "collections": 52000000,
    "confidence": 68,
    "label": "Caso Base",
    "driver": "Frase corta del supuesto principal",
    "factors": ["Que impulsa este escenario", "Factor 2", "Factor 3"],
    "cost_of_inaction": null,
    "cta": "Una accion para mantener esta trayectoria"
  },
  "optimistic": {
    "collections": 61000000,
    "confidence": 55,
    "label": "Optimista",
    "driver": "Que tiene que salir bien",
    "factors": ["Que necesita pasar", "Accion 2", "Accion 3"],
    "cost_of_inaction": null,
    "cta": "Una accion concreta para tomar ESTA SEMANA"
  },
  "questions": [
    {"icon":"🤔","text":"Pregunta de seguimiento específica a la decisión que escribió el dueño"},
    {"icon":"📉","text":"Pregunta sobre una palanca de sus datos (ausentismo, aceptación, cobro)"},
    {"icon":"📆","text":"¿Que semana de ${nextMonth} debo presionar mas en agendamiento?"},
    {"icon":"🎯","text":"¿Cual es mi accion de mayor impacto para ${nextMonth}?"}
  ]
}

Las 4 "questions" deben ser preguntas reales y accionables: la primera y la segunda ligadas a la decisión que escribió el dueño y a sus números; usa un emoji adecuado en cada icon.

Promedio mensual: $${Math.round(ALL.reduce((s,r)=>s+r.collections,0)/ALL.length).toLocaleString('es-CO')} COP. Pesimista ~10-18% por debajo, base ~0-8% de la tendencia, optimista ~8-18% por encima. Ajusta por estacionalidad de ${nextMonth}.`;

  try{
    const resp=await fetch(WORKER_URL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model:MODEL_ID,max_tokens:1500,messages:[{role:'user',content:prompt}]})});
    const json=await resp.json();
    const raw=json.content.map(b=>b.text||'').join('');
    const r=JSON.parse(raw.replace(/```json|```/g,'').trim());
    if(!r.base||!r.pessimistic||!r.optimistic)throw new Error('Formato de respuesta de proyección inesperado');
    FC_RESULT=r;
    renderForecast(r);
  }catch(e){
    alert('Error en la proyección: '+e.message);
  }
  btn.disabled=false;
  btn.innerHTML='<svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg> Regenerar';
}

function renderForecast(r){
  // Show legend items
  ['fc-leg-bad','fc-leg-base','fc-leg-opt'].forEach(id=>document.getElementById(id).style.display='flex');

  // Chart
  const data=ALL;
  const months=data.map(d=>new Date(d.month+'-02').toLocaleDateString('es-CO',{month:'short',year:'2-digit'}));
  const historical=data.map(d=>d.collections);
  const lastVal=historical[historical.length-1];
  // Forecast points: last historical + 3 scenarios as the next point
  const fLabel=r.next_month.split(' ')[0].slice(0,3)+' '+r.next_month.split(' ')[1].slice(2);
  const allLabels=[...months,fLabel];

  if(FC_CHART){FC_CHART.destroy();}
  document.getElementById('fc-chart-empty').style.display='none';
  const canvas=document.getElementById('fc-chart');
  canvas.style.display='block';

  FC_CHART=new Chart(canvas,{
    type:'line',
    data:{
      labels:allLabels,
      // Scenario lines get DISTINCT dash patterns on top of color — red vs
      // green alone is not distinguishable for red-green colorblind users.
      datasets:[
        {
          label:'Histórico',
          data:[...historical,null],
          borderColor:CHART_TEAL,backgroundColor:'rgba(0,168,139,0.08)',
          tension:0.35,fill:true,pointRadius:3,pointBackgroundColor:CHART_TEAL,borderWidth:2
        },
        {
          label:'Pesimista',
          data:[...Array(historical.length-1).fill(null),lastVal,r.pessimistic.collections],
          borderColor:CHART_RED,backgroundColor:'transparent',
          borderDash:[3,3],tension:0.2,pointRadius:[...Array(historical.length-1).fill(0),3,5],
          pointBackgroundColor:CHART_RED,borderWidth:2
        },
        {
          label:'Base',
          data:[...Array(historical.length-1).fill(null),lastVal,r.base.collections],
          borderColor:CHART_AMBER,backgroundColor:'transparent',
          borderDash:[8,5],tension:0.2,pointRadius:[...Array(historical.length-1).fill(0),3,5],
          pointBackgroundColor:CHART_AMBER,borderWidth:2
        },
        {
          label:'Optimista',
          data:[...Array(historical.length-1).fill(null),lastVal,r.optimistic.collections],
          borderColor:CHART_GREEN,backgroundColor:'transparent',
          borderDash:[14,4],tension:0.2,pointRadius:[...Array(historical.length-1).fill(0),3,5],
          pointBackgroundColor:CHART_GREEN,borderWidth:2
        }
      ]
    },
    options:{
      responsive:true,maintainAspectRatio:false,
      interaction:{mode:'index',intersect:false},
      plugins:{legend:{display:false},tooltip:{callbacks:{label:ctx=>`${ctx.dataset.label}: $${Math.round(ctx.raw||0).toLocaleString('es-CO')}`}}},
      scales:{
        x:{ticks:{font:{size:10}},grid:{color:'#21262D'}},
        y:{ticks:{font:{size:10},callback:v=>'$'+Math.round(v/1e6)+'M'},grid:{color:'#21262D'}}
      }
    }
  });

  // Scenario cards
  const scContainer=document.getElementById('fc-scenarios');
  scContainer.style.display='grid';
  const scenarios=[
    {key:'sc-bad',data:r.pessimistic},
    {key:'sc-base',data:r.base},
    {key:'sc-opt',data:r.optimistic}
  ];
  scContainer.innerHTML=scenarios.map(({key,data:s})=>`
    <div class="fc-scenario ${key}">
      <div class="fc-sc-top">
        <span class="fc-sc-label">${escapeHtml(s.label)}</span>
        <div class="fc-sc-conf">
          <div class="fc-sc-conf-bar"><div class="fc-sc-conf-fill" style="width:${Number(s.confidence)||0}%"></div></div>
          ${Number(s.confidence)||0}%
        </div>
      </div>
      <div>
        <div class="fc-sc-amount">$${(s.collections/1e6).toFixed(1)}M</div>
        <div class="fc-sc-period">${escapeHtml(r.next_month)} proyección</div>
      </div>
      <div style="font-size:11px;font-weight:600;color:var(--faint);text-transform:uppercase;letter-spacing:.06em">${escapeHtml(s.driver)}</div>
      ${s.cost_of_inaction?`<div class="fc-sc-cost">⚠ ${escapeHtml(s.cost_of_inaction)}</div>`:''}
      <div class="fc-sc-factors">${s.factors.map(f=>`<div class="fc-sc-factor">${escapeHtml(f)}</div>`).join('')}</div>
      <button class="fc-sc-btn" onclick="askForecastQuestion('${s.cta.replace(/'/g,"\\'")}','${s.label.replace(/'/g,"\\'")} action')">
        <svg width="11" height="11" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>
        ${escapeHtml(s.cta)}
      </button>
    </div>`).join('');

  // Decision context note
  if(r.decision_context){
    const note=document.createElement('div');
    note.style.cssText='background:rgba(56,139,253,.07);border:1px solid rgba(56,139,253,.2);border-radius:8px;padding:12px 16px;font-size:12px;color:var(--muted);line-height:1.6;margin-bottom:16px';
    const decLbl=fcDecisionText()||'Panorama general';
    note.innerHTML=`<span style="color:var(--blue);font-weight:600;font-size:10px;text-transform:uppercase;letter-spacing:.06em">Tu decisión · ${escapeHtml(decLbl)}</span><br>${escapeHtml(r.decision_context)}`;
    scContainer.insertAdjacentElement('afterend',note);
  }

  // Questions
  const qCard=document.getElementById('fc-questions-card');
  qCard.style.display='block';
  document.getElementById('fc-q-grid').innerHTML=r.questions.map(q=>`
    <button class="fc-q-btn" onclick="askForecastQuestion('${q.text.replace(/'/g,"\\'")}','${q.text.replace(/'/g,"\\'")}')">
      <span class="fc-q-icon">${escapeHtml(q.icon)}</span>
      <span class="fc-q-text">${escapeHtml(q.text)}</span>
    </button>`).join('');
}

async function askForecastQuestion(question,label){
  if(!FC_RESULT||!ALL.length)return;
  const card=document.getElementById('fc-answer-card');
  const body=document.getElementById('fc-answer-body');
  const qEl=document.getElementById('fc-answer-q');
  card.classList.add('visible');
  qEl.textContent=label||question;
  body.innerHTML=`<div class="fc-answer-ld"><div class="ld"><span></span><span></span><span></span></div><span style="font-size:13px;color:var(--muted)">Analizando...</span></div>`;
  card.scrollIntoView({behavior:'smooth',block:'nearest'});

  // Demo de red: respuesta offline (sin API).
  if(typeof NET!=='undefined'&&NET.active){
    setTimeout(()=>{body.innerHTML=`<div class="fc-answer-txt">${renderMarkdown(netDemoForecastAnswer(question))}</div>`;},400);
    return;
  }

  const dataCtx=buildForecastDataContext();
  const prompt=`Eres un asesor financiero de clínicas dentales colombianas. El dueño tiene estas proyecciones para ${FC_RESULT.next_month}:
- Pesimista: $${FC_RESULT.pessimistic.collections.toLocaleString('es-CO')} COP (${FC_RESULT.pessimistic.driver})
- Base: $${FC_RESULT.base.collections.toLocaleString('es-CO')} COP (${FC_RESULT.base.driver})
- Optimista: $${FC_RESULT.optimistic.collections.toLocaleString('es-CO')} COP (${FC_RESULT.optimistic.driver})

${dataCtx}

Responde esta pregunta de forma directa y específica, con números reales de los datos: "${question}"

Sé directo, específico y conciso. Usa números. Máximo 150 palabras. Responde en el mismo idioma de la pregunta. Usa **negrita** para números o acciones clave.`;

  try{
    const resp=await fetch(WORKER_URL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model:MODEL_ID,max_tokens:400,messages:[{role:'user',content:prompt}]})});
    const json=await resp.json();
    const raw=json.content.map(b=>b.text||'').join('');
    body.innerHTML=`<div class="fc-answer-txt">${renderMarkdown(raw)}</div>`;
  }catch(e){
    body.innerHTML=`<div class="fc-answer-txt">⚠️ ${escapeHtml(e.message)}</div>`;
  }
}

function closeFcAnswer(){
  document.getElementById('fc-answer-card').classList.remove('visible');
}
