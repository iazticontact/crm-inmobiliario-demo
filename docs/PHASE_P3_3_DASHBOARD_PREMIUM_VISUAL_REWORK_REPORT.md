# FASE P3.3 — Dashboard Premium: rework visual + 2 gráficos

> **Fecha:** 2026-06-21 · HEAD previo `a8b03a0`. Toca SOLO el dashboard + un
> componente de chart reutilizable propio. **Sin** nuevas dependencias, **sin**
> queries nuevas, **sin** tocar otras páginas/datos/RLS/n8n/asistente. Requiere redeploy.

---

## 1. Qué estaba mal visualmente
- El "Pipeline por etapa" era una **barra horizontal larga y plana**: poco impacto, poco
  valor percibido, no parecía un gráfico de verdad.
- Solo había **un** gráfico → el dashboard no transmitía "centro operativo".
- KPI cards correctas pero poco "fuertes"; hero algo plano; zonas con blanco sin intención.

## 2. Qué rediseñé exactamente
- **Pipeline rehecho** → **gráfico de columnas verticales** (MiniColumns), compacto y con
  presencia, + **footer con totales reales** (nº operaciones abiertas y € en pipeline) y
  **valor por etapa en el tooltip** de cada columna.
- **Segundo gráfico añadido**: **"Próximos 7 días"** = columnas apiladas por día con **citas
  (azul) + tareas (ámbar)**, leyenda discreta. Da sensación de control operativo real.
- **Banda de analítica**: los dos gráficos van juntos en una fila de 2 columnas
  (`lg:grid-cols-2`), justo bajo Hoy/Prioridades → bloque "centro de mando".
- **KPI cards más fuertes**: `rounded-2xl`, número más grande/bold, **acento superior en
  gradiente por tono**, label en mayúsculas sutil, igualadas en altura.
- **Hero más premium**: añade la **fecha de hoy** ("viernes, 21 de junio") bajo el subtítulo,
  con el gradiente y glow ya existentes.
- **Componente nuevo `MiniColumns`** (sustituye a `MiniBarChart`, eliminado): columnas
  verticales apilables, CSS/divs, tipado, SSR-safe, reutilizable (1 o varias series).

## 3. Qué dos gráficos quedan y por qué
1. **Pipeline por etapa** (columnas): es el gráfico que más dice de un CRM inmobiliario —
   dónde están las operaciones y cuánto valor hay en cada fase. Datos 100% disponibles.
2. **Próximos 7 días** (citas + tareas/día): el segundo más útil y operativo (la "opción A"
   pedida) y **fiable** con los datos actuales — solo bucketea registros que ya tienen
   fecha. Elegido frente a un gráfico decorativo.

## 4. De dónde salen los datos (sin inventar)
- **Pipeline**: `openOpps` (oportunidades abiertas) ya cargadas → agrupadas por `stage`
  (claves de `deterministic-db-actions.ts`); `count` y `value` = recuento y suma de `value`.
- **Próximos 7 días**: `events` (citas) y `tasks` (tareas abiertas) ya cargados → bucketed por
  día en la ventana [hoy, hoy+6] con `buildNext7Days`. Cancelados excluidos; registros sin
  fecha o fuera de ventana **no** cuentan (no se inventa relleno).
- Todo desde el **mismo `Promise.all`** que ya hacía el dashboard. **Cero queries nuevas.**

## 5. Qué NO toqué
Otras páginas, datos/seed, RLS, migraciones, n8n, asistente runtime, Auth, onboarding,
settings, calendario, operaciones, clientes. Módulos premium (WhatsApp/Facturación/
Automatizaciones) siguen ocultos al cliente. Sin dependencias nuevas (recharts existe pero no
se usa, para no cargar la home).

## 6. Diferenciación vacío vs con datos
- **Vacío**: hero + KPIs a 0 + onboarding 4 pasos. **No** se renderiza la banda de gráficos.
- **Con datos parciales**: cada gráfico tiene su propio empty state ("Sin operaciones
  abiertas" / "Semana despejada") — nunca un gráfico vacío feo.
- **Con datos** (demo o real): banda de analítica completa.

## 7. Responsive
- Banda de gráficos: 2 col en `lg`, apila en móvil/tablet.
- `MiniColumns`: columnas con `flex-1` + `max-w-[40px]`, etiquetas truncadas y centradas,
  altura fija de 7rem → sin scroll horizontal ni barras rotas en 390px.
- KPI cards: 2 col móvil → 4 col `xl`, igualadas con `h-full`.

## 8. Validaciones
`tsc --noEmit` ✅ · `lint --max-warnings=0` ✅ · `build` ✅.

## 9. Archivos tocados
- NUEVO `src/components/charts/MiniColumns.tsx` (sustituye a `MiniBarChart.tsx`, **eliminado**).
- `src/app/(saas)/dashboard/page.tsx`: MetricTile reforzado + acento por tono; hero con fecha;
  `PipelineStage` con `value` + `buildPipeline` suma valor; nuevo `buildNext7Days` + estado
  `weekActivity` (calculado en demo y real, reseteado en error); banda de 2 gráficos.

## Screenshots a revisar después (tras redeploy)
1. **Dashboard demo (desktop)** — banda Pipeline + Próximos 7 días con barras y leyenda.
2. **Dashboard demo (móvil 390px)** — columnas legibles, sin overflow.
3. **Dashboard cliente real con datos** — mismas barras con datos reales.
4. **Workspace vacío** — onboarding, sin gráficos vacíos.
5. **KPI cards** — acento de color superior y números grandes.

## Veredicto
**P3.3 COMPLETADO — DASHBOARD PREMIUM VISUAL REWORK.** Pipeline rehecho como columnas con
totales y valor por etapa, segundo gráfico "Próximos 7 días" real, KPIs y hero reforzados,
mejor jerarquía y densidad. Datos 100% reales, sin dependencias nuevas, solo dashboard.
tsc/lint/build verdes. **Requiere redeploy.**
