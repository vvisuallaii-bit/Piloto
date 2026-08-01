-- Migración 0004: monto REAL recuperado por tarea (vs. el valor esperado/ROI).
-- El valor_estimado_cop es lo que la acción DEBERÍA traer (estimación de la IA).
-- valor_real_cop es lo que de verdad entró, que recepción registra al completar
-- una tarea SIN pacientes (ej. "gestionar cobro de la brecha"). Para las tareas
-- CON pacientes, el monto real vive por paciente dentro de la columna JSON
-- `pacientes` (campo monto_real_cop) y no necesita columna aparte.
-- NULL = todavía no registrado.
-- Aplicar con: npx wrangler d1 migrations apply smile-dental-tareas --remote

ALTER TABLE tareas ADD COLUMN valor_real_cop INTEGER;
