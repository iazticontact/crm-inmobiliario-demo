# FASE P11.2 — Dashboard business final: cartera activa, vendidos/alquilados y dinero claro

> **Fecha:** 2026-06-25 · Cierre de matices de negocio del Dashboard (sobre P11 `3c07647` y P11.1
> `01714f5`): la **cartera** deja de tener "Histórico" como protagonista gris y muestra
> **Vendidos/alquilados** como categoría clara; el bloque económico pasa a **"Rendimiento comercial"**
> con copy más realista y una **única** nota de control interno; auditoría confirmando que **el modo
> real no usa mocks**. Solo Dashboard (página + snapshot + charts + copy). **Sin tocar n8n / Agent V2 /
> API / RLS / Storage / Auth / migraciones.** Requiere redeploy del front.

---

## 1. Diagnóstico (auditoría previa)

- **Datos del Dashboard:** se cargan por `buildDashboardSnapshot` (función **pura**, sin fetch) a partir
  de un `raw` que llega de **Supabase real** vía `Promise.all` (`getClients`, `listOpportunities`,
  `listProperties`, `listServiceCases`, `listTasks`, `getCalendarEvents`, `getConversations`,
  `getActivities`, `getInvoices`). Sin N+1.
- **Mocks:** **todas** las referencias `demo*`/`mock-data` viven **dentro** del branch
  `if (localStorage[nowlabs_demo_mode] === 'true')` (líneas ~409-452 de `dashboard/page.tsx`). El
  branch real solo usa queries reales con fallback `[]` (nunca mock). → **0 mocks en modo real.**
- **Cartera:** `isClosedPropertyStatus = sold|rented|archived`; el donut pintaba una porción
  **"Histórico"** = sold+rented+archived (gris `#cbd5e1`). Problema: el histórico **siempre crece** y
  empequeñece visualmente la cartera activa; además mezcla **vendidos/alquilados** (negocio hecho, dato
  positivo) con **archivados** (retirados).
- **Comisiones:** fuente única `commissionForOp`; el bloque repetía "no es facturación fiscal" en 3
  sitios (descripción, hint y nota).
- **Filtro temporal:** afecta solo a métricas de flujo (cobrada/cerradas/variación/barras); stock
  (activos, abiertas, pendiente, potencial) = estado actual. "Todo" = histórico.

## 2. Qué estaba confuso

- "Histórico" como **porción protagonista** del donut de Cartera.
- "Vendidos/alquilados" escondidos dentro de ese gris.
- Triple "no es facturación fiscal".
- KPI con "N en histórico" en vez de "N vendidos/alquilados".

## 3. Cambios en Cartera

- **Donut nuevo (4 categorías, sin "Histórico"):** Publicados `#10b981` · Reservados `#f59e0b` · En
  preparación `#6366f1` · **Vendidos/alquilados `#0ea5e9`** (azul = cerrado/positivo, coherente con el
  estado "Vendida/Alquilada" de operaciones).
- **Archivados fuera del donut:** dato secundario discreto **"+N archivado(s)"** (solo si > 0).
- **Copy:** título "Cartera inmobiliaria" · subcopy **"Estado actual de tus inmuebles"** · centro
  **"N activos"** · footer **"N vendidos/alquilados"** + **"X € en cartera activa"**.
- **Snapshot:** `cartera` ahora expone `closed` (sold+rented), `archived`, `closedValue`, y mantiene
  `history` (=closed+archived) solo para el cálculo de "Total gestionados". (`dashboard-snapshot.ts`,
  función pura, sin queries nuevas.)

## 4. Cambios en KPIs de Cartera

- **"Inmuebles activos":** el detalle pasa de *"N en histórico"* a **"N vendidos/alquilados"**; el
  tooltip explica **"Total gestionados: N (incluye vendidos/alquilados y archivados, que no cuentan en
  cartera activa)"**. No se añade KPI nuevo (se evita romper el grid de 6 y saturar); vendidos/
  alquilados se ven en el donut + footer + detalle del KPI.

## 5. Cambios en rendimiento económico → "Rendimiento comercial"

- **Título:** "Rendimiento económico" → **"Rendimiento comercial"**.
- **Subcopy:** **"Comisiones de operaciones vendidas/alquiladas y potencial abierto"** (en "Todo":
  "… · histórico desde el inicio").
- **Tiles:** Cobrada (por periodo, con variación) · Pendiente de cobro (actual) · Potencial abierto
  (actual) · **"Comisión media"** (antes "Ticket medio", más claro).
- **Nota única** (sin repetir "no es facturación fiscal"): *"N operación(es) vendida(s)/alquilada(s)
  con comisión. [en Todo: los cobros son el total acumulado; pendiente y potencial = estado actual.]
  Control interno · las facturas, gastos e impuestos se gestionarán en el módulo económico."*
- Donut comisiones (Cobrada/Pendiente/Potencial) y mini-barras por mes/semana con nº de cobros:
  intactos (P11.1).

## 6. Filtro "Todo"

Sin cambios de lógica (ya correcto): "Todo" = histórico completo. Cobrada = total acumulado; barras =
últimos 12 meses rolling; stock (activos/abiertas/pendiente/potencial) = estado actual. El tooltip de
"Vista:" y `PERIOD_HINTS.all` lo explican: *"En Todo, los cobros son históricos; los datos abiertos
muestran el estado actual."*

## 7. Real vs demo/mock

**Confirmado por auditoría:** el Dashboard **no depende de mocks en modo real**. El único acceso a
`demo*`/`mock-data` está gateado por `localStorage[nowlabs_demo_mode] === 'true'`. Producción real:
- Workspace real **con** datos → métricas reales de Supabase.
- Workspace real **sin** datos → empty state premium (onboarding "Tu CRM está listo"), **nunca ceros
  fake ni métricas inventadas**.
- Showcase/ejemplo → usa el **seed real** de Supabase (workspace `d000…0001`), no datos en runtime.
No se tocó el modo demo (aislado).

## 8. Actividad reciente

Humanizador P11.1 reforzado: el patrón de edición de inmueble pasa de **"Inmueble actualizado"** a
**"Inmueble actualizado: Piso · Venta · Valencia"** (conserva tipo·operación·zona, quita el estado
técnico en inglés). Sin N+1 (string puro). Verificado: 0 `stage/listed/won/lost/probabilidad`.

## 9. Visual / UX

Sin rediseño. Solo etiquetas y leyendas más claras (Publicados/Reservados/En preparación/Vendidos-
alquilados), footer útil, "+N archivados" discreto, una sola nota económica. Layout desktop intacto;
en móvil 390 el donut (size 130) y las cards apilan igual que antes (mismo grid responsive).

## 10. Rendimiento

0 queries nuevas · `buildDashboardSnapshot` puro · `useMemo` · `Promise.all` existente · sin Storage /
signed URLs · sin dependencias nuevas · sin N+1. Los nuevos campos de cartera se derivan del `raw` ya
cargado.

## 11. Seguridad

RLS intacta · scoped por workspace · **service_role frontend = 0** · **UUID visible = 0** · sin PII
real inventada · sin tocar otros workspaces · escritura solo desde las acciones ya existentes de P11.1
(completar tarea).

## 12. Qué NO se tocó

n8n · Agent V2 · `/api/agent/tool` · `/api/assistant/*` · Google Calendar · Auth · Storage/RLS ·
secretos/env · facturación/impuestos/gastos reales · migraciones (0 DDL) · módulos Cartera/Operaciones/
Comisiones/Calendario/Clientes/Asistente (solo se **leen** sus datos; `property-display` solo lectura).

## 13. Validaciones

- `npx tsc --noEmit` ✅ · `npm run lint -- --max-warnings=0` ✅ · `npm run build` ✅ (`/dashboard` `○`).
- **Scans:** "Histórico" como **protagonista del donut de Cartera = 0** (las apariciones restantes son
  el filtro temporal "Todo", que sí significa histórico) · "facturación fiscal" visible = 0 (solo 2
  comentarios de código) · pipeline/expediente/probabilidad/stage/listed/won/lost **visibles = 0** ·
  `service_role` = 0 · UUID = 0 · botón muerto = 0 · **mock en modo real = 0**.
- **MCP (lectura):** cartera del workspace de ejemplo: Publicados 2 · En preparación 1 · Reservados 0 ·
  **Vendidos/alquilados 4** · Archivados 0 · **3 activos** / 7 total. El antiguo "Histórico: 4" gris es
  ahora "Vendidos/alquilados: 4" en azul.

## 14. Archivos

| Archivo | Cambio |
|---|---|
| `src/lib/dashboard-snapshot.ts` | `cartera` añade `closed`, `archived`, `closedValue` (split del histórico) |
| `src/app/(saas)/dashboard/page.tsx` | donut cartera (Vendidos/alquilados, +archivados discreto), KPI inmuebles, "Rendimiento comercial" + copy/nota única, "Comisión media", humanizador de inmueble enriquecido |
| `docs/PHASE_P11_2_DASHBOARD_BUSINESS_FINAL_REPORT.md` | **nuevo** |

## 15–17. Commit / Push / Redeploy

Commit `polish(dashboard): cartera vendidos/alquilados + rendimiento comercial (P11.2)` → `origin/main`.
**Requiere redeploy del front** (cambios de cliente; sin backend ni migraciones).

## 18. Checklist de staging (QA manual)

- [ ] Vista mes/trimestre/semestre/año/Todo; "Todo" = histórico claro.
- [ ] Donut Cartera **sin "Histórico"**; muestra Publicados/Reservados/En preparación/**Vendidos-
      alquilados**; centro "N activos"; footer "N vendidos/alquilados" + "X € en cartera activa".
- [ ] Si hay archivados → "+N archivados" discreto (no porción del donut).
- [ ] KPI "Inmuebles activos": detalle "N vendidos/alquilados"; tooltip "Total gestionados: N…".
- [ ] "Rendimiento comercial": cobrada cambia por periodo; pendiente/potencial = estado actual; una
      sola nota de control interno; "Comisión media".
- [ ] Empty workspace real → onboarding (sin datos fake). Showcase → datos del seed real.
- [ ] Actividad reciente sin claves técnicas ("Inmueble actualizado: Piso · Venta · Valencia").
- [ ] Móvil 390: donuts legibles, cards apilan.
- [ ] Regresión: Cartera (Activos/Histórico/Todos), Operaciones, Comisiones, Calendario, Clientes,
      Asistente sin cambios.

## 19. Pendientes honestos

- **`closedValue`** (valor € de vendidos/alquilados) se calcula en el snapshot pero **no se muestra
  todavía**: queda listo para el módulo económico futuro (sin inventar facturación).
- El concepto **"histórico"** sigue existiendo en la pestaña **Cartera** (Activos/Histórico/Todos); ahí
  es correcto. El cambio es solo en el **Dashboard**, donde "histórico" se sustituye por
  "vendidos/alquilados".
- "Histórico" permanece, a propósito, como etiqueta del **filtro temporal "Todo"** (significado de
  tiempo, no de cartera).

## Veredicto

**P11.2 COMPLETADO — DASHBOARD BUSINESS FINAL.** La cartera muestra la situación comercial útil
(activos + vendidos/alquilados, con archivados como nota discreta) sin que el histórico distorsione; el
dinero se entiende como "Rendimiento comercial" con copy realista y una sola nota de control interno;
auditoría confirma **cero mocks en modo real** (todo deriva de Supabase real y se actualiza de forma
coherente al recargar tras cambios de operaciones/cobros/tareas). Sin tocar n8n/Agent V2/API/RLS/
Storage/Auth ni migraciones. `tsc`/`lint`/`build` en verde, scans limpios, datos del workspace de
ejemplo verificados por MCP. **Requiere redeploy del front.** Listo para pasar al Asistente.
