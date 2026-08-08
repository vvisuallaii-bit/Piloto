/* Seed de los 3 usuarios de ejemplo (Fase 4B) para D1, con contraseña real
   hasheada (PBKDF2-SHA256). Mismos emails/roles que el login mock de la Fase 4A,
   pero ahora la contraseña vive hasheada en el backend, no en el JS del navegador.

   ⚠ Los parámetros de hashing (iteraciones, longitud, salt) DEBEN coincidir con
   src/index.js (constantes PBKDF2_ITER / PBKDF2_KEYLEN y verifyPassword). Si allá
   cambian, cámbialos aquí o el login no validará.

   Para el piloto: la misma contraseña 'demo2026' para los 3 (cada uno con su
   propio salt aleatorio). Cámbiala aquí antes de sembrar si quieres otra.

   Uso:  node scripts/seed-usuarios.mjs
   Luego: npx wrangler d1 execute smile-dental-tareas --remote --file seed_usuarios.sql */

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// ── Contrato de hashing — idéntico a src/index.js ──
const PBKDF2_ITER = 100000;
const PBKDF2_KEYLEN = 32;   // bytes
const bufToHex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: PBKDF2_ITER, hash: 'SHA-256' }, key, PBKDF2_KEYLEN * 8);
  return { hash: bufToHex(bits), salt: bufToHex(salt) };
}

const PASSWORD = 'demo2026';   // ← piloto: misma clave para los 3 (cada uno con salt propio)

// Mismos usuarios que AUTH_USERS en js/auth.js (Fase 4A).
const USUARIOS = [
  { nombre: 'Gerente de Red',      email: 'gerente@smiledental.demo',    rol: 'dueno',         network_id: 'red-dental-sonrisa', practice_id: null },
  { nombre: 'Admin Chapinero',     email: 'admin.sede@smiledental.demo', rol: 'admin_sede',    network_id: 'red-dental-sonrisa', practice_id: 'chapinero' },
  { nombre: 'Recepción Chapinero', email: 'recepcion@smiledental.demo',  rol: 'recepcionista', network_id: 'red-dental-sonrisa', practice_id: 'chapinero' },
];

const q = v => v === null || v === undefined ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`;

const out = ['-- Seed usuarios demo (Fase 4B) — generado por scripts/seed-usuarios.mjs. NO editar a mano.'];
// Idempotente: re-sembrar reemplaza estos usuarios. (Sus sesiones viejas quedan
// huérfanas y expiran solas; para el piloto es aceptable.)
out.push(`DELETE FROM usuarios WHERE email IN (${USUARIOS.map(u => q(u.email)).join(', ')});`);
out.push('');

for (const u of USUARIOS) {
  const { hash, salt } = await hashPassword(PASSWORD);
  out.push(
    `INSERT INTO usuarios (network_id, practice_id, nombre, email, password_hash, password_salt, rol, activo) ` +
    `VALUES (${q(u.network_id)}, ${q(u.practice_id)}, ${q(u.nombre)}, ${q(u.email)}, ${q(hash)}, ${q(salt)}, ${q(u.rol)}, 1);`
  );
}

const dest = join(dirname(fileURLToPath(import.meta.url)), '..', 'seed_usuarios.sql');
writeFileSync(dest, out.join('\n') + '\n', 'utf8');
console.log(`OK: ${USUARIOS.length} usuarios (contraseña '${PASSWORD}', hasheada PBKDF2) → ${dest}`);
