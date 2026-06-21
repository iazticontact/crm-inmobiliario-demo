# FASE P3.6 — Dashboard Final Polish (embudo comercial claro + semana útil)

> **Fecha:** 2026-06-21 · HEAD previo `bc433c0`. Toca SOLO el dashboard. **Sin** queries
> nuevas, **sin** dependencias nuevas, **sin** tocar otras páginas/datos/RLS. Requiere redeploy.

---

## 1. Diagnóstico — por qué el bloque no convencía
- El **donut** comunicaba *proporción por número de oportunidades*, que para una inmobiliaria
  es poco accionable; el **valor por etapa quedaba oculto** (solo en hover).
- Generaba confusión: no quedaba claro que mostraba **oportunidades** (no clientes) → "al
  borrar clientes no cambia" tenía sentido pero no se entendía.
- El importe podía leerse como **facturación/ingresos**, cuando es **valor potencial** del
  pipeline.

## 2. Decisión argumentada: SUSTITUIR el donut
Lo cambié por un **"Resumen comercial" tipo embudo/estado de oportunidades**, más útil para
inmobiliaria, porque:
- Muestra **por etapa: recuento + valor + peso relativo** *inline* (sin depender del hover).
- La barra es **proporcional al valor** (cuando hay valores) → se ve **dónde está el dinero
  potencial**, no solo cuántos deals hay.
- Cabecera con **total de oportunidades abiertas** + **valor potencial en cartera**
  (etiquetado explícito) → en 2 segundos se entiende qué es y que NO es facturación.
- Lee como un **pipeline comercial**, el modelo mental de un agente inmobiliario.

## 3. Implementación (solo dashboard)
- **Nuevo componente local `OpportunityFunnel`**: cabecera (total oportunidades + valor
  potencial) + filas por etapa (dot de color, etiqueta, barra proporcional al valor/recuento,
  count y `€` compacto). Colores por etapa (`STAGE_COLORS`).
- **Donut retirado**: `DonutChart.tsx` **eliminado**, import y `donutSegments` fuera.
- **Copy del bloque**: título "Resumen comercial", subtítulo **"Oportunidades activas por
  etapa · valor potencial"**, CTA "Ver oportunidades".
- **KPI "Oportunidades abiertas"** microcopy → **"€X valor potencial"** (antes "en
  cartera"/"en pipeline"); nunca facturación/ingresos/beneficio.
- **"Semana operativa" mejorada**: tiles **clicables** (→ calendario), **hover** con elevación,
  **acento superior** en días con actividad, **resalta hoy y el siguiente día con actividad**,
  citas/tareas separadas (azul/ámbar) y **footer con totales** ("X citas · Y tareas").

## 4. Datos reales que usa cada bloque (sin inventar)
- **Resumen comercial (embudo)**: `pipeline` (oportunidades **abiertas** agrupadas por
  `stage`, del `Promise.all`), `count` y `value` por etapa; total = `pipelineTotal`; valor =
  `stats.pipelineValue`. **Depende de oportunidades abiertas reales** (no de clientes).
- **Semana operativa**: `weekActivity` (`buildNext7Days` sobre `events` + `tasks` ya cargados);
  totales = suma de la semana.
- **Cero queries nuevas.**

## 5. Coherencia del dato (Prioridad 4)
El bloque comercial **solo** depende de oportunidades abiertas; el copy lo deja explícito
("Oportunidades activas por etapa", "Valor potencial en cartera", "valor potencial" en el
KPI). No se mezcla con clientes, facturación ni beneficio.

## 6. Validaciones
`tsc --noEmit` ✅ · `lint --max-warnings=0` ✅ · `build` ✅.

## 7. Archivos tocados
- `src/app/(saas)/dashboard/page.tsx`: `OpportunityFunnel` (nuevo local) sustituye al donut;
  `WeekRail` mejorado (clicable, acentos, resaltado); `weekTotals`; copy/microcopy.
- ELIMINADO `src/components/charts/DonutChart.tsx`.

## 8. Empty / onboarding
Intacto: workspace vacío → onboarding 4 pasos, sin charts. El embudo y la semana solo se
renderizan con datos (cada uno con su empty state propio).

## 9. Screenshots a revisar
1. **Demo desktop 1440** — embudo "Resumen comercial" (total + valor potencial + filas por
   etapa) y "Semana operativa" con días resaltados. ¿Sin scroll?
2. **Hover/clic en Semana** — tiles reaccionan y llevan a calendario.
3. **Demo móvil 390** — bandas apilan, embudo y semana legibles, sin overflow.
4. **Workspace vacío** — onboarding, sin charts.

## Veredicto
**P3.6 COMPLETADO — DASHBOARD FINAL POLISH.** El bloque comercial pasa a un embudo claro y
útil (recuento + valor por etapa + valor potencial total, sin ambigüedad financiera), la
semana operativa es interactiva y mejor jerarquizada, y el copy es comercial y coherente.
Datos 100% reales (oportunidades abiertas), sin deps/queries nuevas, solo dashboard.
tsc/lint/build verdes. **Requiere redeploy.**
