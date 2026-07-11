/* ── AI EXECUTIVE ANALYSIS (tab: Rendimiento de la Clínica → Analizar con IA) ── */

const MSGS=['Analyzing practice data...','Reviewing patient metrics...','Identifying revenue opportunities...','Generating recommendations...'];

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
  const fmtMonth=mo=>new Date(mo+'-02').toLocaleDateString('en-US',{month:'long',year:'numeric'});
  const period=data.length?`${fmtMonth(data[0].month)} – ${fmtMonth(data[data.length-1].month)}`:'unknown';

  const summary=`Practice: ${getWhiteLabel()}
Period: ${period} (${months} months)
Producción Bruta: $${Math.round(m.totalProduction).toLocaleString()}
Recaudación Total: $${Math.round(m.totalCollections).toLocaleString()}
Ingreso Neto: $${Math.round(m.totalNetIncome).toLocaleString()}
Tasa de Gastos: ${overheadRate}% (industry benchmark: <60%)
Pacientes Nuevos: ${m.totalNewPat} (avg ${data.length?Math.round(m.avgNewPatPerMonth):0}/month)
Active Patients: ${m.activePatients}
Appointments Scheduled: ${m.totalScheduled} | Completed: ${m.totalCompleted} | No-shows: ${m.totalNoShows}
Tasa de Ausentismo: ${noShowRate}% (target: <8%)
Treatment Plans Presented: ${m.totalPlansPresented} | Accepted: ${m.totalPlansAccepted}
Aceptación de Tratamientos Rate: ${acceptanceRate}% (industry avg: 65-80%)
Hygiene Revenue: $${Math.round(m.hygieneRevenue).toLocaleString()}
Restorative Revenue: $${Math.round(m.restorativeRevenue).toLocaleString()}
Cosmetic Revenue: $${Math.round(m.cosmeticRevenue).toLocaleString()}
Orthodontic Revenue: $${Math.round(m.orthoRevenue).toLocaleString()}`;

  const prompt=`You are a sharp dental practice business analyst with deep knowledge of U.S. dental industry benchmarks. Analyze this practice data and produce an executive narrative in English.

PRACTICE DATA:
${summary}

INDUSTRY BENCHMARKS (for context):
- Average annual collections: $942,290 for general dentists
- Healthy overhead: below 60% of collections
- Aceptación de tratamientos rate: 65-85% is good, above 80% is excellent
- New patients: 20-50/month is healthy for a growing practice
- No-show rate: below 8% is target

Reply ONLY with a valid JSON object (no markdown, no extra text):
{"headline":"One punchy sentence with the single most important finding and real numbers.","what_happened":"2-3 sentences describing what the practice data shows vs benchmarks.","why_it_matters":"2-3 sentences on the business implication for the dentist.","opportunity":"1-2 sentences on the biggest revenue opportunity or risk.","actions":[{"priority":"URGENT","text":"Specific action the practice owner should take this week."},{"priority":"MEDIUM","text":"Action for the next 30 days."},{"priority":"LOW","text":"Strategic action for the next quarter."}],"confidence":82}

Be direct. Reference actual numbers. Compare against benchmarks. Think like a dental practice CFO.`;

  try{
    const resp=await fetch(WORKER_URL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model:MODEL_ID,max_tokens:1000,messages:[{role:'user',content:prompt}]})});
    const json=await resp.json();
    const raw=json.content.map(b=>b.text||'').join('');
    const r=JSON.parse(raw.replace(/```json|```/g,'').trim());
    if(!r.headline||!Array.isArray(r.actions))throw new Error('Unexpected AI response format');
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
      <div class="ai-block"><div class="ai-block-lbl">What happened</div><div class="ai-block-txt">${escapeHtml(r.what_happened)}</div></div>
      <div class="ai-block"><div class="ai-block-lbl">Why it matters</div><div class="ai-block-txt">${escapeHtml(r.why_it_matters)}</div></div>
      <div class="ai-block"><div class="ai-block-lbl">Opportunity / Risk</div><div class="ai-block-txt">${escapeHtml(r.opportunity)}</div></div>
    </div>
    <div class="ai-actions-title">Recommended actions</div>
    ${r.actions.map(a=>`<div class="ai-action"><span class="abadge ${pc[a.priority]||'ab-b'}">${escapeHtml(a.priority)}</span><span>${escapeHtml(a.text)}</span></div>`).join('')}
    <div class="ai-conf"><span class="ai-conf-lbl">Analysis confidence</span><div class="ai-conf-track"><div class="ai-conf-fill" style="width:${confidence}%"></div></div><span class="ai-conf-pct">${confidence}%</span></div>`;
  document.getElementById('ai-result').style.display='block';
  document.getElementById('ai-btn').disabled=false;
  document.getElementById('pdf-btn').classList.add('visible');
}
