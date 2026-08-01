/* ── CSV LOADING + MAIN DASHBOARD RENDER (tab: Rendimiento de la Clínica) ── */

async function loadCSV(){
  try{
    const res=await fetch('smile_dental_demo.csv');
    const text=await res.text();
    const lines=text.trim().split('\n');
    const headers=lines[0].split(',').map(h=>h.trim());
    ALL=lines.slice(1).map(line=>{
      const cols=line.split(',');
      const r={};
      headers.forEach((h,i)=>{r[h]=cols[i]?cols[i].trim():'';});
      // parse numeric fields
      ['gross_production','collections','new_patients','active_patients',
       'appointments_scheduled','appointments_completed','cancellations','no_shows',
       'treatment_plans_presented','treatment_plans_accepted',
       'hygiene_revenue','restorative_revenue','cosmetic_revenue','orthodontic_revenue',
       'overhead_costs','staff_costs','supplies_costs','net_income'].forEach(k=>{
        r[k]=parseFloat(r[k])||0;
      });
      return r;
    }).filter(r=>r.month);
    document.getElementById('loading').style.display='none';
    document.getElementById('app').style.display='block';
    popFilters();render(ALL);initChat();
  }catch(e){
    document.getElementById('loading').innerHTML='<p style="color:#F85149">Error al cargar smile_dental_demo.csv — '+e.message+'</p>';
  }
}

function popFilters(){
  const sel=document.getElementById('fMonth');
  [...new Set(ALL.map(r=>r.month))].sort().forEach(v=>{
    const o=document.createElement('option');o.value=v;
    o.textContent=new Date(v+'-02').toLocaleDateString('es-CO',{month:'long',year:'numeric'});
    sel.appendChild(o);
  });
}

function go(){
  const m=document.getElementById('fMonth').value;
  let d=ALL;
  if(m)d=d.filter(r=>r.month===m);
  render(d);
}
function resetFilters(){document.getElementById('fMonth').value='';render(ALL);}

/* ── TENDENCIAS POR MÉTRICA (serie mensual + MoM/YoY) ─────────────────────
   Un dueño no solo quiere el número actual, quiere la trayectoria. Cada métrica
   clave se calcula por mes sobre ALL (la tendencia no depende del filtro) y se
   muestra como sparkline + flecha vs mes anterior (y vs año pasado si hay ≥13
   meses). El color codifica si el movimiento es BUENO o MALO para esa métrica
   (ausentismo bajando = verde), no un ingenuo ↑=verde. */
const METRIC_HIGHER_BETTER={overhead:false,acceptance:true,noshow:false,newpat:true,collection:true};

function metricValue(key,r){
  switch(key){
    case 'overhead':   return r.collections?r.overhead_costs/r.collections*100:0;
    case 'acceptance': return r.treatment_plans_presented?r.treatment_plans_accepted/r.treatment_plans_presented*100:0;
    case 'noshow':     return r.appointments_scheduled?r.no_shows/r.appointments_scheduled*100:0;
    case 'newpat':     return r.new_patients||0;
    case 'collection': return r.gross_production?r.collections/r.gross_production*100:0;
    default: return 0;
  }
}

function metricSeries(key){
  return [...ALL].sort((a,b)=>a.month<b.month?-1:1).map(r=>({month:r.month,value:metricValue(key,r)}));
}

function mesCorto(m,conAnio){
  const s=new Date(m+'-02T00:00:00').toLocaleDateString('es-CO',{month:'short'}).replace('.','');
  return conAnio?`${s} '${m.slice(2,4)}`:s;
}

/* Tendencia de una métrica respecto de un mes de referencia (el filtrado si hay
   uno, si no el último). Devuelve la serie (para el sparkline) + deltas MoM/YoY. */
function metricTrend(key,refMonth){
  const serie=metricSeries(key);
  if(serie.length<2)return null;
  const idx=refMonth?serie.findIndex(s=>s.month===refMonth):-1;
  const i=idx>=0?idx:serie.length-1;
  const cur=serie[i], prev=i>0?serie[i-1]:null, yoy=i>=12?serie[i-12]:null;
  const higher=METRIC_HIGHER_BETTER[key];
  const calc=from=>{
    if(!from||!isFinite(from.value)||from.value===0)return null;
    const pct=(cur.value-from.value)/Math.abs(from.value)*100;
    const dir=Math.abs(pct)<1?'flat':((pct>0)===higher?'good':'bad');
    return {pct,dir,month:from.month};
  };
  return {values:serie.map(s=>s.value), refIndex:i, mom:calc(prev), yoy:calc(yoy)};
}

/* Sparkline SVG inline. Línea tenue + punto en el mes de referencia, coloreado
   según la dirección buena/mala del último movimiento. */
function sparklineSVG(vals,dirClass,hi){
  if(!vals||vals.length<2)return '';
  const w=76,h=22,pad=3;
  const min=Math.min(...vals),max=Math.max(...vals),rng=(max-min)||1;
  const x=i=>pad+i*(w-2*pad)/(vals.length-1);
  const y=v=>h-pad-((v-min)/rng)*(h-2*pad);
  const pts=vals.map((v,i)=>`${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const hiIdx=(hi==null?vals.length-1:hi);
  return `<svg class="hs-spark" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" preserveAspectRatio="none" aria-hidden="true">`
    +`<polyline points="${pts}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round" opacity="0.45"/>`
    +`<circle class="hs-spark-dot ${dirClass||'flat'}" cx="${x(hiIdx).toFixed(1)}" cy="${y(vals[hiIdx]).toFixed(1)}" r="2.4"/>`
    +`</svg>`;
}

/* HTML de una flecha de delta (↑/↓/→) coloreada por bueno/malo. */
function deltaHTML(d,label){
  if(!d)return '';
  const arrow=d.dir==='flat'?'→':(d.pct>0?'↑':'↓');
  const pct=Math.abs(d.pct);
  return `<span class="hs-delta ${d.dir}">${arrow} ${pct.toFixed(pct>=10?0:1)}% <span class="hs-delta-ctx">${label}</span></span>`;
}

/* ── PRACTICE HEALTH SCORE ── */
function renderHealthScore(data){
  const hs=computeHealthScore(data);
  // ring — circumference 2π×46 ≈ 289
  const circ=289;
  const offset=circ-(circ*hs.total/100);
  const ring=document.getElementById('hs-ring');
  ring.style.strokeDashoffset=offset;
  ring.style.stroke=hs.ringColor;
  document.getElementById('hs-num').textContent=hs.total;
  const lbl=document.getElementById('hs-label');
  lbl.textContent=hs.label;
  lbl.className='hs-label '+hs.labelClass;
  // Mes de referencia para la tendencia: el mes filtrado si hay uno, si no el último.
  const refMonth=(data&&data.length===1)?data[0].month:null;
  document.getElementById('hs-items').innerHTML=hs.items.map(it=>{
    const tr=it.key?metricTrend(it.key,refMonth):null;
    let trendHtml='';
    if(tr){
      const spark=sparklineSVG(tr.values,tr.mom?tr.mom.dir:'flat',tr.refIndex);
      const mom=tr.mom?deltaHTML(tr.mom,'vs '+mesCorto(tr.mom.month)):'';
      const yoy=tr.yoy?deltaHTML(tr.yoy,'vs '+mesCorto(tr.yoy.month,true)):'';
      trendHtml=`<span class="hs-trend">${spark}${mom}${yoy}</span>`;
    }
    return `
    <div class="hs-item">
      <div class="hs-item-head">
        <span class="hs-item-name">${it.name}</span>
        <span class="hs-item-val ${it.color}">${it.val}</span>
      </div>
      <div class="hs-bar-track"><div class="hs-bar-fill ${it.color}" style="width:${it.score}%"></div></div>
      <div class="hs-item-foot">
        <span class="hs-item-bench">${it.bench}</span>
        ${trendHtml}
      </div>
    </div>`;}).join('');
}

/* ── RENDER ── */
function render(data){
  CURRENT_DATA=data;
  renderHealthScore(data);
  // Collapse the AI panel back to its slim bar — a stale analysis for a
  // different filter selection must not stay on screen.
  document.querySelector('.ai-panel').classList.remove('open');
  document.getElementById('ai-empty').style.display='none';
  document.getElementById('ai-loading').style.display='none';
  document.getElementById('ai-result').style.display='none';
  document.getElementById('ai-btn').disabled=false;

  const m=computeMetrics(data);
  const overheadRate=Math.round(m.overheadRate);
  const acceptanceRate=Math.round(m.acceptanceRate);
  const noShowRate=Math.round(m.noShowRate);

  // KPI accent bars encode state vs benchmark (neutral = no benchmark applies)
  const st=benchmarkStates(m);
  const setState=(id,state)=>{const el=document.getElementById(id);if(el)el.className='kpi st-'+(state||'neutral');};
  setState('kpi-production',null);
  setState('kpi-overhead',st.overhead);
  setState('kpi-newpat',st.newPat);
  setState('kpi-appts',null);
  setState('kpi-acceptance',st.acceptance);
  setState('kpi-noshow',st.noShow);

  document.getElementById('kCollections').textContent='$'+(m.totalCollections/1e6).toFixed(1)+'M';

  // Hero subtitle + month-over-month delta. The delta only appears when a
  // single month is filtered — a MoM comparison on a multi-month total is
  // meaningless, so we don't force one.
  const selMonth=data.length===1?data[0].month:null;
  const collSub=document.getElementById('kCollectionsSub');
  const deltaEl=document.getElementById('kCollectionsDelta');
  if(selMonth){
    collSub.textContent=new Date(selMonth+'-02').toLocaleDateString('es-CO',{month:'long',year:'numeric'});
    const sorted=[...ALL].sort((a,b)=>a.month<b.month?-1:a.month>b.month?1:0);
    const idx=sorted.findIndex(r=>r.month===selMonth);
    const prev=idx>0?sorted[idx-1]:null;   // earliest month has no predecessor
    if(prev&&prev.collections>0){
      const pct=(data[0].collections-prev.collections)/prev.collections*100;
      const dir=pct>0.05?'up':pct<-0.05?'down':'flat';   // up = more revenue = good
      const arrow=dir==='up'?'↑':dir==='down'?'↓':'→';
      const prevLbl=new Date(prev.month+'-02').toLocaleDateString('es-CO',{month:'short'}).replace('.','');
      deltaEl.className='hero-delta visible '+dir;
      deltaEl.textContent=`${arrow} ${Math.abs(pct).toFixed(1)}% vs ${prevLbl}`;
    }else{
      deltaEl.className='hero-delta';deltaEl.textContent='';
    }
  }else{
    collSub.textContent=data.length+' meses registrados';
    deltaEl.className='hero-delta';deltaEl.textContent='';
  }

  document.getElementById('kProduction').textContent='$'+(m.totalProduction/1e6).toFixed(1)+'M';
  document.getElementById('kProductionSub').textContent='$'+(m.avgProduction/1e6).toFixed(1)+'M prom/mes';
  document.getElementById('kNetIncome').textContent='$'+(m.totalNetIncome/1e6).toFixed(1)+'M';
  document.getElementById('kNetIncomeSub').textContent=m.totalCollections?Math.round(m.totalNetIncome/m.totalCollections*100)+'% margen':'—';
  document.getElementById('kOverhead').textContent=overheadRate+'%';

  document.getElementById('kNewPat').textContent=m.totalNewPat;
  document.getElementById('kNewPatSub').textContent=data.length?Math.round(m.totalNewPat/data.length)+' prom/mes':'—';
  document.getElementById('kAppts').textContent=m.totalCompleted;
  document.getElementById('kApptsSub').textContent=m.totalScheduled?Math.round(m.totalCompleted/m.totalScheduled*100)+'% tasa de finalización':'—';
  document.getElementById('kAcceptance').textContent=acceptanceRate+'%';
  document.getElementById('kNoShow').textContent=noShowRate+'%';

  // months/byMonth are the FILTERED set — used by the "Producción vs
  // recaudación" bar chart below, which should reflect the filter.
  const months=data.map(r=>r.month).sort();
  const byMonth=new Map(data.map(r=>[r.month,r]));
  const monthLabel=mo=>new Date(mo+'-02').toLocaleDateString('es-CO',{month:'short',year:'2-digit'});

  // The trend line, in contrast, ALWAYS spans all 12 months so it never looks
  // blank when a single month is filtered; the filtered month gets a larger,
  // ringed point so the filter still visibly connects to the chart.
  const allMonths=[...ALL].map(r=>r.month).sort();
  const allByMonth=new Map(ALL.map(r=>[r.month,r]));
  const selIdx=selMonth?allMonths.indexOf(selMonth):-1;
  const trendPt=allMonths.map((_,i)=>i===selIdx?6:3);
  const trendHalo=allMonths.map((_,i)=>i===selIdx?2:0);
  kill('cTime');
  charts['cTime']=new Chart(document.getElementById('cTime'),{
    type:'line',
    data:{
      labels:allMonths.map(monthLabel),
      datasets:[{
        label:'Recaudación',
        data:allMonths.map(mo=>allByMonth.get(mo)?.collections||0),
        borderColor:CHART_TEAL,backgroundColor:'rgba(0,168,139,0.08)',tension:0.35,fill:true,pointRadius:trendPt,pointHoverRadius:6,pointBorderColor:'#E6EDF3',pointBorderWidth:trendHalo,pointBackgroundColor:CHART_TEAL,borderWidth:2
      },{
        label:'Producción',
        data:allMonths.map(mo=>allByMonth.get(mo)?.gross_production||0),
        borderColor:'#388BFD',backgroundColor:'rgba(56,139,253,0.04)',tension:0.35,fill:true,pointRadius:trendPt,pointHoverRadius:6,pointBackgroundColor:'#388BFD',borderWidth:2,borderDash:[4,3]
      }]
    },
    options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:true,labels:{font:{size:10},boxWidth:10}}},scales:{x:{ticks:{font:{size:10}},grid:{color:'#21262D'}},y:{ticks:{font:{size:10},callback:v=>'$'+Math.round(v/1e6)+'M'},grid:{color:'#21262D'}}}}
  });

  // Service mix donut
  const services=[['Higiene',m.hygieneRevenue],['Restaurativa',m.restorativeRevenue],['Estética',m.cosmeticRevenue],['Ortodoncia',m.orthoRevenue]];
  mkLeg('lServ',services);
  kill('cServ');
  charts['cServ']=new Chart(document.getElementById('cServ'),{
    type:'doughnut',
    data:{labels:services.map(e=>e[0]),datasets:[{data:services.map(e=>e[1]),backgroundColor:PALETTE,borderWidth:0,hoverOffset:4}]},
    options:{responsive:true,maintainAspectRatio:false,cutout:'62%',plugins:{legend:{display:false}}}
  });

  // Revenue by service rank
  mkRank('rServ',services.sort((a,b)=>b[1]-a[1]),fmtCOP);

  // Patient flow rank
  const patFlow=data.map(r=>[monthLabel(r.month),r.new_patients]).sort((a,b)=>b[1]-a[1]);
  mkRank('rPat',patFlow,v=>v+' nuevos');

  // Appointment outcomes rank
  const apptData=[
    ['Completadas',m.totalCompleted],
    ['Cancelaciones',m.totalCancellations],
    ['Inasistencias',m.totalNoShows]
  ];
  mkRank('rAppt',apptData);

  // Overhead breakdown donut
  const otherCosts=m.totalOverhead-m.staffCosts-m.suppliesCosts;
  kill('cOverhead');
  charts['cOverhead']=new Chart(document.getElementById('cOverhead'),{
    type:'doughnut',
    data:{labels:['Personal','Insumos','Otros gastos'],datasets:[{data:[m.staffCosts,m.suppliesCosts,otherCosts>0?otherCosts:0],backgroundColor:[PALETTE[1],PALETTE[2],PALETTE[4]],borderWidth:0,hoverOffset:4}]},
    options:{responsive:true,maintainAspectRatio:false,cutout:'58%',plugins:{legend:{display:true,labels:{font:{size:10},boxWidth:10}}}}
  });

  // Production vs Collections bar
  kill('cProdCol');
  charts['cProdCol']=new Chart(document.getElementById('cProdCol'),{
    type:'bar',
    data:{
      labels:months.map(monthLabel),
      datasets:[
        {label:'Producción',data:months.map(mo=>byMonth.get(mo)?.gross_production||0),backgroundColor:'rgba(56,139,253,0.75)',borderRadius:4,borderSkipped:false},
        {label:'Recaudación',data:months.map(mo=>byMonth.get(mo)?.collections||0),backgroundColor:'rgba(0,168,139,0.85)',borderRadius:4,borderSkipped:false}
      ]
    },
    options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:true,labels:{font:{size:10},boxWidth:10}}},scales:{x:{ticks:{font:{size:10}},grid:{color:'#21262D'}},y:{ticks:{font:{size:10},callback:v=>'$'+Math.round(v/1e6)+'M'},grid:{color:'#21262D'}}}}
  });
}
