# Auditoría Fase 2 — Funcional: Dashboard de sede individual

Alcance: cada feature del dashboard de sede única, probada **manualmente en el
navegador** (no solo lectura de código), con datos reales y en modo demo.
Sin la vista Red (Fase 3 de la auditoría). Fecha: 2026-08-04.

Severidad: **Crítico** / **Importante** / **Menor** (igual que Fase 1).

Resultado general: el dashboard de sede individual está **sólido**. 0 hallazgos
Críticos, 0 botones muertos, 0 estados rotos. 1 hallazgo Importante (contenido
demo, requiere decisión), 2 Menores (1 corregido).

---

## Hallazgos corregidos

### H2 — Menor — El período mostraba el mes repetido al filtrar
- **Ubicación:** `js/ai-analysis.js::runAnalysis` (~línea 79) y `js/pdf.js::exportPDF` (~línea 42).
- **Problema:** al filtrar a un solo mes, el análisis y el PDF mostraban el período como "marzo de 2026 – marzo de 2026" (mes repetido).
- **Corrección aplicada:** si `data[0].month === data[último].month`, muestra un solo mes ("marzo de 2026"). Verificado en vivo.

---

## Hallazgo que requiere DECISIÓN (no implementado)

### H1 — Importante — El resumen mensual de Pendientes se ve vacío en el mes en curso (tareas demo desactualizadas)
- **Ubicación:** datos demo de `smile-dental` en D1 + diseño del overview (`js/tareas.js::recomputarResumenMes`).
- **Situación:** las 5 tareas demo de smile-dental tienen `semana='2026-07-27'` (julio) y ya estamos en agosto. El overview mensual agrega el **mes en curso**, así que muestra "Recuperado real $0 · 0 de 0 completadas" para agosto. **El cálculo es correcto y consistente** con las tareas (agosto sí no tiene tareas), no es un bug de matemática. Efecto colateral: el valor recuperado de julio ($27.68M) deja de ser visible porque el overview solo muestra el mes actual, y el tablero "Todas" se ve vacío (las 5 tareas están completadas, bajo "Completadas").
- **Por qué no se corrigió:** es contenido demo + una decisión de diseño del overview, no un bug funcional. En producción el **cron regenera tareas cada lunes** con la semana en curso, así que se auto-corrige para clínicas reales.
- **Recomendación (requiere tu confirmación):** (a) re-sembrar las tareas demo de smile-dental a la semana actual para que la demo se vea activa; y/o (b) agregar un selector de mes al overview para poder ver logros de meses pasados. No lo implemento sin confirmar por ser contenido/decisión de producto.

### H3 — Menor — "X citas agendadas" en el Resumen del dueño no cuenta resultados a nivel tarea
- **Ubicación:** `js/tareas.js::buildResumenDueno` (campo `agendaron`).
- **Problema:** "citas agendadas" cuenta solo **pacientes** marcados como agendó. Una tarea **sin pacientes** completada con `resultado='agendo_cita'` suma a "recuperado real" pero muestra "0 citas agendadas" → texto tipo "$500.000 recuperado · 0 citas agendadas" (leve inconsistencia de redacción).
- **Recomendación:** contar también las tareas sin pacientes completadas como agendó, o ajustar la redacción. Menor; documentado para decisión.

---

## Features probadas — todas PASS

**Rendimiento de la Clínica:**
- 9 tarjetas de métricas cargan valores reales (recaudación $660M, producción $689.5M, neto $266.2M, gastos 60%, nuevos 283, citas 2777, aceptación 67%, ausentismo 7%, salud 90) — ninguna en "—"/"Cargando".
- 4 gráficos Chart.js (tendencia, mezcla de ingresos, gastos operativos, producción vs. recaudación) + 3 rankings (ingresos por servicio, flujo de pacientes, resultados de citas) = 7 visualizaciones.
- Filtro por mes: enero → recaudación $35.6M, 1 barra, delta "↓ 50.6% vs dic". **Restablecer** limpia de verdad (select vacío, $660M, 12 barras).
- Pocos datos (filtro a 1 mes): los gráficos no se rompen; la tendencia siempre muestra los 12 meses con el mes filtrado resaltado.

**Análisis Ejecutivo IA:**
- "Analizar con IA" genera análisis coherente (confianza 89%, cita cifras reales: brecha de cobro $28.48M, gastos 60% vs 65%).
- **Respeta el filtro de mes** (filtrado a marzo → "generó $19.1M netos en marzo de 2026").
- Modo prueba: **0 llamadas a la API** (verificado interceptando fetch), nota de vista previa visible.
- Exportar PDF: se genera sin error.

**Tendencias del Sector:**
- 20 artículos en 3 categorías (Industry Trend, Competitor Move, Market Intelligence).
- Filtro por categoría: "Movimientos de la competencia" → 3 tarjetas (= 3 en datos); "Todas" → 20.

**Asesor IA:**
- Chat responde con contexto real (pregunta de servicio más rentable → menciona Restaurativa, la línea top del dashboard).
- 5 preguntas sugeridas funcionan al hacer clic.
- "Nueva conversación" limpia el historial (chatHistory=0, welcome visible) sin perder el contexto de la clínica.
- Pregunta fuera de tema → manejada con gracia ("Eso está fuera de lo que puedo ayudarte aquí. Estoy enfocado en... Smile Dental"), sin alucinar.

**Proyección de Ingresos:**
- 3 escenarios distintos ($48.5M / $56.2M / $64.8M), chart creado.
- Decisión en lenguaje natural cambia la proyección de forma lógica (chip "Contratar higienista" → contexto sobre costo fijo ~$2.8M-3.5M, no genérico).
- 5 "ideas" sugeridas llenan el campo al hacer clic.
- "Pregunta sobre tu proyección" responde coherente (punto de equilibrio del higienista).

**Pendientes (Tareas):**
- Resumen del mes **consistente** con las tareas individuales (recompute manual = valores mostrados).
- Filtros Todas/Doctor-Dueño/Recepción/Completadas con conteos correctos; "Completadas" muestra las 5.
- **Gate admin**: sin clave → "Ingresa la clave" (0 POST); clave incorrecta → 401; clave correcta → crea (tarea #35 creada, aparece en la lista, conteo +1).
- Marcar completada **actualiza el overview en tiempo real** ($0 → $500.000, 0/1 → 1/1).
- "Generar tareas con IA": **5 propuestas** metric-driven (cobrar $29.48M pendientes, 8 no-shows, 5 tratamientos, 10 inactivos, 6 seguimientos), editables, con pacientes adjuntos.
- "Resumen del dueño" + "Copiar": texto completo y bien formateado.
- (La tarea de prueba #35 se eliminó; smile-dental quedó en sus 5 tareas originales — sin alteración.)

**Perfil de la Clínica:**
- Guardar persiste en `localStorage` y **sobrevive a recargar** (PRACTICE_PROFILE restaurado).
- Todos los campos (consultorios, odontólogos, meta, zona, reto, notas) **se reflejan en el contexto del Asesor IA** — vía `buildSystemPrompt` (no `buildDataContext`): verificado que el prompt incluye Bogotá, "1-2", meta 500k, reto de nuevos pacientes y notas.
- "Omitir por ahora" (`closeProfile`) cierra el modal y deja el dashboard usable — sin estado roto.

**White-labeling / Demos:**
- `?practice=&city=&doctor=` se refleja en **toda** la interfaz: título de pestaña, brand, subtítulo (ciudad), header del chat, subtítulo de Tendencias y profile pill (nombre · doctor · ciudad).
- Modo prueba no consume tokens (0 requests, verificado).

---

## Criterios de aceptación
- [x] Cada feature probada manualmente en el navegador.
- [x] `auditoria_fase2_funcional_sede_individual.md` entregado con todos los hallazgos.
- [x] Cero botones/interacciones muertas o que dejen la UI en estado roto.
- [x] Sin regresiones (H2 corregido mejora el pulido; el resto igual o mejor).
- [x] Ningún dato de smile-dental alterado por la auditoría (5 tareas, 12 métricas intactas).
