# Auditoría Fase 1 — Datos, cálculos y backend

Alcance: capa de datos (D1), Worker (`claude-proxy`) y todos los cálculos numéricos.
Sin cambios de UI. Fecha: 2026-08-02.

Convención de severidad:
- **Crítico**: dato incorrecto que el dueño ve y sobre el que decide.
- **Importante**: funciona pero de forma no óptima o con riesgo.
- **Menor**: cosmético o edge case raro.

---

## Hallazgos que SÍ se corrigieron en esta fase

### H1 — Crítico — Pacientes nuevos/mes y Health Score de RED mal agregados
- **Ubicación:** `js/network-demo.js` → `renderNetworkView()`, `netContextoRed()`, `netResumenDatos()`. Antes usaban `computeMetrics(NET.sedes.flatMap(netSedeData))`.
- **Problema:** `computeMetrics` calcula `avgNewPatPerMonth = totalNewPat / data.length`, y `data.length` del arreglo combinado era **48** (4 sedes × 12 meses), no **12**. Resultado: la red mostraba **22 pacientes nuevos/mes** cuando el valor real (sumando las 4 sedes por mes) es **86/mes** — un factor de 4× por debajo, contradiciendo su propia etiqueta "sumando las 4 sedes". Además sesgaba el **Health Score consolidado hacia abajo** (el sub-indicador de pacientes nuevos caía de "excelente" a "advertencia"): mostraba **84** cuando el correcto es **88**. También `active_patients` consolidado tomaba solo la última fila (última sede), no la suma de la red.
- **Corrección aplicada:** nuevo helper `netMonthlyCombined()` que suma todas las sedes **por mes** (produce 12 filas mensuales de red, no 48). Las métricas/salud consolidadas y el contexto de IA ahora lo usan → `meses = 12`, pacientes nuevos/mes = 86, salud = 88. Las tasas (gastos/aceptación/ausentismo) no estaban afectadas porque son ratios de sumas.
- **Verificado:** en vivo, `netMonthlyCombined().length === 12`, KPI "Pacientes nuevos/mes" = 86, salud = 88.

### H2 — Importante — Llamadas de IA de red sin timeout (riesgo de loading infinito)
- **Ubicación:** `js/network-demo.js` → `netRunAnalysis()`, `netAskRed()`, `netForecast()`.
- **Problema:** cada `fetch` a la API se hacía sin `AbortController`. Si la API/Worker cuelga, el spinner queda infinito (el checklist lo prohíbe explícitamente). La proyección de sede individual (`forecast.js`) sí tenía timeout; las de red no.
- **Corrección aplicada:** helper `netFetchIA(prompt, maxTokens)` con `AbortController` y timeout de **30s**; ante timeout/error, cada función cae a su fallback (análisis cacheado, mensaje de reintento, o proyección determinista). Nunca queda cargando.

### H3 — Menor — Tareas huérfanas en D1 (`practice_id="as"`)
- **Ubicación:** tabla `tareas` en D1.
- **Problema:** 5 filas con `practice_id="as"` (una práctica inexistente) — basura de un test temprano de Fase 2. Inertes (ningún query las expone porque todos filtran por practice/network válidos), pero son filas huérfanas.
- **Corrección aplicada:** `DELETE FROM tareas WHERE practice_id NOT IN (SELECT practice_id FROM practices)` (5 filas). Verificado: huérfanas = 0. **No se tocó ninguna clínica real** (smile-dental sigue con 5 tareas + 12 métricas).

---

## Hallazgo que requiere DECISIÓN DE PRODUCTO (no implementado)

### R1 — Importante — En `?demo=red` con datos de D1, la IA llama a la API REAL (no cacheada)
- **Ubicación:** `js/network-demo.js` (`netRunAnalysis`/`netAskRed`/`netForecast`), `js/chat.js`, `js/forecast.js`, `js/ai-analysis.js` — los guards offline son `NET.active && NET.fuente==='sintetico'`.
- **Situación:** el checklist esperaba que el modo demo evite llamadas reales a la API. Pero en la Fase 3C se pidió explícitamente "Asesor IA con contexto de red **real**", así que hoy `?demo=red` (que carga de D1, `fuente='d1'`) **sí** hace requests reales a Claude al usar "Analizar con IA", el chat o la proyección. El caché/fallback solo actúa si D1 no responde (`fuente='sintetico'`).
- **Por qué no se corrigió:** es una decisión de producto, no un bug. `?demo=red` es a la vez el demo de venta (idealmente sin tokens) y el producto real de red (que quiere IA real).
- **Recomendación:** definir la intención. Opciones: (a) dejar la IA real (correcto para el producto que el dueño paga; el costo está acotado por el proxy blindado con rate-limit + tope de tokens); (b) agregar un flag `?demo=red&cache=1` que fuerce el modo cacheado para demos de venta sin quemar tokens. Requiere tu confirmación antes de implementar.

---

## Verificaciones sin hallazgos (todo correcto)

**Integridad de schema/migración (Fase 3B):**
- Métricas huérfanas: 0 · Pacientes huérfanos: 0 · Doctores sin sede: 0 · Sedes sin red: 0.
- La migración de sede única a `networks+practices` no perdió ni duplicó datos: smile-dental conserva 12 métricas y sus tareas; `network_id = practice_id` para la sede única (retro-compatible).
- FK `networks → practices → doctors` consistentes.

**Health Score de sede individual (`js/metrics.js::computeHealthScore`):**
- Pesos: gastos 0.25 + aceptación 0.25 + ausentismo 0.20 + nuevos 0.15 + cobro 0.15 = **1.00** ✓.
- Cada sub-score es 0–100; el total (redondeado) siempre cae en **0–100** (mín ≈ 22, máx 100). No devuelve NaN.
- Casos borde (0 pacientes / datos faltantes): `computeMetrics([])` retorna 0 con guardas (`totalX ? ... : 0`); `benchmarkStates`/`computeHealthScore` aplican override de peor caso (100% cuando no hay cobros/citas) — comportamiento intencional, sin NaN ni salud artificialmente alta.

**Fórmulas de métricas core:**
- `ingreso neto = recaudación − gastos`: `net_income` almacenado = `collections − overhead_costs` en el 100% de las filas (0 filas rotas). ✓
- `ausentismo = no_shows / citas_agendadas` (no / completadas) ✓ · `aceptación = aceptados / presentados` ✓ · `tasa de gastos = overhead / recaudación` ✓.
- `completadas = agendadas − cancelaciones − no_shows` en el 100% de las filas ✓.

**Agregación de red vs. sedes individuales:**
- La suma cruda de `/red/datos` = total de `/red/metricas` = $2.502.370.000 (coincide exacto).
- El Worker (`metricasRed`) agrega con `computeMetrics` por sede (12 filas c/u, correcto) y suma totales — no expone promedios/mes, así que **no** tenía el bug H1 (ese era solo del frontend con flatMap).

**Endpoints del Worker:**
- Casos válidos → 200; inválidos (sin parámetro, ID inexistente) → **400/404 con mensaje**, nunca 500 genérico.
- Aislamiento correcto: `/tareas?practice_id=X` trae solo tareas de X (0 de otras sedes); `network_id` agrega toda la red. Sin fuga ni ocultamiento indebido.

**Integración con Claude API:**
- El contexto de red (`netContextoRed`) incluye las **4 sedes** (métricas por sede + consolidado + top doctores), no una sola. Verificado: el Asesor IA responde comparando sedes con cifras reales ("Kennedy 52% vs Chapinero 74%").

**Rendimiento / optimización (anotado, no crítico):**
- `/red/datos` hace ~1+2N queries (N sedes × métricas+doctores) y `/red/metricas` ~1+N. Con 4 sedes es instantáneo; a 20+ sedes convendría una sola query con `GROUP BY` o `IN`. No hay índice sobre `metricas_mensuales(practice_id, month)` más allá del PK compuesto (que ya cubre los filtros actuales).

---

## Criterios de aceptación
- [x] `auditoria_fase1_datos.md` entregado con todos los hallazgos.
- [x] Hallazgo Crítico (H1) corregido y verificado (86/mes, salud 88).
- [x] Importante (H2 timeouts) corregido; (R1) documentado como decisión de producto.
- [x] Ningún dato de clínicas de sede única alterado (smile-dental intacto: 12 métricas, 5 tareas).
- [x] Endpoints responden correctamente en casos válidos e inválidos.
