-- Migración 0007: migra las clínicas de sede única existentes al modelo de red.
-- Cada practice que aún no tiene network_id se convierte en su propia red
-- (network_id = practice_id), sin tocar métricas ni tareas (ya llevan
-- practice_id). Retro-compatible y sin pérdida de datos: las clínicas de sede
-- única quedan como una red de 1 sede y siguen funcionando igual.
-- Idempotente (INSERT OR IGNORE + UPDATE condicional).

-- 1) Una red por cada practice existente (mismo id/slug y nombre).
INSERT OR IGNORE INTO networks (network_id, nombre, plan)
  SELECT practice_id, nombre, 'piloto' FROM practices WHERE network_id IS NULL;

-- 2) Vincular cada practice a su red.
UPDATE practices SET network_id = practice_id WHERE network_id IS NULL;
