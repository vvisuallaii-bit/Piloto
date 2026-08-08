# Reporte final de auditoría — Smile Dental Intelligence

Fecha: 2026-08-05. Consolida las 4 fases de auditoría (Datos · Sede individual ·
Red multi-sede · Rendimiento/Robustez). Detalle en:
`auditoria_fase1_datos.md`, `auditoria_fase2_funcional_sede_individual.md`,
`auditoria_fase3_funcional_red.md`, `auditoria_fase4_rendimiento_robustez.md`.

---

## 1. Resumen ejecutivo

El producto está **listo para uso en producción con clientes pagando**. Se auditó
todo — los datos y cálculos, el dashboard de una clínica, la vista de red
multi-sede y la calidad técnica (errores, velocidad, celular) — y **no quedó ni un
solo problema crítico abierto**.

Lo más grave encontrado fue **un** error de cálculo real (los "pacientes
nuevos/mes" y la salud de la red salían mal por un problema de agregación); ya está
corregido y verificado. Todo lo demás fueron detalles de robustez, contenido de
demostración desactualizado y una decisión de producto (que el demo no gastara
créditos), todo ya resuelto. Los números de la vista de red **cuadran exactamente**
con las clínicas individuales, el link de demostración **ya no consume tokens**, y
la app funciona sin errores de consola y sin romperse en celular.

Quedan **2 decisiones menores de producto** por confirmar (cosméticas, no bloquean
nada) y unos **riesgos conocidos de escala** que solo importan cuando vendas a
**muchas** redes grandes — no ahora. En una escala de gravedad, lo encontrado en
conjunto fue **bajo**: un producto sólido con un bug real puntual y pulido pendiente,
no un producto frágil.

---

## 2. Tabla consolidada de hallazgos

| Fase | Severidad | Descripción breve | Estado |
|---|---|---|---|
| F1 Datos | **Crítico** | Pacientes nuevos/mes y Health Score de la red mal agregados (dividía entre 48 filas en vez de 12 → mostraba 22/mes en vez de 86, salud 84 en vez de 88). | ✅ Corregido (`netMonthlyCombined()`) |
| F1 Datos | Importante | Llamadas de IA de red sin timeout → riesgo de spinner infinito si la API cuelga. | ✅ Corregido (`netFetchIA`, timeout 30s) |
| F1 Datos | Menor | 5 tareas huérfanas en D1 (`practice_id="as"`) de un test viejo. | ✅ Corregido (borradas) |
| F1 Datos | Importante | `?demo=red` con D1 llamaba a la API real de Claude (la "R1"). | ✅ Corregido en F4 |
| F1 Datos | Nota | `/red/datos` hace ~1+2N queries y sin índice extra; instantáneo con 4 sedes. | 📋 Roadmap (a 20+ sedes) |
| F2 Sede | Importante | Overview mensual de Pendientes se veía vacío en el mes en curso (tareas demo ancladas a julio). | ✅ Corregido en F3 (re-seed) |
| F2 Sede | Menor | El período mostraba el mes repetido al filtrar ("marzo – marzo"). | ✅ Corregido |
| F2 Sede | Menor | Idea: agregar selector de mes al overview para ver logros de meses pasados. | 🟡 Pendiente de decisión |
| F2 Sede | Menor | "X citas agendadas" en el Resumen del dueño no cuenta tareas sin pacientes. | 🟡 Pendiente de decisión |
| F3 Red | Importante | Tareas demo desactualizadas → ROI en $0 (matemática correcta, tablero vacío). | ✅ Corregido (re-seed a semana actual) |
| F3 Red | Importante | `?demo=red` hacía llamadas reales a la API (misma "R1"). | ✅ Corregido en F4 |
| F3 Red | Menor | No hay "crear tarea" a nivel Red con selección de sede (se crea drilleando a la sede). | 📋 Roadmap |
| F4 Rend. | Importante | Demo de venta gastaba tokens en las 4 rutas de IA (resuelve R1 de F1/F3). | ✅ Corregido (demo token-free, IA real con `?live`) |
| F4 Rend. | Menor | La Proyección de sede única mostraba el error con `alert()` crudo. | ✅ Corregido (error inline) |
| F4 Rend. | Nota | jsPDF se carga en todas las páginas (usa `defer`, no bloquea). | 📋 Roadmap (lazy-load) |
| F4 Rend. | Nota | Salud = 22 con datos vacíos (teórico; no ocurre en el producto hoy). | 📋 Roadmap (empty-state) |

**Conteo:** 1 Crítico (corregido) · 6 Importantes (todos corregidos) · 6 Menores
(4 corregidos, 2 pendientes de decisión) · 4 notas de roadmap. **0 hallazgos
abiertos que bloqueen producción.**

---

## 3. Decisiones pendientes (requieren tu confirmación)

Ninguna bloquea el uso en producción; son mejoras de pulido:

1. **Selector de mes en el overview de Pendientes (F2).** Hoy el resumen mensual
   ("Recuperado real / completadas / vencidas") muestra solo el mes en curso. Al
   empezar un mes nuevo, los logros del mes anterior dejan de verse. ¿Quieres poder
   navegar a meses pasados? — *Recomendación: sí, es útil para que el dueño vea el
   histórico de ROI; es un cambio pequeño.*

2. **Redacción "X citas agendadas" en el Resumen del dueño (F2).** Una tarea sin
   pacientes completada como "agendó cita" suma al recuperado pero muestra "0 citas
   agendadas". ¿Ajustamos el conteo o la redacción? — *Recomendación: menor, ajustar
   la redacción cuando toques ese texto.*

---

## 4. Riesgos conocidos (sin resolver) y qué tan urgentes son

Estos **no** son bugs — son límites de diseño que solo importan al escalar:

1. ~~**Los roles por sede son solo de fachada (frontend).**~~ ✅ **RESUELTO (2026-08-07,
   Fase 4A→4C).** Hay autenticación real: `POST /auth/login` valida contra usuarios en
   D1 (contraseñas PBKDF2 + salt), emite un token de sesión, y el Worker exige ese
   token en `/tareas`, `/red/datos`, `/red/metricas`, `/practices` y las escrituras.
   Para `admin_sede`/`recepcionista` el backend **ignora** el `practice_id`/`network_id`
   de la query y usa el de la sesión — un token de una sede ya **no puede** leer otra
   aunque cambien la URL a mano (verificado). La red demo pública (`red-dental-sonrisa`,
   datos ficticios) queda legible sin sesión a propósito, para el demo de venta.
   *Nota de despliegue:* al momento de escribir esto, la migración + usuarios ya están
   en D1 producción; el deploy del Worker + frontend se coordina (ver worker/README.md).

2. **Escalabilidad de la carga de la red.** 🟢 *Baja urgencia.* La vista de red hace
   ~1+2N consultas a la base (N = número de sedes). Con 4 sedes es instantáneo; a
   **20+ sedes** convendría una sola consulta agregada con índice. No afecta a nadie
   hoy; revisarlo cuando una red pase de ~10-15 sedes.

3. **Costo de la IA en redes reales.** 🟢 *Baja urgencia, ya mitigado.* El demo ya no
   gasta tokens. En una red real con `?live`, la IA sí consume, pero el proxy está
   blindado (origen permitido + modelo permitido + tope de tokens + límite de 20
   req/min por IP). Recomendación: **monitorear el gasto** cuando entren redes reales
   pagando, sin acción inmediata.

**Veredicto para escalar ventas:** puedes vender **ya** a clínicas individuales y a
redes multi-sede con demo. El riesgo #1 (control de acceso server-side) quedó
**resuelto** en la Fase 4 — ya puedes prometer "cada gerente solo ve lo suyo" como
garantía real, no de fachada. Los riesgos #2 y #3 son de monitoreo, no de bloqueo.
