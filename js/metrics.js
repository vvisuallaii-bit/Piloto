/* ── PRACTICE METRICS — single source of truth for aggregate calculations ──
   Previously this math (sums + overhead/acceptance/no-show rates) was
   duplicated near-verbatim in render(), runAnalysis(), exportPDF(),
   buildDataContext(), buildForecastDataContext() and computeHealthScore().
   Every one of those now calls computeMetrics() instead. */

function computeMetrics(data){
  const sum=k=>data.reduce((s,r)=>s+r[k],0);
  const months=data.length||1;
  const totalCollections=sum('collections');
  const totalProduction=sum('gross_production');
  const totalNetIncome=sum('net_income');
  const totalOverhead=sum('overhead_costs');
  const totalNewPat=sum('new_patients');
  const totalCompleted=sum('appointments_completed');
  const totalScheduled=sum('appointments_scheduled');
  const totalCancellations=sum('cancellations');
  const totalNoShows=sum('no_shows');
  const totalPlansPresented=sum('treatment_plans_presented');
  const totalPlansAccepted=sum('treatment_plans_accepted');
  const hygieneRevenue=sum('hygiene_revenue');
  const restorativeRevenue=sum('restorative_revenue');
  const cosmeticRevenue=sum('cosmetic_revenue');
  const orthoRevenue=sum('orthodontic_revenue');
  const staffCosts=sum('staff_costs');
  const suppliesCosts=sum('supplies_costs');
  const activePatients=data.length?data[data.length-1].active_patients:0;

  return{
    months,
    totalCollections,totalProduction,totalNetIncome,totalOverhead,
    totalNewPat,totalCompleted,totalScheduled,totalCancellations,totalNoShows,
    totalPlansPresented,totalPlansAccepted,
    hygieneRevenue,restorativeRevenue,cosmeticRevenue,orthoRevenue,
    staffCosts,suppliesCosts,activePatients,
    overheadRate: totalCollections?totalOverhead/totalCollections*100:0,
    acceptanceRate: totalPlansPresented?totalPlansAccepted/totalPlansPresented*100:0,
    noShowRate: totalScheduled?totalNoShows/totalScheduled*100:0,
    collectionRate: totalProduction?totalCollections/totalProduction*100:0,
    avgNewPatPerMonth: totalNewPat/months,
    avgCollections: totalCollections/months,
    avgProduction: totalProduction/months,
  };
}

/* Three-way state vs the Colombia benchmarks, shared by the health score
   items and the KPI accent bars: 'good' | 'warn' | 'bad'. */
function benchmarkStates(m){
  // No-data edge cases score as worst-case (a clinic with zero collections
  // or zero scheduled appointments is not "healthy by default").
  const overheadRate=m.totalCollections?m.overheadRate:100;
  const noShowRate=m.totalScheduled?m.noShowRate:100;
  return{
    overhead: overheadRate<55?'good':overheadRate<65?'warn':'bad',       // meta <65% Colombia
    acceptance: m.acceptanceRate>65?'good':m.acceptanceRate>55?'warn':'bad', // meta >65%
    noShow: noShowRate<8?'good':noShowRate<12?'warn':'bad',              // meta <12%
    newPat: m.avgNewPatPerMonth>25?'good':m.avgNewPatPerMonth>15?'warn':'bad', // meta >20/mes
    collection: m.collectionRate>95?'good':m.collectionRate>90?'warn':'bad',   // meta >95%
  };
}
const STATE_COLOR={good:'green',warn:'amber',bad:'red'};

/* ── PRACTICE HEALTH SCORE ── */
function computeHealthScore(data){
  const m=computeMetrics(data);
  const st=benchmarkStates(m);

  // Same worst-case overrides as benchmarkStates
  const overheadRate=m.totalCollections?m.overheadRate:100;
  const overheadScore=overheadRate<55?100:overheadRate<65?75:overheadRate<75?45:20;
  const overheadColor=STATE_COLOR[st.overhead];

  const acceptRate=m.acceptanceRate;
  const acceptScore=acceptRate>65?100:acceptRate>55?78:acceptRate>45?50:25;
  const acceptColor=STATE_COLOR[st.acceptance];

  const noShowRate=m.totalScheduled?m.noShowRate:100;
  const noShowScore=noShowRate<8?100:noShowRate<12?72:noShowRate<18?44:15;
  const noShowColor=STATE_COLOR[st.noShow];

  const avgNewPat=m.avgNewPatPerMonth;
  const newPatScore=avgNewPat>25?100:avgNewPat>15?75:avgNewPat>8?48:22;
  const newPatColor=STATE_COLOR[st.newPat];

  const colRate=m.collectionRate;
  const colScore=colRate>95?100:colRate>90?80:colRate>85?55:30;
  const colColor=STATE_COLOR[st.collection];

  // Ponderado total
  const total=Math.round(
    overheadScore*0.25 +
    acceptScore*0.25 +
    noShowScore*0.20 +
    newPatScore*0.15 +
    colScore*0.15
  );

  const label=total>=85?'Excelente':total>=70?'Bueno':total>=50?'Regular':'Requiere atención';
  const labelClass=total>=85?'excellent':total>=70?'good':total>=50?'fair':'poor';
  const ringColor=total>=85?'#3FB950':total>=70?'#00D4AA':total>=50?'#E3B341':'#F85149';

  return{
    total,label,labelClass,ringColor,
    items:[
      {name:'Tasa de gastos',val:overheadRate.toFixed(1)+'%',bench:'Meta: <65%',score:overheadScore,color:overheadColor},
      {name:'Aceptación tratamientos',val:acceptRate.toFixed(0)+'%',bench:'Meta: >65%',score:acceptScore,color:acceptColor},
      {name:'Tasa de ausentismo',val:noShowRate.toFixed(1)+'%',bench:'Meta: <12%',score:noShowScore,color:noShowColor},
      {name:'Pacientes nuevos/mes',val:avgNewPat.toFixed(0),bench:'Meta: >20/mes',score:newPatScore,color:newPatColor},
      {name:'Tasa de cobro',val:colRate.toFixed(1)+'%',bench:'Meta: >95%',score:colScore,color:colColor},
    ]
  };
}
