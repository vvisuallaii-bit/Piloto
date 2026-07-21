-- Migración 0001: tabla de tareas/alertas semanales (Fase 2)
-- Aplicar con: npx wrangler d1 migrations apply smile-dental-tareas --remote
-- (ver worker/README.md para el flujo completo)

CREATE TABLE tareas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  practice_id TEXT NOT NULL,
  semana TEXT NOT NULL,                 -- formato ISO: '2026-07-13' (lunes de esa semana)
  titulo TEXT NOT NULL,
  descripcion TEXT,
  categoria TEXT NOT NULL,              -- 'recall_inactivos' | 'no_shows' | 'aceptacion_tratamiento' | 'seguimiento_post' | 'otro'
  asignado_a TEXT NOT NULL CHECK (asignado_a IN ('dueno', 'recepcionista')),
  prioridad TEXT NOT NULL CHECK (prioridad IN ('alta', 'media', 'baja')),
  estado TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'en_proceso', 'completada', 'descartada')),
  valor_estimado_cop INTEGER DEFAULT 0,
  resultado TEXT CHECK (resultado IN ('agendo_cita', 'no_respondio', 'no_aplicaba', NULL)),
  fecha_limite TEXT,                    -- ISO date, opcional
  fuente TEXT NOT NULL DEFAULT 'manual' CHECK (fuente IN ('ia_semanal', 'manual')),
  completado_por TEXT,
  completado_en TEXT,                   -- ISO datetime
  creado_en TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_tareas_practice ON tareas(practice_id);
CREATE INDEX idx_tareas_estado ON tareas(practice_id, estado);
