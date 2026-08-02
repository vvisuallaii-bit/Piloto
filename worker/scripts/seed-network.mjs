/* Genera el SQL de seed de la red demo "Red Dental Sonrisa" para D1 (Fase 3B):
   networks + 4 practices + 8 doctors + 48 métricas mensuales. Usa los MISMOS
   perfiles/estacionalidad que el demo frontend (js/network-demo.js) para que
   los números coincidan. Idempotente (INSERT OR REPLACE).
   Uso:  node scripts/seed-network.mjs
   Luego: npx wrangler d1 execute smile-dental-tareas --remote --file seed_network.sql */

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const NETWORK = { id: 'red-dental-sonrisa', nombre: 'Red Dental Sonrisa', plan: 'red' };
const WEIGHTS = [1.044, 1.109, 1.140, 1.250, 1.347, 0.635, 0.698, 0.884, 0.957, 1.023, 0.940, 0.973];
const MONTHS = ['2025-08','2025-09','2025-10','2025-11','2025-12','2026-01','2026-02','2026-03','2026-04','2026-05','2026-06','2026-07'];
const PROFILES = [
  { id:'chapinero', name:'Sede Chapinero', city:'Bogotá · Chapinero', avgProd:72, overheadR:0.545, acceptR:0.74, noshowR:0.062, collR:0.975, newPatMo:28, apptsMo:300, baseActive:520, growth:8, mix:{h:0.22,r:0.30,c:0.16,o:0.22}, doctors:['Dra. Valentina Ríos','Dr. Andrés Gómez'] },
  { id:'usaquen', name:'Sede Usaquén', city:'Bogotá · Usaquén', avgProd:58, overheadR:0.615, acceptR:0.67, noshowR:0.093, collR:0.96, newPatMo:23, apptsMo:262, baseActive:470, growth:6, mix:{h:0.24,r:0.32,c:0.12,o:0.22}, doctors:['Dra. Camila Torres','Dr. Felipe Navarro'] },
  { id:'suba', name:'Sede Suba', city:'Bogotá · Suba', avgProd:50, overheadR:0.632, acceptR:0.64, noshowR:0.105, collR:0.95, newPatMo:21, apptsMo:240, baseActive:430, growth:5, mix:{h:0.25,r:0.32,c:0.10,o:0.21}, doctors:['Dr. Julián Mesa','Dra. Paola Castro'] },
  { id:'kennedy', name:'Sede Kennedy', city:'Bogotá · Kennedy', avgProd:38, overheadR:0.685, acceptR:0.52, noshowR:0.163, collR:0.925, newPatMo:14, apptsMo:210, baseActive:360, growth:4, mix:{h:0.27,r:0.30,c:0.07,o:0.18}, doctors:['Dr. Óscar Peña','Dra. Marcela Duque'] },
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
    return {
      month, gross_production: gross, collections, new_patients: Math.round(p.newPatMo * w),
      active_patients: p.baseActive + Math.round(k * p.growth), appointments_scheduled: scheduled,
      appointments_completed: scheduled - noShows - cancellations, cancellations, no_shows: noShows,
      treatment_plans_presented: presented, treatment_plans_accepted: Math.round(presented * p.acceptR),
      hygiene_revenue: r10k(gross * p.mix.h), restorative_revenue: r10k(gross * p.mix.r),
      cosmetic_revenue: r10k(gross * p.mix.c), orthodontic_revenue: r10k(gross * p.mix.o),
      overhead_costs: overhead, staff_costs: r10k(overhead * 0.66), supplies_costs: r10k(overhead * 0.17),
      net_income: collections - overhead,
    };
  });
}

const MCOLS = ['month','gross_production','collections','new_patients','active_patients','appointments_scheduled','appointments_completed','cancellations','no_shows','treatment_plans_presented','treatment_plans_accepted','hygiene_revenue','restorative_revenue','cosmetic_revenue','orthodontic_revenue','overhead_costs','staff_costs','supplies_costs','net_income'];

const out = ['-- Seed red demo (Fase 3B) — generado por scripts/seed-network.mjs. NO editar a mano.'];
out.push(`INSERT OR REPLACE INTO networks (network_id, nombre, plan) VALUES (${q(NETWORK.id)}, ${q(NETWORK.nombre)}, ${q(NETWORK.plan)});`);
out.push('');
for (const p of PROFILES) {
  out.push(`INSERT OR REPLACE INTO practices (practice_id, network_id, nombre, ciudad, perfil, activo) VALUES (${q(p.id)}, ${q(NETWORK.id)}, ${q(p.name)}, ${q(p.city)}, NULL, 1);`);
  for (const d of p.doctors) out.push(`INSERT INTO doctors (practice_id, nombre) SELECT ${q(p.id)}, ${q(d)} WHERE NOT EXISTS (SELECT 1 FROM doctors WHERE practice_id=${q(p.id)} AND nombre=${q(d)});`);
  for (const r of buildData(p)) {
    const vals = MCOLS.map(c => c === 'month' ? q(r.month) : r[c]);
    out.push(`INSERT OR REPLACE INTO metricas_mensuales (practice_id, ${MCOLS.join(', ')}) VALUES (${q(p.id)}, ${vals.join(', ')});`);
  }
  out.push('');
}

const dest = join(dirname(fileURLToPath(import.meta.url)), '..', 'seed_network.sql');
writeFileSync(dest, out.join('\n') + '\n', 'utf8');
console.log(`OK: red ${NETWORK.id} · ${PROFILES.length} sedes · ${PROFILES.length * 2} doctores · ${PROFILES.length * MONTHS.length} métricas → ${dest}`);
