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

## Formulario de administración en el dashboard

En el dashboard, abre el tab **Pendientes** agregando `?admin` a la URL
(ej. `https://vvisuallaii-bit.github.io/Piloto/?admin`). Aparece un formulario
mínimo para crear tareas; pide la `ADMIN_KEY` una vez y la guarda en
`sessionStorage` (se borra al cerrar la pestaña). La clave viaja en el header
`X-Admin-Key`, nunca en la URL.

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

## Zona horaria

"Hoy" (para marcar vencidas) y "semana actual" (para el resumen ROI) se
calculan en hora de Colombia (UTC-5 fijo, sin horario de verano).
