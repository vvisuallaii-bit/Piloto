-- Migración 0006: modelo de datos multi-sede (Fase 3B).
-- Una clínica de sede única = una red (network) con UNA sola sede (practice).
-- No hay dos sistemas paralelos: todo pasa por networks → practices → (métricas,
-- tareas, doctores), que ya llevan practice_id desde la Fase 2/Paso 2.
--
-- Convención de nombres: se sigue la del schema EXISTENTE (practice_id/nombre/
-- creado_en en snake_case; columnas de métricas en inglés por venir del CSV).
-- Se mantiene por coherencia con practices/tareas ya creadas.
--
-- No destructiva: solo CREATE y ALTER ADD COLUMN. Backup previo en
-- worker/backups/. Aplicar con: wrangler d1 execute ... --file (ver README).

-- Redes (el dueño / grupo). Una sede única es una red de 1 sede.
CREATE TABLE IF NOT EXISTS networks (
  network_id TEXT PRIMARY KEY,          -- slug: 'smile-dental' | 'red-dental-sonrisa'
  nombre TEXT NOT NULL,
  plan TEXT,                            -- tier/plan (texto por ahora): 'piloto' | 'red' | ...
  creado_en TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Sedes: practices ya existe (Paso 2). Se le agrega el vínculo a la red + datos
-- de ubicación. network_id referencia networks(network_id).
ALTER TABLE practices ADD COLUMN network_id TEXT;
ALTER TABLE practices ADD COLUMN ciudad TEXT;
ALTER TABLE practices ADD COLUMN direccion TEXT;

-- Odontólogos por sede (habilita el ranking cross-sede de la Fase 3C).
CREATE TABLE IF NOT EXISTS doctors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  practice_id TEXT NOT NULL,            -- FK → practices(practice_id)
  nombre TEXT NOT NULL,
  fecha_ingreso TEXT,                   -- ISO date, opcional
  creado_en TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_practices_network ON practices(network_id);
CREATE INDEX IF NOT EXISTS idx_doctors_practice ON doctors(practice_id);
