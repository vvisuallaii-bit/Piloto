/* Extiende smile_dental_demo.csv de 12 a 24 meses: PREPENDE el año previo
   (ago 2024 – jul 2025) generándolo a partir de cada mes reciente del mismo
   nombre, escalado ~10% abajo (crecimiento año-a-año) y con métricas de calidad
   un poco peores (para que la comparación "vs año pasado" muestre mejora).
   Los 12 meses recientes quedan IDÉNTICOS. Así se activa el YoY del health score.
   Uso: node scripts/extend-demo-24m.mjs   (sobreescribe smile_dental_demo.csv)
   Reproducible/determinista. Los datos son ficticios de demostración. */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const csvPath = join(repo, 'smile_dental_demo.csv');

const lines = readFileSync(csvPath, 'utf8').trim().split(/\r?\n/);
const header = lines[0];
const cols = header.split(',');
const rows = lines.slice(1).map(l => {
  const c = l.split(',');
  const o = {};
  cols.forEach((k, i) => o[k] = k === 'month' ? c[i] : Number(c[i]));
  return o;
});

// Solo extendemos si aún son 12 meses (idempotente si ya se corrió).
if (rows.length !== 12) {
  console.log(`El CSV ya tiene ${rows.length} meses; no se hace nada.`);
  process.exit(0);
}

const round10k = n => Math.round(n / 10000) * 10000;
const prevYear = m => (Number(m.slice(0, 4)) - 1) + m.slice(4);

// Factor de crecimiento por mes (prior = reciente × f). YoY ≈ 1/f − 1 (~8–15%).
const F = [0.90, 0.89, 0.91, 0.88, 0.90, 0.92, 0.91, 0.89, 0.90, 0.88, 0.91, 0.90];
// Pacientes activos del año previo (crecen suave hasta justo debajo de 385).
const ACT = [349, 356, 362, 367, 371, 373, 374, 376, 378, 380, 381, 383];

const prior = rows.map((R, i) => {
  const f = F[i];
  const gross = round10k(R.gross_production * f);
  const collections = round10k(gross * 0.955);            // cobro previo ~95.5% (vs ~96.5% hoy)
  const ovRate = R.overhead_costs / R.collections + 0.015; // ~1.5 pts más de gastos (peor)
  const overhead = round10k(collections * ovRate);
  const staff = round10k(overhead * (R.staff_costs / R.overhead_costs));
  const supplies = round10k(overhead * (R.supplies_costs / R.overhead_costs));
  const scheduled = Math.round(R.appointments_scheduled * f);
  const cancellations = Math.round(R.cancellations * f);
  const noShows = Math.round(R.no_shows * f * 1.12);       // ausentismo un poco peor
  const completed = scheduled - cancellations - noShows;
  return {
    month: prevYear(R.month),
    gross_production: gross,
    collections,
    new_patients: Math.round(R.new_patients * f * 0.95),
    active_patients: ACT[i],
    appointments_scheduled: scheduled,
    appointments_completed: completed,
    cancellations,
    no_shows: noShows,
    treatment_plans_presented: Math.round(R.treatment_plans_presented * f),
    treatment_plans_accepted: Math.round(R.treatment_plans_accepted * f * 0.94), // aceptación algo menor
    hygiene_revenue: round10k(R.hygiene_revenue * f),
    restorative_revenue: round10k(R.restorative_revenue * f),
    cosmetic_revenue: round10k(R.cosmetic_revenue * f),
    orthodontic_revenue: round10k(R.orthodontic_revenue * f),
    overhead_costs: overhead,
    staff_costs: staff,
    supplies_costs: supplies,
    net_income: collections - overhead,                    // relación exacta
  };
});

const all = [...prior, ...rows];   // prior (2024-08..2025-07) + reciente (2025-08..2026-07)
const out = [header, ...all.map(r => cols.map(k => r[k]).join(','))].join('\n') + '\n';
writeFileSync(csvPath, out, 'utf8');
console.log(`OK: ${all.length} meses (${all[0].month} … ${all[all.length - 1].month}) → smile_dental_demo.csv`);
