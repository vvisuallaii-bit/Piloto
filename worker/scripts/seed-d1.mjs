/* Genera el SQL de seed para D1 a partir de los mismos archivos que usa el
   frontend: ../../smile_dental_demo.csv (métricas) y ../../pacientes.json
   (roster). Salida: worker/seed_smile_dental.sql (INSERT OR REPLACE, idempotente).
   Uso:  node scripts/seed-d1.mjs
   Luego: npx wrangler d1 execute smile-dental-tareas --remote --file seed_smile_dental.sql

   Para re-sembrar tras actualizar el CSV/pacientes, vuelve a correrlo y aplica. */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repo = join(__dirname, '..', '..');            // carpeta Piloto
const PRACTICE_ID = 'smile-dental';
const NOMBRE = 'Smile Dental';

const q = (v) => v === null || v === undefined ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`;
const n = (v) => { const x = Number(v); return Number.isFinite(x) ? Math.round(x) : 0; };

/* ── Métricas (CSV) ── */
const csv = readFileSync(join(repo, 'smile_dental_demo.csv'), 'utf8').trim().split(/\r?\n/);
const cols = csv[0].split(',');
const metricCols = ['month','gross_production','collections','new_patients','active_patients',
  'appointments_scheduled','appointments_completed','cancellations','no_shows',
  'treatment_plans_presented','treatment_plans_accepted','hygiene_revenue','restorative_revenue',
  'cosmetic_revenue','orthodontic_revenue','overhead_costs','staff_costs','supplies_costs','net_income'];
for (const c of metricCols) if (!cols.includes(c)) throw new Error(`Falta columna en el CSV: ${c}`);

const metricRows = csv.slice(1).filter(l => l.trim()).map(line => {
  const cells = line.split(',');
  const r = {};
  cols.forEach((c, i) => r[c] = cells[i]);
  return r;
});

/* ── Pacientes (JSON) ── */
const pacientes = JSON.parse(readFileSync(join(repo, 'pacientes.json'), 'utf8'));

/* ── Emitir SQL ── */
const out = [];
out.push('-- Seed generado por scripts/seed-d1.mjs — NO editar a mano.');
out.push(`-- Clínica: ${NOMBRE} (${PRACTICE_ID}) · ${metricRows.length} meses · ${pacientes.length} pacientes`);
out.push('');
out.push(`INSERT OR REPLACE INTO practices (practice_id, nombre, perfil, activo) VALUES (${q(PRACTICE_ID)}, ${q(NOMBRE)}, NULL, 1);`);
out.push('');

for (const r of metricRows) {
  const vals = metricCols.map(c => c === 'month' ? q(r.month) : n(r[c]));
  out.push(`INSERT OR REPLACE INTO metricas_mensuales (practice_id, ${metricCols.join(', ')}) VALUES (${q(PRACTICE_ID)}, ${vals.join(', ')});`);
}
out.push('');

for (const p of pacientes) {
  out.push(`INSERT OR REPLACE INTO pacientes (practice_id, pid, nombre, telefono, ultima_consulta, que_paso, proximos_pasos, motivo, valor_pendiente_cop) VALUES (`
    + [q(PRACTICE_ID), q(p.id), q(p.nombre), q(p.telefono), q(p.ultima_consulta), q(p.que_paso), q(p.proximos_pasos), q(p.motivo), n(p.valor_pendiente_cop)].join(', ') + ');');
}

const dest = join(__dirname, '..', 'seed_smile_dental.sql');
writeFileSync(dest, out.join('\n') + '\n', 'utf8');
console.log(`OK: ${metricRows.length} meses, ${pacientes.length} pacientes → ${dest}`);
