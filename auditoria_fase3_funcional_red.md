# Auditoría Fase 3 — Funcional: Vista Red / Multi-Sede

Alcance: la vista Red (`?demo=red`) construida en las Fases 3A-3C, probada
**manualmente en el navegador (desktop + mobile)** contra los datos reales de D1.
Fecha: 2026-08-04. Severidad: Crítico / Importante / Menor.

Resultado: la vista Red es **numéricamente consistente** con las sedes
individuales y no tiene botones/interacciones rotas. 0 Críticos. 2 Importantes
(1 corregido, 1 requiere tu decisión) y 1 Menor de roadmap.

---

## Hallazgo corregido

### H1 — Importante — Tareas demo desactualizadas → ROI en $0 (mismo root cause que F2-H1)
- **Ubicación:** datos de `tareas` en D1 (demo).
- **Problema:** las 21 tareas demo (5 de smile-dental + 16 de la red) tenían `semana='2026-07-27'` (julio). El resumen de ROI filtra por la **semana actual** (`lunesSemanaActual`, Bogotá = `2026-08-03`), así que mostraba **$0 recuperado / 0 completadas** tanto en la red como en cada sede — el tablero se veía vacío aunque hay tareas. **La matemática era correcta y consistente** (consolidado = suma de sedes, ambos $0); el problema era contenido demo anclado a una semana pasada.
- **Corrección aplicada:** `UPDATE tareas SET semana='2026-08-03' WHERE practice_id IN (smile-dental, chapinero, usaquen, suba, kennedy)` (21 filas, sin tocar el contenido). Verificado: RED = **$13.53M recuperado, 4/16 completadas**; smile-dental = **$61.26M, 5/5**; el consolidado sigue igualando la suma de sedes.
- **Nota:** en producción el cron regenera tareas cada lunes para las prácticas activas, así que esto se auto-mantiene. Este fix también resuelve el F2-H1 para la sede única.

---

## Hallazgo que requiere DECISIÓN (no implementado)

### R1 — Importante — `?demo=red` hace llamadas reales a la API de Claude
- **Ubicación:** `js/network-demo.js` (`netRunAnalysis`/`netAskRed`/`netForecast`), guards `NET.fuente==='sintetico'`.
- **Confirmado en vivo:** al usar el Asesor IA en `?demo=red` se registró **1 request real** a la API (respuesta excelente: "Kennedy 52%... $421.8M... Chapinero", con datos reales). El checklist de esta fase pide que **el modo demo NO haga llamadas reales a la API**.
- **Causa:** tensión de diseño — la Fase 3A pidió un demo sin tokens (cacheado), la Fase 3C pidió "Asesor IA de red **real**". Hoy `?demo=red` carga de D1 (`fuente='d1'`) y usa IA real; el caché solo actúa como fallback si D1/API fallan.
- **Por qué no se corrigió:** cambia el comportamiento definido en 3C. Es la misma R1 de la Auditoría Fase 1, aún pendiente de tu decisión.
- **Recomendación:** hacer que `?demo=red` (el demo de venta) use respuestas **cacheadas/offline** (token-free, calidad indistinguible) y reservar la IA real para redes reales detrás de un flag (ej. `?demo=red&live=1` o cuando el `network_id` no sea el demo). Confírmame y lo implemento.

---

## Recomendación de roadmap (fuera de alcance)

### N1 — Menor — No hay "crear tarea" a nivel Red con selección de sede
- En modo Red no existe un formulario de crear-tarea que permita elegir la sede; se crea **drilleando** a la sede y usando su panel admin (`?admin`). El endpoint `POST /tareas` acepta cualquier `practice_id`, así que la capacidad existe. No es un bug; el checklist esperaba un create a nivel Red. Recomendación de roadmap, no implementado (sería feature nueva).

---

## Verificaciones sin hallazgos (todo PASS)

**Selector Sede / Red:**
- Cambio instantáneo; al pasar de una sede a Red la vista queda **fresca** (sin residuos).
- Cambiar entre las 4 sedes **directamente** (sin pasar por Red): cada una muestra sus propios datos (Chapinero $842.4M/salud 100 · Kennedy $421.8M/salud 52/ausent 16% · Usaquén $668.2M/salud 84) — sin datos residuales.

**Health Score consolidado:**
- Muestra **88** — coherente (3 sedes decentes + Kennedy débil → "Bueno", ni perfecto ni terrible). Concuerda con el cálculo sobre las filas mensuales de la red (`netMonthlyCombined`, corregido en Fase 1).
- Caso borde (sede con datos incompletos/cero): `computeMetrics`/`computeHealthScore` tienen guardas (retornan 0 / peor-caso, sin NaN — verificado en Fase 1); una sede en cero suma 0 al agregado, no lo desproporciona ni rompe.

**Tabla comparadora:**
- **Cruce exacto**: los 4 × 5 valores mostrados (recaudación, producción, gastos, ausentismo, aceptación) coinciden **exactamente** con `computeMetrics` de cada sede.
- Semáforo correcto contra las metas reales (Chapinero verde, Kennedy rojo, Suba ámbar, Usaquén mixto) — no hardcodeado ni invertido.
- Ordenar por columna funciona en las 6 columnas (asc/desc con toggle).
- Responsive: colapsa a tarjetas apiladas en mobile (375px), sin scroll horizontal.

**Ranking de doctores cross-sede:**
- Los 8 doctores con su sede correcta; producción y aceptación **distintas** por doctor (Ríos $475M/76%/5.6% … Duque $223M/49%/17.9%) — sin valores repetidos ni placeholder.
- Ordenar por producción / aceptación / ausentismo funciona.

**Tareas en modo Red:**
- Filtro por sede aísla exactamente (Kennedy → 4 tareas, todas Kennedy).
- **ROI consolidado = suma de las 4 sedes** (verificado vía endpoint: consolidado === suma, tras el fix H1: $13.53M).
- Aislamiento por sede correcto (cada `/tareas?practice_id=` trae solo su sede).

**Asesor IA en modo Red:**
- Pregunta comparativa real → respuesta con datos reales de las 4 sedes ("Kennedy 52% de aceptación... $421.8M... gastos 68%... Chapinero").
- **No alucina** una quinta sede ni datos inexistentes.

**Exportables en modo Red:**
- "Resumen de red": salud 88/100, sede en atención (Kennedy), las 4 sedes, doctor líder — texto copiable completo.
- PDF consolidado se genera sin error, mismo lenguaje visual que el de sede individual.

**Demo `?demo=red`:**
- Calidad visual indistinguible: sin placeholders, datos **distintos** entre sedes (producciones y métricas varían, no repetidas).
- (Llamadas a la API: ver R1 — el demo sí llama a la API hoy.)
- Sin errores de consola.

---

## Criterios de aceptación
- [x] Cada punto del checklist probado manualmente, incluido mobile.
- [x] `auditoria_fase3_funcional_red.md` entregado con todos los hallazgos.
- [x] Los números de la vista Red son verificablemente consistentes con las sedes individuales (cruce exacto 4×5 + consolidado = suma).
- [x] Cero botones/interacciones rotas en la vista Red.
