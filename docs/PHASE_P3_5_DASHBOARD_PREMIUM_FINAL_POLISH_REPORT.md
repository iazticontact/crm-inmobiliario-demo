# FASE P3.5 — Dashboard Premium Final Polish (donut + branding ejecutivo)

> **Fecha:** 2026-06-21 · HEAD previo `2bc5033`. Toca SOLO el dashboard + 1 componente de
> chart nuevo. **Sin** queries nuevas, **sin** dependencias nuevas, **sin** tocar otras
> páginas/datos/RLS. Requiere redeploy.

---

## 1. Diagnóstico de lo que mejoré
El dashboard era compacto pero "plano" y poco ejecutivo: el bloque "Estado comercial" (funnel
de barras) no convencía, el naming sonaba técnico ("Pipeline", "Workspace activo", "Modo
demo", "Operaciones"), los KPIs eran flojos y la composición tenía huecos. P3.5 lo sube a
panel ejecutivo de SaaS premium.

## 2. Qué cambié exactamente
- **Gráfico principal → DONUT interactivo** "Resumen comercial" (sustituye al funnel).
  Centro con total de oportunidades + valor en cartera; al pasar el cursor por un segmento o
  por su fila de leyenda, el centro muestra ese dato y el arco se resalta; leyenda compacta
  con etapa · count · %. Componente nuevo `src/components/charts/DonutChart.tsx`.
- **Composición ejecutiva**: dos bandas claras —
  1) **Banda ejecutiva** (`lg:grid-cols-2`): Resumen comercial (donut) · Semana operativa.
  2) **Banda operativa** (`md:2 / xl:3`): Hoy · Prioridades · Actividad reciente.
  Se retiró el `PipelineFunnel` (eliminado del archivo).
- **Branding/copy client-facing** (nada técnico):
  - Badge "Modo demo"/"Workspace activo" → **"Cuenta de ejemplo"/"Cuenta activa"**.
  - Subtítulo hero → **"Tu resumen comercial de hoy · {fecha}"** (más ejecutivo).
  - "Estado comercial / Pipeline" → **"Resumen comercial / Oportunidades por etapa"**.
  - KPI y prioridad "Operaciones abiertas" → **"Oportunidades abiertas"**; CTA "Ver pipeline"
    → "Ver oportunidades"; "Operación a revisar" → "Oportunidad a revisar".
- **KPI strip más fuerte**: número más grande (`text-[1.8rem]` bold), microcopy mejor
  (`€… en cartera`), altura igualada, acento superior por tono.
- **Densidad**: bandas equilibradas, sin huecos muertos; mantiene no-scroll en desktop.

## 3. Por qué esta solución visual es mejor
- Un **donut interactivo** es el estándar de un CRM/SaaS serio para "distribución por etapa":
  comunica proporción + total + valor de un vistazo y aporta interacción (no decorativo).
- Separar **analítica** (donut + semana) de **operativa** (Hoy/Prioridades/Actividad) da
  jerarquía de "panel ejecutivo" en vez de cards sueltas.
- El copy deja de sonar a demo/panel interno → producto real y vendible.

## 4. De dónde salen los datos (sin inventar)
- **Donut**: `pipeline` (oportunidades abiertas agrupadas por `stage`, ya calculado del
  `Promise.all`), filtrando etapas con count > 0. Center value = `stats.pipelineValue`.
- **Semana operativa**: `weekActivity` (`buildNext7Days` sobre events + tasks ya cargados).
- **KPIs / Hoy / Prioridades / Actividad**: los mismos `stats`/listas ya cargados.
- **Cero queries nuevas.**

## 5. Dependencias
**Ninguna nueva.** El donut es SVG+CSS propio. (recharts existe pero solo se usa en la página
interna de facturación; deliberadamente NO se carga en la home para no engordar el bundle.)

## 6. Validaciones
`tsc --noEmit` ✅ · `lint --max-warnings=0` ✅ · `build` ✅.
(Fix lint: el donut calculaba el offset con un acumulador mutable en render → reescrito de
forma funcional, sin `let` reasignado.)

## 7. Archivos tocados
- NUEVO `src/components/charts/DonutChart.tsx` (donut interactivo tipado, SSR-safe).
- `src/app/(saas)/dashboard/page.tsx`: donut + reordenación en 2 bandas; `PipelineFunnel`
  eliminado; `STAGE_COLORS` + `donutSegments`; copy/branding; KPI reforzado.

## 8. Empty state
Intacto: workspace vacío → hero + KPIs a 0 + **onboarding 4 pasos**, sin charts vacíos. El
donut y la semana solo se renderizan con datos (cada uno con su propio empty state si falta).

## 9. Screenshots a revisar
1. **Demo desktop 1440** — ¿sin scroll? donut interactivo + semana + banda operativa.
2. **Hover en el donut** — centro y leyenda reaccionan.
3. **Demo móvil 390** — bandas apilan, donut+leyenda legibles, sin overflow.
4. **Workspace vacío** — onboarding, sin charts.
5. **KPI strip** — números más contundentes, copy "Oportunidades", "Cuenta activa".

## Veredicto
**P3.5 COMPLETADO — DASHBOARD PREMIUM FINAL POLISH.** Donut interactivo "Resumen comercial",
composición ejecutiva en 2 bandas, branding/copy comercial (sin "demo"/"pipeline"/técnico),
KPIs más fuertes. Datos 100% reales, sin deps/queries nuevas, solo dashboard, no-scroll
desktop. tsc/lint/build verdes. **Requiere redeploy.**
