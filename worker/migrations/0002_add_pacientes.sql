-- Migración 0002: lista de pacientes asociada a cada tarea (JSON)
-- Cada tarea de contacto (recall, no-shows, seguimiento…) puede llevar la
-- lista concreta de pacientes a gestionar, con su acción específica.
-- Se guarda como TEXT (JSON serializado); el Worker lo parsea al leer.
-- Aplicar con: npx wrangler d1 migrations apply smile-dental-tareas --remote

ALTER TABLE tareas ADD COLUMN pacientes TEXT;
