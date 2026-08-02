-- Migración 0008 (Fase 3C): métricas agregadas por odontólogo, para el ranking
-- cross-sede. En un cliente real las llenaría su sistema/registro; en el demo
-- se siembran desde los mismos perfiles de sede. No destructiva (ADD COLUMN).
-- Aplicar con: wrangler d1 execute smile-dental-tareas --remote --file migrations/0008_doctor_metricas.sql

ALTER TABLE doctors ADD COLUMN produccion_cop INTEGER;   -- producción del doctor (período)
ALTER TABLE doctors ADD COLUMN aceptacion REAL;          -- % aceptación de tratamientos
ALTER TABLE doctors ADD COLUMN ausentismo REAL;          -- % ausentismo de sus pacientes
