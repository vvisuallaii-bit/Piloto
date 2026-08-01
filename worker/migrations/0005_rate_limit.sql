-- Migración 0005: rate-limit por IP para el proxy de Claude (POST /).
-- Ventana fija por minuto: una fila por (ip, minuto). Se limpia sola (las
-- ventanas viejas se borran periódicamente). Protege la API key de Anthropic
-- de abuso de volumen desde la URL pública del Worker.
-- Aplicar con: npx wrangler d1 execute smile-dental-tareas --remote --file migrations/0005_rate_limit.sql

CREATE TABLE IF NOT EXISTS rate_limit (
  bucket TEXT PRIMARY KEY,   -- 'ip:minuto'
  win INTEGER NOT NULL,      -- minuto (epoch/60000) para poder purgar por rango
  count INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_rate_limit_win ON rate_limit(win);
