# FASE P3.2 — Dashboard Premium (rediseño + mini gráfico de pipeline)

> **Fecha:** 2026-06-21 · HEAD previo `fb3bb7d`. Solo toca el Dashboard + un
> componente de chart nuevo. **Sin** nuevas queries, **sin** nuevas dependencias,
> **sin** tocar datos/RLS/n8n/asistente/otras páginas. Requiere redeploy (cambió `src/`).

---

## 1. Qué se rediseñó
Portada del CRM convertida en un "centro operativo", manteniendo la regla de oro:
**cero datos inventados** — todo sale de lo que el dashboard ya cargaba en un único
`Promise.all` (clientes, eventos, operaciones, expedientes, tareas, actividad).

### Estructura nueva (de arriba a abajo)
- **Hero**: card con gradiente sutil — saludo contextual ("Buenas tardes, Oier"),
  subtítulo "Aquí tienes el estado de tu CRM hoy.", badge demo/activo y acciones
  (Copiloto / Calendario / Nuevo cliente). Responsive (flex-wrap).
- **KPIs principales (4)**: Clientes activos · Operaciones abiertas · Tareas pendientes ·
  Próximas citas. Número grande + microcopy útil (p. ej. "X vencidas", "€ en pipeline",
  "Próxima: …"). Cobros/WhatsApp pasan a una fila **solo de operador** (`NOWLABS_INTERNAL`),
  fuera de la vista del cliente.
- **Hoy** (con datos): los 3 ítems más accionables ahora mismo — próxima cita, tarea más
  urgente (por fecha de vencimiento) y operación a revisar (mayor valor del pipeline). Si
  no hay nada → empty state premium "Nada urgente para hoy".
- **Prioridades** (con datos): operaciones abiertas, tareas pendientes (+vencidas),
  expedientes esperando docs, citas próximas — solo las que tienen conteo > 0, con enlace.
  Si todo a cero → "No hay prioridades pendientes" + CTAs (Nuevo cliente / Planificar cita).
- **Pipeline por etapa** (mini gráfico, ver §2).
- **Próximas citas** + **Clientes recientes** (se conservan, ya eran útiles).
- **Actividad reciente**: compacta, **máximo 5**, sin actividad negativa (el filtro de
  borrados de P3 sigue activo).
- **Workspace vacío**: NO se muestran bloques vacíos; se muestra el **onboarding guiado de
  4 pasos** (P3.1). Diferenciación clara vacío vs con datos.

## 2. Mini gráfico añadido — Pipeline por etapa (opción A)
- **Qué es**: barras horizontales mínimas con el nº de **operaciones abiertas por fase**
  (Nuevo · Contactado · Cualificado · Visita · Oferta · Negociación). Las claves de etapa
  son las mismas que usa el agente (`deterministic-db-actions.ts`).
- **De dónde salen los datos**: de la lista de oportunidades **ya cargada** en el dashboard
  (`openOpps`), agrupada por `stage`. Cero queries nuevas.
- **Por qué A y no B/C**: es lo más seguro con los datos actuales (la lista ya está en
  memoria; agrupar por etapa es un transform puro). La actividad-por-día (B) dependía de una
  fecha fiable en `activities` que no está garantizada.
- **Dependencia**: **ninguna nueva**. Aunque `recharts@3.8.1` ya existe, para un gráfico
  *mini* en la home (página sensible a rendimiento tras S2–S7) se usó un componente CSS/divs
  propio y ligero — opción que el propio brief marca como "más segura". Nuevo componente
  reutilizable **`src/components/charts/MiniBarChart.tsx`** (presentacional, tipado, sin deps,
  SSR-safe).

## 3. Estados por contexto
- **Demo** (`Ver demo`): KPIs, Hoy, Prioridades y el gráfico salen de los mocks
  inmobiliarios (`demo-real-estate.ts`) → pipeline con 6 operaciones repartidas por etapas,
  tareas con vencimiento, etc. Coherente y bonito.
- **Workspace vacío**: hero + KPIs a 0 + **onboarding 4 pasos**. NO se renderiza el gráfico
  ni Hoy/Prioridades vacíos (sin "gráfico vacío feo").
- **Cliente con datos parciales** (p. ej. clientes pero sin operaciones): el gráfico muestra
  su propio empty state "Cuando registres operaciones, verás aquí el pipeline por etapa".
- **Cargando**: KPIs con "…"; los bloques inferiores no aparecen hasta tener datos.
- **Error de carga**: banner de aviso; no se renderizan los bloques.

## 4. Datos — sin invención
- KPI "Operaciones abiertas" muestra `€ en pipeline` solo si `pipelineValue > 0`.
- "Tareas pendientes" muestra `N vencidas` solo si hay tareas con `due_date` pasada (nuevo
  `tasksOverdue`, derivado real).
- "Próximas citas" muestra la próxima cita real si existe.
- Sin tendencias/variaciones fabricadas (no hay histórico → no se inventa).

## 5. Responsive
- Hero: acciones con `flex-wrap` (no se cortan en móvil).
- KPIs: `grid-cols-2` móvil → `xl:grid-cols-4` desktop.
- Hoy/Prioridades y Pipeline/listas: `lg:grid-cols-2` → apilados en móvil.
- MiniBarChart: etiquetas truncadas (`w-20 sm:w-24`), barras fluidas, sin scroll horizontal.

## 6. Validaciones
`tsc --noEmit` ✅ · `lint --max-warnings=0` ✅ · `build` ✅. (Fix de tipos: `DemoTask.due_date`
es `string | null` → helper `pickUrgentTask` ampliado y coerción a `undefined`.)

## 7. Archivos
- NUEVO `src/components/charts/MiniBarChart.tsx`.
- `src/app/(saas)/dashboard/page.tsx` (rediseño completo del return + cálculos derivados de
  `pipeline`/`urgentTask`/`reviewOp`/`tasksOverdue` en ambas ramas demo y real; helpers y
  tipos a nivel de módulo; imports limpiados).

## 8. QA manual sugerido (tras redeploy)
- **Demo**: hero + 4 KPIs con números; Hoy con 3 ítems; Prioridades con conteos; gráfico de
  pipeline con barras; Actividad ≤ 5. Móvil sin overflow.
- **Workspace vacío**: hero + KPIs a 0 + onboarding 4 pasos; sin gráfico vacío.
- **Cliente real con datos**: igual que demo pero con datos reales.

## 9. Pendientes honestos
- QA visual humano (no hay navegador/Playwright aquí). Con screenshots, pulido fino.
- Charts B (actividad semanal) / C (mix de módulos): no implementados (A es el más seguro);
  B requeriría una fecha fiable por actividad.

## Veredicto
**P3.2 COMPLETADO — DASHBOARD PREMIUM + MINI GRÁFICO DE PIPELINE.** Portada convertida en
centro operativo (hero, 4 KPIs útiles, Hoy, Prioridades, pipeline visual, actividad
compacta), con diferenciación clara vacío/con-datos y **cero datos inventados**. Mini
gráfico ligero **sin dependencias nuevas**. tsc/lint/build verdes. **Requiere redeploy.**
