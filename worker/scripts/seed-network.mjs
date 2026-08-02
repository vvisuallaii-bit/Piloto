/* Seed de la red demo "Red Dental Sonrisa" para D1 (Fases 3B/3C):
   networks + practices + doctors (con métricas) + tareas demo por sede +
   métricas mensuales. Usa los MISMOS perfiles que el frontend (network-demo.js)
   para que todo cuadre. Idempotente: borra y re-inserta lo de la red.
   Uso:  node scripts/seed-network.mjs
   Luego: npx wrangler d1 execute smile-dental-tareas --remote --file seed_network.sql */

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const NETWORK = { id: 'red-dental-sonrisa', nombre: 'Red Dental Sonrisa', plan: 'red' };
const WEIGHTS = [1.044, 1.109, 1.140, 1.250, 1.347, 0.635, 0.698, 0.884, 0.957, 1.023, 0.940, 0.973];
const MONTHS = ['2025-08','2025-09','2025-10','2025-11','2025-12','2026-01','2026-02','2026-03','2026-04','2026-05','2026-06','2026-07'];
const PROFILES = [
  { id:'chapinero', name:'Sede Chapinero', city:'Bogotá · Chapinero', avgProd:72, overheadR:0.545, acceptR:0.74, noshowR:0.062, collR:0.975, newPatMo:28, apptsMo:300, baseActive:520, growth:8, mix:{h:0.22,r:0.30,c:0.16,o:0.22}, doctors:[['Dra. Valentina Ríos',0.55,0.76],['Dr. Andrés Gómez',0.45,0.71]] },
  { id:'usaquen', name:'Sede Usaquén', city:'Bogotá · Usaquén', avgProd:58, overheadR:0.615, acceptR:0.67, noshowR:0.093, collR:0.96, newPatMo:23, apptsMo:262, baseActive:470, growth:6, mix:{h:0.24,r:0.32,c:0.12,o:0.22}, doctors:[['Dra. Camila Torres',0.52,0.69],['Dr. Felipe Navarro',0.48,0.66]] },
  { id:'suba', name:'Sede Suba', city:'Bogotá · Suba', avgProd:50, overheadR:0.632, acceptR:0.64, noshowR:0.105, collR:0.95, newPatMo:21, apptsMo:240, baseActive:430, growth:5, mix:{h:0.25,r:0.32,c:0.10,o:0.21}, doctors:[['Dr. Julián Mesa',0.54,0.67],['Dra. Paola Castro',0.46,0.63]] },
  { id:'kennedy', name:'Sede Kennedy', city:'Bogotá · Kennedy', avgProd:38, overheadR:0.685, acceptR:0.52, noshowR:0.163, collR:0.925, newPatMo:14, apptsMo:210, baseActive:360, growth:4, mix:{h:0.27,r:0.30,c:0.07,o:0.18}, doctors:[['Dr. Óscar Peña',0.51,0.54],['Dra. Marcela Duque',0.49,0.49]] },
];
const r10k = n => Math.round(n / 10000) * 10000;
const q = v => v === null || v === undefined ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`;

function buildData(p) {
  return MONTHS.map((month, k) => {
    const w = WEIGHTS[k];
    const gross = r10k(p.avgProd * 1e6 * w);
    const collections = r10k(gross * p.collR);
    const overhead = r10k(collections * p.overheadR);
    const scheduled = Math.round(p.apptsMo * w);
    const noShows = Math.round(scheduled * p.noshowR);
    const cancellations = Math.round(scheduled * 0.05);
    const presented = Math.round(scheduled * 0.34);
    return { month, gross_production: gross, collections, new_patients: Math.round(p.newPatMo * w),
      active_patients: p.baseActive + Math.round(k * p.growth), appointments_scheduled: scheduled,
      appointments_completed: scheduled - noShows - cancellations, cancellations, no_shows: noShows,
      treatment_plans_presented: presented, treatment_plans_accepted: Math.round(presented * p.acceptR),
      hygiene_revenue: r10k(gross * p.mix.h), restorative_revenue: r10k(gross * p.mix.r),
      cosmetic_revenue: r10k(gross * p.mix.c), orthodontic_revenue: r10k(gross * p.mix.o),
      overhead_costs: overhead, staff_costs: r10k(overhead * 0.66), supplies_costs: r10k(overhead * 0.17),
      net_income: collections - overhead };
  });
}
function agg(rows) {
  const s = k => rows.reduce((a, r) => a + r[k], 0);
  const coll = s('collections'), prod = s('gross_production'), sched = s('appointments_scheduled'), pres = s('treatment_plans_presented');
  return { coll, prod, ov: coll ? s('overhead_costs') / coll * 100 : 0, ac: pres ? s('treatment_plans_accepted') / pres * 100 : 0,
    ns: sched ? s('no_shows') / sched * 100 : 0, noShows: s('no_shows'), presNoAcc: pres - s('treatment_plans_accepted'),
    newPat: s('new_patients'), grossAnnual: prod };
}

/* ── Tareas demo por sede, DERIVADAS de las métricas (igual que el frontend). ── */
function lunes() { const d = new Date(); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
const PAC = [['María F. Ríos','+57 310 456 7890'],['Carlos A. Gómez','+57 311 234 5678'],['Luisa Martínez','+57 312 987 6543'],['Jorge Patiño','+57 300 111 2233'],['Diana Vargas','+57 315 555 4411'],['Andrés Torres','+57 320 777 8899'],['Paola Suárez','+57 301 222 3344'],['Ricardo Mejía','+57 313 444 5566'],['Natalia Restrepo','+57 317 656 2211'],['Óscar Cardona','+57 314 909 8877']];
function pac(sidx, off, list) {
  return list.map((x, i) => { const p = PAC[(sidx * 3 + off + i) % PAC.length];
    return { id: `P${sidx}-${off}-${i}`, nombre: p[0], telefono: p[1], ultima_consulta: '2026-06-15', que_paso: '', accion: x.a, valor_pendiente_cop: x.v, estado: x.e || 'pendiente', monto_real_cop: x.mr === undefined ? null : x.mr }; });
}
function buildTasks(p, sidx, m) {
  const semana = lunes(), k = p.avgProd / 58, V = n => Math.round(n * k / 10000) * 10000;
  const noShowsMes = Math.max(3, Math.round(m.noShows / 12)), planesNoAcMes = Math.max(2, Math.round(m.presNoAcc / 12));
  const gapMes = Math.round((m.prod - m.coll) / 12), inactivosMes = Math.max(6, Math.round(m.newPat / 12 * 0.6));
  const tasks = []; let id = 0;
  const push = o => tasks.push({ semana, fuente: 'ia_semanal', resultado: null, fecha_limite: null, completado_por: null, completado_en: null, valor_real_cop: null, estado: 'pendiente', valor_estimado_cop: 0, pacientes: null, _n: ++id, ...o });
  push({ titulo: `Llamar a ${inactivosMes} pacientes inactivos de alto valor`, descripcion: 'Pacientes sin cita en 6+ meses con tratamientos pendientes.', categoria: 'recall_inactivos', asignado_a: 'recepcionista', prioridad: 'alta', estado: 'completada', resultado: 'agendo_cita', completado_por: 'recepcionista', valor_estimado_cop: V(3600000), pacientes: pac(sidx, 0, [{ v: V(2700000), e: 'agendo_cita', mr: V(2700000), a: 'Cerró valoración de implante con abono a favor' }, { v: V(320000), e: 'agendo_cita', mr: V(320000), a: 'Agendó resina y control de higiene' }, { v: V(680000), e: 'no_respondio', a: 'Reintentar llamada esta semana' }]) });
  if (m.ns >= 8) { const grave = m.ns >= 12;
    push({ titulo: `Reagendar ${noShowsMes} no-shows del mes`, descripcion: `Ausentismo en ${Math.round(m.ns)}% (meta <12%). Reagendar y confirmar 24h antes.`, categoria: 'no_shows', asignado_a: 'recepcionista', prioridad: grave ? 'alta' : 'media', estado: grave ? 'pendiente' : 'en_proceso', valor_estimado_cop: V(grave ? 2400000 : 1400000), pacientes: pac(sidx, 3, [{ v: V(850000), a: 'Reagendar endodoncia — prioritario por dolor' }, { v: V(1350000), e: grave ? 'pendiente' : 'agendo_cita', mr: grave ? undefined : V(1350000), a: 'Reagendar corona; verificar teléfono' }, ...(grave ? [{ v: V(180000), a: 'Segunda inasistencia — explicar política' }] : [])]) }); }
  if (m.ac < 68) push({ titulo: `Re-presentar ${planesNoAcMes} planes de tratamiento no aceptados`, descripcion: `Aceptación en ${Math.round(m.ac)}% (meta >65%). Re-presentar los de mayor valor y ofrecer financiación.`, categoria: 'aceptacion_tratamiento', asignado_a: 'dueno', prioridad: m.ac < 55 ? 'alta' : 'media', estado: 'pendiente', valor_estimado_cop: V(m.ac < 55 ? 5200000 : 3400000), pacientes: pac(sidx, 6, [{ v: V(3800000), a: 'Re-presentar plan de implante con simulación' }, { v: V(2700000), a: 'Resolver dudas de costo del plan de coronas' }]) });
  push({ titulo: `Gestionar cobro de cartera ($${(gapMes / 1e6).toFixed(1)}M/mes sin cobrar)`, descripcion: 'Saldos de tratamientos ya realizados sin cobrar; recordatorios y planes de pago.', categoria: 'otro', asignado_a: 'recepcionista', prioridad: 'media', estado: 'pendiente', valor_estimado_cop: Math.max(V(1500000), gapMes) });
  if (m.ov >= 65) push({ titulo: `Revisar estructura de gastos (${Math.round(m.ov)}%, meta <65%)`, descripcion: 'Comparar personal vs. producción e insumos contra las sedes más eficientes.', categoria: 'otro', asignado_a: 'dueno', prioridad: 'media', estado: 'pendiente', valor_estimado_cop: 0 });
  if (m.ov < 55 && m.ac > 65 && m.ns < 8) push({ titulo: 'Evaluar ampliar capacidad — la sede va sobre meta', descripcion: 'Cumple las 4 metas; el límite es capacidad instalada.', categoria: 'otro', asignado_a: 'dueno', prioridad: 'baja', estado: 'pendiente', valor_estimado_cop: 0 });
  return tasks;
}

const MCOLS = ['month','gross_production','collections','new_patients','active_patients','appointments_scheduled','appointments_completed','cancellations','no_shows','treatment_plans_presented','treatment_plans_accepted','hygiene_revenue','restorative_revenue','cosmetic_revenue','orthodontic_revenue','overhead_costs','staff_costs','supplies_costs','net_income'];
const sedeIds = PROFILES.map(p => p.id).map(q).join(', ');

const out = ['-- Seed red demo (Fases 3B/3C) — generado por scripts/seed-network.mjs. NO editar a mano.'];
out.push(`INSERT OR REPLACE INTO networks (network_id, nombre, plan) VALUES (${q(NETWORK.id)}, ${q(NETWORK.nombre)}, ${q(NETWORK.plan)});`);
out.push(`DELETE FROM doctors WHERE practice_id IN (${sedeIds});`);
out.push(`DELETE FROM tareas WHERE practice_id IN (${sedeIds});`);
out.push('');
PROFILES.forEach((p, sidx) => {
  const data = buildData(p), m = agg(data);
  out.push(`INSERT OR REPLACE INTO practices (practice_id, network_id, nombre, ciudad, perfil, activo) VALUES (${q(p.id)}, ${q(NETWORK.id)}, ${q(p.name)}, ${q(p.city)}, NULL, 1);`);
  p.doctors.forEach(([name, share, acc], di) => {
    const prod = Math.round(m.grossAnnual * share);
    const ausent = Math.round(m.ns * (di === 0 ? 0.9 : 1.1) * 10) / 10;
    out.push(`INSERT INTO doctors (practice_id, nombre, produccion_cop, aceptacion, ausentismo) VALUES (${q(p.id)}, ${q(name)}, ${prod}, ${Math.round(acc * 100 * 10) / 10}, ${ausent});`);
  });
  for (const r of data) out.push(`INSERT OR REPLACE INTO metricas_mensuales (practice_id, ${MCOLS.join(', ')}) VALUES (${q(p.id)}, ${MCOLS.map(c => c === 'month' ? q(r.month) : r[c]).join(', ')});`);
  for (const t of buildTasks(p, sidx, m)) {
    out.push(`INSERT INTO tareas (practice_id, semana, titulo, descripcion, categoria, asignado_a, prioridad, estado, valor_estimado_cop, resultado, fuente, completado_por, pacientes, valor_real_cop) VALUES (${q(p.id)}, ${q(t.semana)}, ${q(t.titulo)}, ${q(t.descripcion)}, ${q(t.categoria)}, ${q(t.asignado_a)}, ${q(t.prioridad)}, ${q(t.estado)}, ${t.valor_estimado_cop}, ${q(t.resultado)}, ${q(t.fuente)}, ${q(t.completado_por)}, ${t.pacientes ? q(JSON.stringify(t.pacientes)) : 'NULL'}, ${t.valor_real_cop === null ? 'NULL' : t.valor_real_cop});`);
  }
  out.push('');
});

const dest = join(dirname(fileURLToPath(import.meta.url)), '..', 'seed_network.sql');
writeFileSync(dest, out.join('\n') + '\n', 'utf8');
console.log(`OK: ${PROFILES.length} sedes · ${PROFILES.length * 2} doctores (con métricas) · tareas demo · ${PROFILES.length * MONTHS.length} métricas → ${dest}`);
