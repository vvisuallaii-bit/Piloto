-- Migración 0009 (Fase 4B): autenticación real — usuarios + sesiones.
-- Reemplaza el login mock del frontend (Fase 4A) por credenciales verificadas en
-- el backend, resolviendo el Riesgo #1 de la auditoría (roles de fachada).
--
-- No destructiva: solo CREATE ... IF NOT EXISTS. NO toca ninguna tabla existente.
-- En particular NO se modifica el CHECK de tareas.asignado_a ('dueno','recepcionista'):
-- cambiar un CHECK en SQLite/D1 obliga a recrear la tabla con datos reales, riesgo
-- que no vale la pena aquí. El Administrador de sede asigna tareas a 'recepcionista'
-- (ya válido); un tercer valor para asignado_a, si algún día se necesita, es otra
-- migración planeada aparte.
--
-- Aplicar con: npx wrangler d1 migrations apply smile-dental-tareas --remote
-- (sin --remote aplica solo a la copia local de desarrollo)

-- Usuarios del sistema. La contraseña se guarda como hash PBKDF2 + salt por usuario
-- (nunca en claro). practice_id es NULL para rol='dueno' (ve toda la red).
CREATE TABLE IF NOT EXISTS usuarios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  network_id TEXT NOT NULL,
  practice_id TEXT,                     -- NULL para rol='dueno' (ve toda la red)
  nombre TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,          -- PBKDF2-SHA256, hex
  password_salt TEXT NOT NULL,          -- salt aleatorio por usuario, hex
  rol TEXT NOT NULL CHECK (rol IN ('dueno','admin_sede','recepcionista')),
  activo INTEGER NOT NULL DEFAULT 1,
  creado_en TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Sesiones activas. token = crypto.randomUUID() emitido en /auth/login.
-- expira_en en UTC 'YYYY-MM-DD HH:MM:SS' para comparar con datetime('now').
CREATE TABLE IF NOT EXISTS sesiones (
  token TEXT PRIMARY KEY,
  usuario_id INTEGER NOT NULL,
  expira_en TEXT NOT NULL,
  creado_en TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_usuarios_email ON usuarios(email);
CREATE INDEX IF NOT EXISTS idx_sesiones_usuario ON sesiones(usuario_id);
