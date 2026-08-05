# Checklist de regresión QA — Smile Dental (≈10-15 min)

Corre esto **antes de cada despliegue** para detectar si un cambio rompió algo que
ya funcionaba. No es la auditoría completa — son los puntos que con más
probabilidad se rompen. Marca cada casilla; si una falla, **no despliegues** hasta
arreglarla.

Links:
- Sede individual: `https://smile-dental-intelligence.pages.dev/`
- Red (demo): `https://smile-dental-intelligence.pages.dev/?demo=red`
- Admin: agrega `?admin` a la URL.

> Tip: abre la consola del navegador (F12) y la pestaña **Network** antes de empezar,
> y déjalas abiertas todo el recorrido.

---

## 0. Los 3 imprescindibles (nunca los saltes)
- [ ] **Consola sin errores** en todo el recorrido (rojos = frenar). Warnings aislados, revisar.
- [ ] **El demo NO llama a la API real.** En `?demo=red`, con la pestaña Network filtrada por `workers.dev`, usa Análisis de red + Asesor IA + Proyección + generar tareas → **0 requests `POST`** al proxy. (Solo deben verse `GET /red/datos` y `GET /tareas`.)
- [ ] **Los números de la Red cuadran con las sedes.** La recaudación consolidada = suma de las 4 sedes; la salud y los KPIs coinciden con lo que muestra cada sede al entrar a ella.

---

## 1. Datos y cálculos (Fase 1)
- [ ] KPIs de sede individual cargan con valores reales (nada en "—" ni "Cargando").
- [ ] Health Score de sede sale 0–100 (no NaN, no vacío).
- [ ] En la Red, "Pacientes nuevos/mes" es del orden de **~86** (no ~22) — si bajó a ~22, se rompió la agregación por mes (`netMonthlyCombined`).
- [ ] Ingreso neto = recaudación − gastos (revisar que el hero card cuadre).

## 2. Sede individual (Fase 2)
- [ ] Las 5 pestañas abren sin romperse (Rendimiento, Tendencias, Asesor IA, Proyección, Pendientes).
- [ ] Filtro por mes cambia los números y **Restablecer** vuelve a "Todos los meses".
- [ ] Pendientes: marcar una tarea completada actualiza el overview (recuperado/completadas) en vivo.
- [ ] Admin (`?admin`) + clave correcta crea una tarea; sin clave o clave mala → error claro, no crea.
- [ ] Análisis IA y Chat responden con datos de la clínica (modo prueba = 0 llamadas API).

## 3. Red multi-sede (Fase 3)
- [ ] `?demo=red` abre la vista de red (no una sola sede).
- [ ] Tabla comparadora: las 4 sedes con semáforo correcto (Chapinero verde, Kennedy rojo).
- [ ] Ordenar columnas de la comparadora y del ranking de doctores funciona.
- [ ] Filtro de tareas por sede aísla (ej. Kennedy → solo tareas de Kennedy).
- [ ] Entrar a una sede (drill) y volver a Red no deja datos residuales.
- [ ] Asesor IA de red responde comparando sedes reales, sin inventar una 5ª sede.

## 4. Rendimiento y robustez (Fase 4)
- [ ] Ninguna acción deja un spinner infinito; los errores se ven inline (no `alert` crudo ni "undefined").
- [ ] Simular fallo: si la API/Worker no responde, tareas muestra "Reintentar" y el chat muestra "Error de conexión".
- [ ] **Celular (375px):** todas las vistas sin scroll horizontal; la comparadora y el ranking se ven como tarjetas apiladas.
- [ ] Tablet (768px): sin overflow.
- [ ] Nombre de clínica largo (`?practice=...`) no rompe el header.

---

## Post-despliegue (2 min)
- [ ] Abrir el link **canónico** (`smile-dental-intelligence.pages.dev`) — no solo la URL de deployment — y confirmar que sirve la versión nueva (si dudas, `Ctrl+F5` para saltar caché).
- [ ] Confirmar que el **espejo de GitHub Pages** también quedó actualizado.
- [ ] Repetir el punto **0.2** (demo sin API) en el canónico ya desplegado.
