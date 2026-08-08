# claude-proxy — Worker de Smile Dental Intelligence

Cloudflare Worker que sirve dos cosas:

1. **Proxy de Claude** (ruta original): `POST /` reenvía `{model, max_tokens, messages}` a la API de Anthropic con la key guardada como secret.
2. **API de tareas (Fase 2)**: `POST /tareas`, `GET /tareas`, `PATCH /tareas/:id`, con persistencia en Cloudflare D1.

> ⚠️ **Antes del primer deploy con wrangler:** este código fuente fue reconstruido a partir del contrato que usa el frontend (el Worker original se editó en el dashboard de Cloudflare y no estaba en el repo). Abre el editor del Worker en el dashboard y verifica que el nombre del secret de la API key coincida con `ANTHROPIC_API_KEY` (si allá se llama distinto, ajusta `src/index.js` o renombra el secret). Un `wrangler deploy` **reemplaza** el código desplegado, pero **conserva** los secrets ya configurados.

## Requisitos

- Node.js + npm (no están instalados en la máquina actual — instalar desde https://nodejs.org)
- Cuenta de Cloudflare con el Worker `claude-proxy` existente
- `npx wrangler login` (abre el navegador para autorizar)

## Puesta en marcha (una sola vez)

```bash
cd Piloto/worker

# 1. Autenticarse
npx wrangler login

# 2. Crear la base D1
npx wrangler d1 create smile-dental-tareas
# → copia el database_id que imprime y pégalo en wrangler.toml ([[d1_databases]])

# 3. Aplicar la migración (crea la tabla `tareas`)
npx wrangler d1 migrations apply smile-dental-tareas --remote
# (sin --remote aplica solo a la copia local de desarrollo)

# 4. Configurar los secrets (si no existen ya)
npx wrangler secret put ANTHROPIC_API_KEY   # key de la API de Anthropic (ya existe si el proxy funciona)
npx wrangler secret put ADMIN_KEY           # clave simple que protege POST /tareas — invéntala tú

# 5. Desplegar
npx wrangler deploy
```

## Probar los endpoints manualmente

Base: `https://claude-proxy.vvisuall-aii.workers.dev`

### Crear una tarea (`POST /tareas`, requiere la clave admin)

```bash
curl -X POST "https://claude-proxy.vvisuall-aii.workers.dev/tareas" \
  -H "Content-Type: application/json" \
  -H "X-Admin-Key: TU_ADMIN_KEY" \
  -d '{
    "practice_id": "smile-dental",
    "semana": "2026-07-13",
    "titulo": "Llamar a 12 pacientes inactivos de higiene",
    "descripcion": "Pacientes sin cita en 8+ meses, lista en el CRM",
    "categoria": "recall_inactivos",
    "asignado_a": "recepcionista",
    "prioridad": "alta",
    "valor_estimado_cop": 1800000,
    "fecha_limite": "2026-07-17",
    "fuente": "manual"
  }'
# → 201 con la tarea creada (incluye "id")
# → 401 si falta o no coincide X-Admin-Key
# → 400 si falta un campo requerido o un valor no es permitido
```

### Listar tareas + resumen ROI (`GET /tareas`)

```bash
# Todas las tareas de la clínica
curl "https://claude-proxy.vvisuall-aii.workers.dev/tareas?practice_id=smile-dental"

# Filtradas
curl "https://claude-proxy.vvisuall-aii.workers.dev/tareas?practice_id=smile-dental&estado=pendiente&asignado_a=recepcionista"
```

Respuesta:

```json
{
  "tareas": [ /* ordenadas: vencidas → prioridad alta>media>baja → más recientes */ ],
  "resumen": {
    "semana": "2026-07-13",
    "total_semana": 4,
    "completadas_semana": 1,
    "valor_recuperado_cop": 1800000,
    "vencidas_count": 0
  }
}
```

El `resumen` se calcula sobre la semana actual (lunes, hora de Colombia).
`valor_recuperado_cop` suma el `valor_estimado_cop` de las tareas completadas
con `resultado = 'agendo_cita'` — el valor solo cuenta cuando se materializó.

### Completar una tarea (`PATCH /tareas/:id`)

```bash
curl -X PATCH "https://claude-proxy.vvisuall-aii.workers.dev/tareas/1" \
  -H "Content-Type: application/json" \
  -d '{"estado":"completada","resultado":"agendo_cita","completado_por":"recepcionista"}'
# → 200 con la tarea actualizada (completado_en lo pone el servidor)
# → 400 si estado=completada sin resultado o sin completado_por
# → 404 si el id no existe
```

## Crear tareas desde el dashboard

**Uso normal (Fase 4C):** el Gerente y el Administrador de sede crean tareas
directamente autenticados con su sesión — **no escriben ninguna clave**. El token
de la sesión (`Authorization: Bearer …`) autoriza el `POST /tareas`. El Gerente usa
el botón "＋ Crear tarea" de la vista Red (con selector de sede); el Administrador de
sede, el formulario del tab **Pendientes** (fijado a su sede).

### `?admin` + `X-Admin-Key` — uso interno / debugging

El flujo viejo se **mantiene** como acceso interno tuyo (operador), no para clientes.
Agregando `?admin` a la URL aparece el formulario con el campo "Clave admin"; la
`ADMIN_KEY` viaja en el header `X-Admin-Key` (nunca en la URL) y se guarda en
`sessionStorage`. `?admin` no exige login (es tu atajo de mantenimiento).

Notas post-4C:
- `X-Admin-Key` sigue siendo **superusuario** en el Worker: autoriza escrituras en
  cualquier sede/red, en paralelo con el login por sesión (no se retiró).
- La **lectura** de tareas (`GET /tareas`) ahora exige sesión, así que el formulario
  `?admin` sin login es sobre todo una herramienta de **escritura** (crear/generar);
  para ver y gestionar la lista completa, inicia sesión como dueño.
- Para scripting/debug sin navegador, usa `curl` con `X-Admin-Key` (ejemplos arriba).

## Generación automática de tareas (Paso 2 — cron)

Cada **lunes 7:00am Bogotá** (cron `0 12 * * 1` en `wrangler.toml`), el handler
`scheduled()` genera las 3-5 tareas de la semana para cada clínica activa, sin
navegador. Los datos que antes vivían en el navegador ahora están en D1:

- `practices` — una fila por clínica (`practice_id`, `nombre`, `perfil` JSON, `activo`).
- `metricas_mensuales` — las columnas del CSV; `computeMetrics()` (portado de
  `metrics.js`) agrega sobre ellas para armar el resumen del prompt.
- `pacientes` — el roster accionable (equivalente a `pacientes.json`).

Sembrar/actualizar los datos en D1:

```bash
cd Piloto/worker
node scripts/seed-d1.mjs          # lee ../smile_dental_demo.csv y ../pacientes.json → seed_smile_dental.sql
npx wrangler d1 execute smile-dental-tareas --remote --file seed_smile_dental.sql
```

El cron es idempotente: si ya existen tareas `ia_semanal` para esa clínica+semana,
salta (anti-duplicados).

### Disparar la generación a mano (`POST /tareas/generar`, requiere `X-Admin-Key`)

```bash
# Devuelve las propuestas SIN insertarlas (para probar); force ignora el anti-dup:
curl -X POST "https://claude-proxy.vvisuall-aii.workers.dev/tareas/generar?dry_run=1&force=1&practice_id=smile-dental" \
  -H "X-Admin-Key: TU_ADMIN_KEY"

# Genera e inserta de verdad (todas las clínicas activas si se omite practice_id):
curl -X POST "https://claude-proxy.vvisuall-aii.workers.dev/tareas/generar" -H "X-Admin-Key: TU_ADMIN_KEY"
```

## Valor esperado vs. monto real recuperado

`valor_estimado_cop` = ROI esperado (lo que la acción debería traer). El **monto
real** que de verdad entró lo registra recepción al completar:
- Tareas **con pacientes**: por paciente, en el campo `monto_real_cop` dentro del
  JSON de la columna `pacientes` (llega por el PATCH `pacientes`, sin columna nueva).
- Tareas **sin pacientes**: en la columna `valor_real_cop` (migración 0004), vía
  `PATCH /tareas/:id {valor_real_cop}`.

El `GET /tareas` devuelve en `resumen` tanto `valor_esperado_cop` como
`valor_real_cop` (el cliente los recalcula con precisión por paciente).

## Modelo multi-sede (Fase 3B)

Extiende el modelo para soportar redes de varias sedes **sin construir un sistema
paralelo**: una clínica de sede única es simplemente una red con UNA sede adentro.

```
networks (red / dueño)
  └─ practices (sede)              network_id → networks
       ├─ doctors (odontólogos)    practice_id → practices
       ├─ metricas_mensuales       practice_id  (una fila por sede+mes)
       ├─ tareas                   practice_id
       └─ pacientes                practice_id
```

- **`networks`**: `network_id` (slug, PK), `nombre`, `plan` (texto), `creado_en`.
- **`practices`**: agrega `network_id` (FK), `ciudad`, `direccion` a las columnas de
  Paso 2 (`practice_id` PK, `nombre`, `perfil`, `activo`, `creado_en`).
- **`doctors`**: `id` (autoincrement), `practice_id` (FK), `nombre`, `fecha_ingreso`.
- `metricas_mensuales`, `tareas` y `pacientes` **ya** llevaban `practice_id` desde
  Paso 2, así que se filtran/agregan por sede sin ambigüedad.

Convención de nombres: se mantiene la del schema existente (snake_case;
`practice_id`/`nombre`/`creado_en` en español para dominio; columnas de métricas
en inglés porque vienen del CSV). Coherente con `practices`/`tareas` ya creadas.

**Migración de las sedes únicas existentes** (migración 0007): cada `practice` sin
red se convierte en su propia red (`network_id = practice_id`), sin tocar métricas
ni tareas. Retro-compatible: la clínica piloto sigue igual.

### Endpoints (Fase 3B)

```bash
# Listar las sedes de una red (para el selector del dashboard)
GET /practices?network_id=red-dental-sonrisa

# Métricas agregadas de la red + desglose por sede (promedio ponderado por volumen)
GET /red/metricas?network_id=red-dental-sonrisa
# → { network_id, nombre, red:{recaudacion_cop, tasa_gastos, ...}, sedes:[{...}] }

# Tareas: acepta practice_id (una sede, como siempre) O network_id (toda la red)
GET /tareas?practice_id=smile-dental      # sede única — comportamiento sin cambios
GET /tareas?network_id=red-dental-sonrisa # agrega todas las sedes de la red
# Sin practice_id ni network_id → 400 (igual que antes)

# Crear red / sede / odontólogo (requieren X-Admin-Key, mismos guardrails que /tareas)
POST /networks   {network_id, nombre, plan?}
POST /practices  {practice_id, network_id, nombre, ciudad?, direccion?}
POST /doctors    {practice_id, nombre, fecha_ingreso?}
```

### Migraciones y seed

```bash
cd Piloto/worker
# Backup no-destructivo previo (queda en worker/backups/, ignorado por git)
npx wrangler d1 export smile-dental-tareas --remote --output backups/backup.sql
# Esquema + migración de datos
npx wrangler d1 execute smile-dental-tareas --remote --file migrations/0006_multi_sede.sql
npx wrangler d1 execute smile-dental-tareas --remote --file migrations/0007_migrar_sedes_unicas.sql
# Red demo (4 sedes + 8 doctores + 48 métricas), consistente con el demo 3A
node scripts/seed-network.mjs
npx wrangler d1 execute smile-dental-tareas --remote --file seed_network.sql
```

**Fuera de alcance (roadmap):** pricing dinámico por número de sedes/doctores —
hoy el precio se calcula manual.

## Autenticación por usuario y rol (Fase 4B)

Reemplaza el login mock del frontend (Fase 4A) por credenciales reales en D1,
resolviendo el Riesgo #1 de la auditoría (los roles por sede eran solo de
fachada en el frontend). El backend ahora verifica quién hace cada petición.

- **`usuarios`** (migración 0009): `email` (único), `password_hash` + `password_salt`
  (PBKDF2-SHA256, 100k iteraciones, salt por usuario — sin dependencias npm, con
  Web Crypto nativo), `rol` (`dueno` | `admin_sede` | `recepcionista`),
  `network_id`, `practice_id` (NULL para `dueno`).
- **`sesiones`**: `token` (UUID) → `usuario_id`, con expiración a 7 días.

### Endpoints de auth

```bash
# Login → { token, rol, nombre, network_id, practice_id }
POST /auth/login    {email, password}
# → 401 credenciales inválidas · 429 si se superan los intentos por IP (mismo rate-limit del proxy)

# Cerrar sesión (borra el token)
POST /auth/logout   -H "Authorization: Bearer <token>"

# Datos de la sesión actual
GET  /auth/me       -H "Authorization: Bearer <token>"
# → { rol, nombre, network_id, practice_id } | 401
```

### Autorización de los endpoints existentes

`ADMIN_KEY` **sigue funcionando en paralelo** (no se retira en esta fase — eso es
4C). Cada endpoint acepta ADMIN_KEY (superusuario, como hoy) **o** una sesión:

| Endpoint | Con sesión |
|---|---|
| `POST /tareas`, `POST /tareas/generar` | `dueno` o `admin_sede` (crea en su alcance). `recepcionista` → 403 |
| `POST /networks` / `/practices` / `/doctors` | solo `dueno` (dentro de su red) |
| `GET /tareas`, `PATCH /tareas/:id`, `GET /practices`, `GET /red/metricas`, `GET /red/datos` | sesión válida requerida |

Clave de seguridad: para `admin_sede` y `recepcionista`, el backend **ignora**
cualquier `practice_id`/`network_id` de la query y usa el de la sesión — un token
de recepcionista no puede leer otra sede aunque le cambien el parámetro a mano.

> ⚠️ **Coordinación de despliegue (Fase 4C):** los GET (`/tareas`, `/red/datos`,
> etc.) que hoy son **públicos** pasan a exigir sesión. El frontend todavía usa el
> mock de la 4A y aún no manda `Authorization`, así que **desplegar este Worker
> ANTES de conectar el frontend (4C) rompería** las lecturas públicas del demo en
> vivo. No hacer `wrangler deploy` hasta coordinar la 4C. `ADMIN_KEY` no se ve
> afectada.

### Migración y seed de usuarios

> Nota: el tracker `d1_migrations` de esta base quedó desfasado (las 0005–0008 se
> aplicaron con `execute --file`, no con `migrations apply`). Por eso **NO** se usa
> `migrations apply` aquí — intentaría recrear tablas/columnas que ya existen y
> fallaría. La 0009 se aplica con `execute --file`, igual que las anteriores.
> Es idempotente (`IF NOT EXISTS`).

```bash
cd Piloto/worker
# 0. (opcional pero recomendado) backup no destructivo → backups/
npx wrangler d1 export smile-dental-tareas --remote --output backups/backup_pre_4b.sql
# 1. Crea las tablas usuarios/sesiones
npx wrangler d1 execute smile-dental-tareas --remote --file migrations/0009_usuarios_sesiones.sql
# 2. Siembra los 3 usuarios demo (misma contraseña 'demo2026', ya hasheada)
node scripts/seed-usuarios.mjs
npx wrangler d1 execute smile-dental-tareas --remote --file seed_usuarios.sql
```

**Estado (2026-08-07):** migración 0009 + seed de usuarios YA aplicados en producción.
Falta `npx wrangler deploy` del Worker — se pospone a la 4C para no romper los GET
públicos del demo en vivo (ver aviso de despliegue arriba).

## Zona horaria

"Hoy" (para marcar vencidas) y "semana actual" (para el resumen ROI) se
calculan en hora de Colombia (UTC-5 fijo, sin horario de verano).
