/* ── AI PROMPT CONTEXT BUILDERS ──
   Shared by the AI executive analysis, the chat advisor and the forecast
   tab — all three need to describe the practice's data/profile to Claude
   in slightly different shapes, but they now pull the underlying numbers
   from computeMetrics() instead of recomputing sums independently. */

function buildProfileContext(){
  if(!PRACTICE_PROFILE)return'';
  const p=PRACTICE_PROFILE;
  const insuranceLabels={'ppo':'PPO','hmo':'HMO/Medicaid','ffs':'Particular (sin convenio)','membership':'Plan propio de membresía','mixed':'Mixto'};
  const challengeLabels={'new_patients':'Atraer pacientes nuevos','retention':'Retención de pacientes','overhead':'Reducir gastos operativos','acceptance':'Aceptación de tratamientos','noshows':'Ausentismo/cancelaciones','staff':'Personal/contratación','growth':'Escalar/crecer','cashflow':'Flujo de caja'};
  const goalLabels={'under500k':'Menos de $150M COP','500k-750k':'$150M–$250M COP','750k-1m':'$250M–$400M COP','1m-1.5m':'$400M–$600M COP','1.5m+':'Más de $600M COP'};

  let ctx=`\n=== PRACTICE PROFILE (owner-provided context) ===\n`;
  ctx+=`Nombre de la clínica: ${p.name}\n`;
  if(p.location)ctx+=`Location: ${p.location}\n`;
  if(p.chairs)ctx+=`Operatories: ${p.chairs}\n`;
  if(p.doctors)ctx+=`Providers: ${p.doctors}\n`;
  if(p.area)ctx+=`Area type: ${p.area}\n`;
  if(p.insurance&&p.insurance.length)ctx+=`Convenios y pagadores: ${p.insurance.map(v=>insuranceLabels[v]||v).join(', ')}\n`;
  if(p.goal)ctx+=`Revenue goal: ${goalLabels[p.goal]||p.goal} annually\n`;
  if(p.challenge&&p.challenge.length)ctx+=`Key challenges: ${p.challenge.map(v=>challengeLabels[v]||v).join(', ')}\n`;
  if(p.notes)ctx+=`Additional context: ${p.notes}\n`;
  ctx+=`=== END PROFILE ===\n`;
  return ctx;
}

function buildDataContext(){
  if(!ALL.length)return'';
  const data=ALL;
  const m=computeMetrics(data);
  const overheadRate=Math.round(m.overheadRate);
  const acceptanceRate=Math.round(m.acceptanceRate);
  const noShowRate=Math.round(m.noShowRate);
  const fmtMonth=mo=>new Date(mo+'-02').toLocaleDateString('en-US',{month:'long',year:'numeric'});

  return `=== SMILE DENTAL — PRACTICE DATA ===
Period: ${fmtMonth(data[0].month)} to ${fmtMonth(data[data.length-1].month)}
Months tracked: ${data.length}

FINANCIAL:
  Producción Bruta: $${Math.round(m.totalProduction).toLocaleString()}
  Collections: $${Math.round(m.totalCollections).toLocaleString()}
  Ingreso Neto: $${Math.round(m.totalNetIncome).toLocaleString()}
  Tasa de Gastos: ${overheadRate}% (benchmark: <60%)

PATIENTS:
  Pacientes Nuevos: ${m.totalNewPat} total (${Math.round(m.avgNewPatPerMonth)}/month avg)
  Active Patients: ${m.activePatients}

APPOINTMENTS:
  Scheduled: ${m.totalScheduled} | Completed: ${m.totalCompleted}
  Tasa de Ausentismo: ${noShowRate}% (target: <8%)

TREATMENT:
  Aceptación de Tratamientos Rate: ${acceptanceRate}% (industry avg: 65-80%)
  Plans Presented: ${m.totalPlansPresented} | Accepted: ${m.totalPlansAccepted}

SERVICE MIX:
  Hygiene: $${Math.round(m.hygieneRevenue).toLocaleString()}
  Restorative: $${Math.round(m.restorativeRevenue).toLocaleString()}
  Cosmetic: $${Math.round(m.cosmeticRevenue).toLocaleString()}
  Orthodontic: $${Math.round(m.orthoRevenue).toLocaleString()}
=== END DATA ===`;
}

function buildForecastDataContext(){
  if(!ALL.length)return'';
  const data=ALL;
  const m=computeMetrics(data);
  const fmtM=mo=>new Date(mo+'-02').toLocaleDateString('en-US',{month:'long',year:'numeric'});
  const monthRows=data.map(r=>`  ${r.month}: collections=$${Math.round(r.collections).toLocaleString()}, production=$${Math.round(r.gross_production).toLocaleString()}, new_patients=${r.new_patients}, no_show_rate=${r.appointments_scheduled?Math.round(r.no_shows/r.appointments_scheduled*100):0}%, overhead_rate=${r.collections?Math.round(r.overhead_costs/r.collections*100):0}%`).join('\n');
  const lastThree=data.slice(-3);
  const avgLast3=lastThree.reduce((s,r)=>s+r.collections,0)/lastThree.length;
  const trend=avgLast3>m.avgCollections?'upward':'downward';
  const profileCtx=buildProfileContext();
  return`HISTORICAL DATA (month by month):
${monthRows}

SUMMARY:
  Period: ${fmtM(data[0].month)} to ${fmtM(data[data.length-1].month)}
  Average monthly collections: $${Math.round(m.avgCollections).toLocaleString()}
  Last 3-month average: $${Math.round(avgLast3).toLocaleString()}
  Trend: ${trend}
  Avg new patients/mo: ${Math.round(m.avgNewPatPerMonth)}
  Avg overhead rate: ${Math.round(m.overheadRate)}%
  Aceptación de tratamientos: ${Math.round(m.acceptanceRate)}%
  No-show rate: ${Math.round(m.noShowRate)}%
${profileCtx}`;
}
