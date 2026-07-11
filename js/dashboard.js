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
  document.getElementById('hs-items').innerHTML=hs.items.map(it=>`
    <div class="hs-item">
      <div class="hs-item-head">
        <span class="hs-item-name">${it.name}</span>
        <span class="hs-item-val ${it.color}">${it.val}</span>
      </div>
      <div class="hs-bar-track"><div class="hs-bar-fill ${it.color}" style="width:${it.score}%"></div></div>
      <div class="hs-item-bench">${it.bench}</div>
    </div>`).join('');
}

/* ── RENDER ── */
function render(data){
  CURRENT_DATA=data;
  renderHealthScore(data);
  document.getElementById('ai-empty').style.display='block';
  document.getElementById('ai-loading').style.display='none';
  document.getElementById('ai-result').style.display='none';
  document.getElementById('ai-btn').disabled=false;

  const m=computeMetrics(data);
  const overheadRate=Math.round(m.overheadRate);
  const acceptanceRate=Math.round(m.acceptanceRate);
  const noShowRate=Math.round(m.noShowRate);

  document.getElementById('kCollections').textContent='$'+Math.round(m.totalCollections/1000)+'k';
  document.getElementById('kCollectionsSub').textContent=data.length+' meses registrados';
  document.getElementById('kProduction').textContent='$'+Math.round(m.totalProduction/1000)+'k';
  document.getElementById('kProductionSub').textContent='$'+Math.round(m.avgProduction/1000)+'k prom/mes';
  document.getElementById('kNetIncome').textContent='$'+Math.round(m.totalNetIncome/1000)+'k';
  document.getElementById('kNetIncomeSub').textContent=m.totalCollections?Math.round(m.totalNetIncome/m.totalCollections*100)+'% margen':'—';
  document.getElementById('kOverhead').textContent=overheadRate+'%';

  document.getElementById('kNewPat').textContent=m.totalNewPat;
  document.getElementById('kNewPatSub').textContent=data.length?Math.round(m.totalNewPat/data.length)+' prom/mes':'—';
  document.getElementById('kAppts').textContent=m.totalCompleted;
  document.getElementById('kApptsSub').textContent=m.totalScheduled?Math.round(m.totalCompleted/m.totalScheduled*100)+'% tasa de finalización':'—';
  document.getElementById('kAcceptance').textContent=acceptanceRate+'%';
  document.getElementById('kNoShow').textContent=noShowRate+'%';

  // Monthly collections trend — byMonth avoids an O(n²) data.find() per month
  const months=data.map(r=>r.month).sort();
  const byMonth=new Map(data.map(r=>[r.month,r]));
  const monthLabel=mo=>new Date(mo+'-02').toLocaleDateString('es-CO',{month:'short',year:'2-digit'});
  kill('cTime');
  charts['cTime']=new Chart(document.getElementById('cTime'),{
    type:'line',
    data:{
      labels:months.map(monthLabel),
      datasets:[{
        label:'Recaudación',
        data:months.map(mo=>byMonth.get(mo)?.collections||0),
        borderColor:'#00D4AA',backgroundColor:'rgba(0,212,170,0.07)',tension:0.35,fill:true,pointRadius:3,pointBackgroundColor:'#00D4AA',borderWidth:2
      },{
        label:'Producción',
        data:months.map(mo=>byMonth.get(mo)?.gross_production||0),
        borderColor:'#388BFD',backgroundColor:'rgba(56,139,253,0.04)',tension:0.35,fill:true,pointRadius:3,pointBackgroundColor:'#388BFD',borderWidth:2,borderDash:[4,3]
      }]
    },
    options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:true,labels:{font:{size:10},boxWidth:10}}},scales:{x:{ticks:{font:{size:10}},grid:{color:'#21262D'}},y:{ticks:{font:{size:10},callback:v=>'$'+Math.round(v/1000)+'k'},grid:{color:'#21262D'}}}}
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
    data:{labels:['Personal','Insumos','Otros gastos'],datasets:[{data:[m.staffCosts,m.suppliesCosts,otherCosts>0?otherCosts:0],backgroundColor:['#388BFD','#E3B341','#A371F7'],borderWidth:0,hoverOffset:4}]},
    options:{responsive:true,maintainAspectRatio:false,cutout:'58%',plugins:{legend:{display:true,labels:{font:{size:10},boxWidth:10}}}}
  });

  // Production vs Collections bar
  kill('cProdCol');
  charts['cProdCol']=new Chart(document.getElementById('cProdCol'),{
    type:'bar',
    data:{
      labels:months.map(monthLabel),
      datasets:[
        {label:'Producción',data:months.map(mo=>byMonth.get(mo)?.gross_production||0),backgroundColor:'rgba(56,139,253,0.7)',borderRadius:4,borderSkipped:false},
        {label:'Recaudación',data:months.map(mo=>byMonth.get(mo)?.collections||0),backgroundColor:'rgba(0,212,170,0.7)',borderRadius:4,borderSkipped:false}
      ]
    },
    options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:true,labels:{font:{size:10},boxWidth:10}}},scales:{x:{ticks:{font:{size:10}},grid:{color:'#21262D'}},y:{ticks:{font:{size:10},callback:v=>'$'+Math.round(v/1000)+'k'},grid:{color:'#21262D'}}}}
  });
}
