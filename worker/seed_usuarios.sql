-- Seed usuarios demo (Fase 4B) — generado por scripts/seed-usuarios.mjs. NO editar a mano.
DELETE FROM usuarios WHERE email IN ('gerente@smiledental.demo', 'admin.sede@smiledental.demo', 'recepcion@smiledental.demo');

INSERT INTO usuarios (network_id, practice_id, nombre, email, password_hash, password_salt, rol, activo) VALUES ('red-dental-sonrisa', NULL, 'Gerente de Red', 'gerente@smiledental.demo', '22fb7184c0caf3702e45352f382b10fa931e9e36db6b1aac8a808540937236d0', '289c3ee7240363aa94cd040a6714c6f0', 'dueno', 1);
INSERT INTO usuarios (network_id, practice_id, nombre, email, password_hash, password_salt, rol, activo) VALUES ('red-dental-sonrisa', 'chapinero', 'Admin Chapinero', 'admin.sede@smiledental.demo', 'c91b1220f500e20e829790cb5022c66c0db6d58b611c2969cebb8b0d1985160e', 'fad4ed5ad05faf69daefc12dc86492bb', 'admin_sede', 1);
INSERT INTO usuarios (network_id, practice_id, nombre, email, password_hash, password_salt, rol, activo) VALUES ('red-dental-sonrisa', 'chapinero', 'Recepción Chapinero', 'recepcion@smiledental.demo', '85504e8bbaf4fc82f0744f5d57cbb4606a74230935342dff9078fc9153e054d0', 'a6b0dbabf1ca2a3902ced87d6b492030', 'recepcionista', 1);
