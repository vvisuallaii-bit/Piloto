/* ── AI PROMPT CONTEXT BUILDERS ──
   Shared by the AI executive analysis, the chat advisor and the forecast
   tab — all three need to describe the practice's data/profile to Claude
   in slightly different shapes, but they now pull the underlying numbers
   from computeMetrics() instead of recomputing sums independently.
   Benchmarks referenced here match the Colombia thresholds used by
   computeHealthScore() in metrics.js: overhead <65%, acceptance >65%,
   no-show <12%. */

function buildProfileContext(){
  if(!PRACTICE_PROFILE)return'';
  const p=PRACTICE_PROFILE;
  const insuranceLabels={'ppo':'PPO','hmo':'HMO/Medicaid','ffs':'Particular (sin convenio)','membership':'Plan propio de membresía','mixed':'Mixto'};
  const challengeLabels={'new_patients':'Atraer pacientes nuevos','retention':'Retención de pacientes','overhead':'Reducir gastos operativos','acceptance':'Aceptación de tratamientos','noshows':'Ausentismo/cancelaciones','staff':'Personal/contratación','growth':'Escalar/crecer','cashflow':'Flujo de caja'};
  const goalLabels={'under500k':'Menos de $150M COP','500k-750k':'$150M–$250M COP','750k-1m':'$250M–$400M COP','1m-1.5m':'$400M–$600M COP','1.5m+':'Más de $600M COP'};

  let ctx=`\n=== PERFIL DE LA CLÍNICA (contexto dado por el dueño) ===\n`;
  ctx+=`Nombre de la clínica: ${p.name}\n`;
  if(p.location)ctx+=`Ubicación: ${p.location}\n`;
  if(p.chairs)ctx+=`Consultorios: ${p.chairs}\n`;
  if(p.doctors)ctx+=`Odontólogos: ${p.doctors}\n`;
  if(p.area)ctx+=`Tipo de zona: ${p.area}\n`;
  if(p.insurance&&p.insurance.length)ctx+=`Convenios y pagadores: ${p.insurance.map(v=>insuranceLabels[v]||v).join(', ')}\n`;
  if(p.goal)ctx+=`Meta de ingresos: ${goalLabels[p.goal]||p.goal} anuales\n`;
  if(p.challenge&&p.challenge.length)ctx+=`Retos principales: ${p.challenge.map(v=>challengeLabels[v]||v).join(', ')}\n`;
  if(p.notes)ctx+=`Contexto adicional: ${p.notes}\n`;
  ctx+=`=== FIN DEL PERFIL ===\n`;
  return ctx;
}

function buildDataContext(){
  if(!ALL.length)return'';
  const data=ALL;
  const m=computeMetrics(data);
  const overheadRate=Math.round(m.overheadRate);
  const acceptanceRate=Math.round(m.acceptanceRate);
  const noShowRate=Math.round(m.noShowRate);
  const fmtMonth=mo=>new Date(mo+'-02').toLocaleDateString('es-CO',{month:'long',year:'numeric'});

  return `=== DATOS DE LA CLÍNICA ===
Período: ${fmtMonth(data[0].month)} a ${fmtMonth(data[data.length-1].month)}
Meses registrados: ${data.length}

FINANCIERO:
  Producción Bruta: $${Math.round(m.totalProduction).toLocaleString('es-CO')} COP
  Recaudación: $${Math.round(m.totalCollections).toLocaleString('es-CO')} COP
  Ingreso Neto: $${Math.round(m.totalNetIncome).toLocaleString('es-CO')} COP
  Tasa de Gastos: ${overheadRate}% (meta: <65%)

PACIENTES:
  Pacientes Nuevos: ${m.totalNewPat} total (${Math.round(m.avgNewPatPerMonth)}/mes en promedio)
  Pacientes Activos: ${m.activePatients}

CITAS:
  Agendadas: ${m.totalScheduled} | Completadas: ${m.totalCompleted}
  Tasa de Ausentismo: ${noShowRate}% (meta: <12%)

TRATAMIENTOS:
  Tasa de Aceptación de Tratamientos: ${acceptanceRate}% (meta: >65%)
  Planes Presentados: ${m.totalPlansPresented} | Aceptados: ${m.totalPlansAccepted}

MEZCLA DE SERVICIOS:
  Higiene: $${Math.round(m.hygieneRevenue).toLocaleString('es-CO')} COP
  Restaurativa: $${Math.round(m.restorativeRevenue).toLocaleString('es-CO')} COP
  Estética: $${Math.round(m.cosmeticRevenue).toLocaleString('es-CO')} COP
  Ortodoncia: $${Math.round(m.orthoRevenue).toLocaleString('es-CO')} COP
=== FIN DE DATOS ===`;
}

function buildForecastDataContext(){
  if(!ALL.length)return'';
  const data=ALL;
  const m=computeMetrics(data);
  const fmtM=mo=>new Date(mo+'-02').toLocaleDateString('es-CO',{month:'long',year:'numeric'});
  const monthRows=data.map(r=>`  ${r.month}: recaudación=$${Math.round(r.collections).toLocaleString('es-CO')}, producción=$${Math.round(r.gross_production).toLocaleString('es-CO')}, pacientes_nuevos=${r.new_patients}, tasa_ausentismo=${r.appointments_scheduled?Math.round(r.no_shows/r.appointments_scheduled*100):0}%, tasa_gastos=${r.collections?Math.round(r.overhead_costs/r.collections*100):0}%`).join('\n');
  const lastThree=data.slice(-3);
  const avgLast3=lastThree.reduce((s,r)=>s+r.collections,0)/lastThree.length;
  const trend=avgLast3>m.avgCollections?'al alza':'a la baja';
  const profileCtx=buildProfileContext();
  return`DATOS HISTÓRICOS (mes a mes):
${monthRows}

RESUMEN:
  Período: ${fmtM(data[0].month)} a ${fmtM(data[data.length-1].month)}
  Recaudación mensual promedio: $${Math.round(m.avgCollections).toLocaleString('es-CO')} COP
  Promedio últimos 3 meses: $${Math.round(avgLast3).toLocaleString('es-CO')} COP
  Tendencia: ${trend}
  Pacientes nuevos/mes promedio: ${Math.round(m.avgNewPatPerMonth)}
  Tasa de gastos promedio: ${Math.round(m.overheadRate)}%
  Aceptación de tratamientos: ${Math.round(m.acceptanceRate)}%
  Tasa de ausentismo: ${Math.round(m.noShowRate)}%
${profileCtx}`;
}
