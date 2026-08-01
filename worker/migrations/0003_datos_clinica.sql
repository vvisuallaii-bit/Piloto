-- Migración 0003: datos de la clínica EN D1 (Paso 2 — cron sin navegador).
-- Hasta ahora las métricas vivían en un CSV que cargaba el navegador y los
-- pacientes en pacientes.json; el perfil, en localStorage. Para que un cron
-- (scheduled handler) genere las tareas semanales sin browser, esos tres datos
-- se guardan aquí, keyed por practice_id (mismo slug que usa el frontend).
-- Aplicar con: npx wrangler d1 migrations apply smile-dental-tareas --remote

-- Una fila por clínica. El cron itera sobre las que tienen activo=1.
CREATE TABLE IF NOT EXISTS practices (
  practice_id TEXT PRIMARY KEY,        -- slug: 'smile-dental'
  nombre TEXT NOT NULL,                -- nombre para el prompt / white-label
  perfil TEXT,                         -- JSON del perfil de la clínica (o NULL)
  activo INTEGER NOT NULL DEFAULT 1,   -- 1 = el cron genera tareas para esta clínica
  creado_en TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Métricas mensuales (las mismas columnas del CSV). computeMetrics() se replica
-- en el Worker y agrega sobre TODAS las filas de la clínica.
CREATE TABLE IF NOT EXISTS metricas_mensuales (
  practice_id TEXT NOT NULL,
  month TEXT NOT NULL,                 -- 'YYYY-MM'
  gross_production INTEGER,
  collections INTEGER,
  new_patients INTEGER,
  active_patients INTEGER,
  appointments_scheduled INTEGER,
  appointments_completed INTEGER,
  cancellations INTEGER,
  no_shows INTEGER,
  treatment_plans_presented INTEGER,
  treatment_plans_accepted INTEGER,
  hygiene_revenue INTEGER,
  restorative_revenue INTEGER,
  cosmetic_revenue INTEGER,
  orthodontic_revenue INTEGER,
  overhead_costs INTEGER,
  staff_costs INTEGER,
  supplies_costs INTEGER,
  net_income INTEGER,
  PRIMARY KEY (practice_id, month)
);

-- Roster de pacientes accionables (equivalente a pacientes.json). La IA elige
-- de aquí por 'pid' y el Worker enriquece nombre/teléfono/valor.
CREATE TABLE IF NOT EXISTS pacientes (
  practice_id TEXT NOT NULL,
  pid TEXT NOT NULL,                   -- ID del roster: 'P001'
  nombre TEXT NOT NULL,
  telefono TEXT,
  ultima_consulta TEXT,
  que_paso TEXT,
  proximos_pasos TEXT,
  motivo TEXT,                         -- recall_inactivos | no_shows | tratamiento_pendiente | al_dia | ...
  valor_pendiente_cop INTEGER DEFAULT 0,
  PRIMARY KEY (practice_id, pid)
);

CREATE INDEX IF NOT EXISTS idx_pac_practice_motivo ON pacientes(practice_id, motivo);
