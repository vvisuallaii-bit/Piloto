# Auditoría Fase 4 — Rendimiento, Errores y Responsive

Alcance transversal: todo el producto (sede individual y Red, demo y real),
probado **en el navegador con instrumentación de `fetch`, consola y medición de
DOM** sobre una copia local servida desde `Piloto/`. Foco en la calidad técnica
silenciosa: errores ocultos, llamadas de más, estados de error, responsive y
casos borde. Fecha: 2026-08-05. Severidad: Crítico / Importante / Menor.

Resultado: **0 Críticos.** 2 hallazgos corregidos (1 Importante, 1 Menor) y
varias verificaciones PASS. Se cumplieron los 5 criterios de aceptación, incluido
**cero llamadas a la API de Claude en modo demo** (antes fallaba — era la R1
pendiente de las Fases 1 y 3).

---

## Hallazgos corregidos

### H1 — Importante — El demo (`?demo=red`) hacía llamadas reales a la API en TODAS las rutas de IA (resuelve R1 de F1/F3)
- **Ubicación:** `js/network-demo.js` (`netRunAnalysis`, `netAskRed`, `netForecast`), guards de drill en `js/ai-analysis.js`, `js/chat.js`, `js/forecast.js`, y `js/tareas-ia.js::generarTareasIA`.
- **Problema (confirmado con instrumentación):** en `?demo=red` (el link que se envía a prospectos), cada uso del Análisis de red, el Asesor IA, la Proyección **y** la generación de tareas con IA disparaba un `POST` real al proxy → **consumo de tokens en el demo de venta**. Se midieron **3 llamadas reales** solo con las 3 acciones de la vista de red, más la de generación de tareas. Incumplía el criterio de aceptación de esta fase ("No hay llamadas a la API de Claude en modo demo").
- **Causa:** tensión de diseño heredada — la Fase 3A pedía un demo sin tokens (cacheado) y la 3C pidió "Asesor IA de red **real**". El caché solo actuaba como *fallback* cuando D1/API fallaban (`NET.fuente==='sintetico'`), no en el demo con datos reales de D1.
- **Corrección aplicada:**
  - Nuevo flag **`NET.live`** (se activa solo con `?live` en la URL) y helper **`netDemoCache()`** = `NET.active && !(NET.live && NET.fuente==='d1')`.
  - Las 3 funciones de IA de red ahora sirven respuestas **cacheadas/deterministas** salvo que `NET.live` esté activo; los 4 guards de drill (Análisis/Chat/Proyección de sede) pasaron de `fuente==='sintetico'` a la misma condición `netDemoCache()`.
  - Nueva **`netDemoRedReply(q)`**: Asesor IA de red **comparativo, token-free**, construido con las métricas REALES de cada sede (enruta por ausentismo, aceptación, gastos, cobro, doctores, "sede que necesita atención", etc.). Antes el fallback era un texto de error genérico.
  - Nueva **`tiaDemoPropuestas()`**: generación de tareas con IA **determinista** (mismas reglas metric-driven que la IA, con pacientes reales del dataset) cuando `netDemoCache()` está activo.
- **Verificado en vivo:** en `?demo=red` (sin `live`) → **0 llamadas `POST` a la API** en Análisis de red, Asesor IA, Proyección, drill a sede (Análisis/Chat/Proyección) y generación de tareas. Con `?demo=red&live=1` → `netDemoCache()` pasa a `false` y la IA real vuelve a activarse (para redes reales). Calidad de las respuestas cacheadas **indistinguible** (citan cifras y sedes reales: "Kennedy: salud 52/100, gastos 68%, aceptación 52%…").
- **Compatibilidad:** la **sede individual real** (sin `?demo`) no cambia — `NET.active` es `false`, así que sigue llamando a la API real como siempre. La persistencia de tareas en D1 (`PATCH`/`POST`) **no** se tocó (esos guards siguen siendo `fuente==='sintetico'`, solo evitan el backend cuando no hay backend).

### H2 — Menor — La Proyección de sede individual manejaba el error con `alert()` crudo
- **Ubicación:** `js/forecast.js::generateForecast` (bloque `catch`).
- **Problema:** si la API fallaba, mostraba `alert('Error en la proyección: '+e.message)` — un diálogo nativo con el mensaje técnico crudo (ej. "Failed to fetch"), justo lo que el checklist pide evitar, e inconsistente con el resto de la app (el chat muestra "⚠️ Error de conexión" inline).
- **Corrección aplicada:** reemplazado por un **estado de error inline** en el área del gráfico ("⚠️ No se pudo generar la proyección en este momento. Revisa tu conexión e inténtalo de nuevo."), ocultando escenarios/preguntas y re-habilitando el botón. Verificado simulando la API caída.

---

## Verificaciones sin hallazgos (PASS)

**Consola:**
- Recorrido completo de sede individual (5 pestañas) y de la vista Red (análisis + Asesor + proyección + drill a las 4 sedes): **0 errores/warnings** de la aplicación. (El único `warn` observado durante las pruebas fue el diálogo suprimido del `alert()` viejo — el que H2 eliminó.)
- Sin requests fallidos ocultos: los `fetch` fallidos se traducen en estados de error visibles (no se tragan en silencio).

**Eficiencia de red:**
- **Sede individual:** una sola llamada al Worker en toda la sesión (`GET /tareas?practice_id=`). Cambiar de mes en el filtro (`go()`) y alternar pestañas ida y vuelta → **0 llamadas extra** (todo el render es client-side sobre el CSV ya cargado).
- **Vista Red:** la carga consolidada usa **1 llamada agregada** (`GET /red/datos` devuelve las 4 sedes + doctores en una sola respuesta) + **1** de tareas (`GET /tareas?network_id=`) — **no** 4 llamadas por sede. El caché de tareas (`NET.tareasRed`) evita refetch al re-renderizar.
- Modo demo: **0 llamadas a la API de Claude** en todos los puntos (ver H1).

**Estados de carga y error (todos con contraparte manejada):**
- Tareas: spinner "Cargando tareas…" + estado de error "⚠ No se pudieron cargar las tareas… **Reintentar**".
- Análisis IA: loading animado; en error, fallback local o "⚠ Error" inline (nunca loading infinito ni JSON crudo).
- Asesor IA (chat): "⚠️ Error de conexión" inline.
- Proyección: loading en el botón; error inline (corregido en H2).
- IA de red: `netFetchIA` con **timeout de 30s** (AbortController) + fallback cacheado — sin loading infinito si la API cuelga.
- Carga inicial del CSV: si falla, reemplaza el spinner por un mensaje de error visible (no se queda "Cargando…" para siempre).
- Init de red: si `GET /red/datos` falla, cae a datos sintéticos deterministas (la demo nunca se rompe).

**Responsive (medido por DOM, sin overflow tolerado):**
- **Mobile 375px:** sede individual (las 5 pestañas) y vista Red → **0 elementos desbordados, sin scroll horizontal del body** (`scrollWidth == viewport`). La tabla comparadora y el ranking de doctores colapsan a tarjetas apiladas (`.net-table-cards`).
- **Tablet 768px:** sede individual y Red → **0 desbordes**, sin scroll horizontal.
- Comparadora + ranking (los elementos nuevos de mayor riesgo) degradan correctamente en ambos breakpoints.

**Rendimiento percibido:**
- Carga local: `DOMContentLoaded` ~67 ms, `load` ~182 ms; footprint propio ~35 KB (HTML+CSS+JS+CSV). Sin recursos pesados propios.
- Librerías externas (Chart.js 4.4.1, jsPDF 2.5.1, Google Fonts) se cargan con **`defer`/`preconnect`** → no bloquean el render.

**Casos borde:**
- **Nombres muy largos** (clínica de 73 caracteres vía `?practice=`): el nombre **envuelve** en el header sin desbordar; **0 overflow** en header/KPIs/hero, sin scroll horizontal.
- **Datos vacíos** (`computeMetrics([])` / `computeHealthScore([])`): retornan valores **finitos** (0s, salud 22 "Requiere atención"), **sin NaN ni excepción** — coherente con las guardas verificadas en la Fase 1. No rompe el render.

---

## Notas menores (no requieren corrección)

- **jsPDF se carga en todas las páginas** aunque solo se use al exportar PDF. Es `defer` (no bloquea), así que el impacto es mínimo; hacer *lazy-load* al exportar ahorraría ~350 KB de descarga diferida a cambio de más complejidad — no se justifica hoy.
- **`loadCSV` en error** muestra un mensaje algo técnico (incluye el nombre del archivo). Es visible y no deja loading infinito, así que cumple; se puede suavizar la redacción si se desea.
- **Salud con datos cero = 22:** un valor bajo pero finito para una clínica sin histórico. En el producto actual no se alcanza un estado de cero-datos real (la sede individual siempre trae su CSV y las clínicas de D1 se siembran con datos), así que es teórico; si a futuro se agregan sedes nuevas sin métricas, convendría un empty-state "sin datos aún" en vez de una salud baja.

---

## Criterios de aceptación
- [x] Cero errores de consola en un recorrido completo del producto (el único warn era el `alert()` que H2 eliminó).
- [x] `auditoria_fase4_rendimiento_robustez.md` entregado con todos los hallazgos.
- [x] El dashboard es completamente usable en viewport de celular (375px), en todas sus vistas — 0 overflow.
- [x] **No hay llamadas a la API de Claude en modo demo**, confirmado por instrumentación de `fetch` (H1).
- [x] Todo estado de carga tiene su contraparte de error manejada (H2 cierra el último `alert` crudo).
