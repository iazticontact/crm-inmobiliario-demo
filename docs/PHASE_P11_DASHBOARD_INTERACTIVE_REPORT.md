# FASE P11 — Dashboard premium interactivo

> **Fecha:** 2026-06-25 · Conversión del Dashboard en un cockpit visual, interactivo y premium
> centrado en el **dinero / comisiones** (control interno, **no** facturación fiscal). Trabajo 100 %
> sobre el CRM (código + MCP de lectura para verificar datos). **Sin tocar n8n / Agent V2 / rutas de
> API / RLS / Storage / Auth / migraciones.** Requiere redeploy del front.

---

## 1. Objetivo

Que al abrir el Dashboard, en 5 segundos, el agente inmobiliario vea **cuánto ha cobrado, cuánto le
queda por cobrar y cuánto hay en juego**, con un filtro de periodo global, gráficos premium y KPIs
clicables que llevan a cada módulo. Todo derivado de datos reales (o demo), sin números inventados.

## 2. Filtro de periodo global (segmented control)

`Este mes · Trimestre · Semestre · Año · Todo` (`PERIOD_OPTIONS` en `dashboard-snapshot.ts`).
- Estado local `period` (`useState<PeriodKey>('month')`); el `snap` se recalcula con
  `buildDashboardSnapshot({ ...raw, todayStr, period })` en un `useMemo` dependiente de `[raw, todayStr, period]`.
- **Afecta solo a métricas temporales** (comisión cobrada en periodo, variación vs periodo anterior,
  nº operaciones cerradas en periodo, buckets de la mini-gráfica).
- **NO afecta a métricas de stock**: inmuebles activos, clientes activos, operaciones abiertas,
  pendiente de cobro y potencial abierto = **estado actual**, siempre.
- Cabecera "Vista: [periodo]" + hint "· Comisión cobrada [periodo]: XX €" (oculto en "Todo").
- Cada KPI/tile lleva su etiqueta de naturaleza: *control interno*, *activos*, *total*, *[periodo]*,
  *pendiente*, *potencial abierto* → nunca se confunde stock con flujo del periodo.

## 3. Bloque económico — "Rendimiento económico"

Tarjeta hero con donut + 4 tiles + mini-barras + nota de control interno. **Todo sale de
`snap.economics`** (tipo `Economics`), calculado por la función pura `buildEconomics(...)`:

| Métrica visible | Campo snapshot | Cómo se calcula |
|---|---|---|
| Cobrada · [periodo] | `economics.cobradaPeriodo` | Suma de `commission_paid_amount` (o comisión estimada) de operaciones **won + cobrada** cuyo `commission_paid_at` cae en el periodo. En "Todo" cuenta todas. |
| Variación vs anterior | `economics.variationPct` | `(cobradaPeriodo − cobradaPrev) / cobradaPrev`, redondeado. `null` si el periodo anterior fue 0 (se muestra "—", **no** un +∞ ni 0 % engañoso). Oculto en "Todo". |
| Pendiente de cobro | `economics.pendiente` | Comisión estimada de operaciones **won** con `commission_status ≠ cobrada`. Es **stock actual** (no depende del periodo). |
| Potencial abierto | `economics.potencialAbierto` | Comisión estimada de operaciones **abiertas** (no won, no lost). Stock actual. |
| Total potencial | `economics.totalPotencial` | `pendiente + potencialAbierto`. |
| Ticket medio | `economics.ticketMedio` | `previstaTotal / closedWithCommission` (media de comisión por operación cerrada con comisión). `null` si no hay cerradas. |
| Nº operaciones con comisión | `economics.closedWithCommission` | Operaciones won con comisión estimable. |
| Comisión cobrada por semana/mes | `economics.buckets` + `bucketGranularity` | Buckets **semanales** (S1–S5) si el periodo es "Este mes"; **mensuales** (Ene–Dic, recortado a 3/6/12) en el resto. |

**Fuente única de la comisión:** `commissionForOp(o, propById)` (modelos `percent` / `one_month` /
`fixed`; en alquiler el % se aplica sobre la renta **anual**). **No se duplica** el cálculo en ningún
sitio: el Dashboard nunca recalcula comisiones a mano, siempre pasa por el snapshot.

**Estado vacío:** si `cobrada + pendiente + potencial = 0` → tarjeta de onboarding ("Todavía no hay
comisiones registradas…"), nunca ceros feos.

## 4. Gráficos premium (SVG/CSS propios, **0 dependencias nuevas**)

Decisión: aunque `recharts` ya está instalado (lo usa Billing), los gráficos del Dashboard son
componentes propios ligeros, por consistencia con `WeekRail`/funnel previos y control total del estilo.

- **`src/components/charts/DonutChart.tsx`** (NUEVO): donut SVG con `stroke-dasharray`, leyenda con
  %/valor, total en el centro y resaltado al hover (atenúa el resto). Reutilizable.
  - **A) Donut comisiones:** Cobrada `#10b981` / Pendiente `#f59e0b` / Potencial abierto `#6366f1`,
    centro = total compacto.
  - **B) Donut cartera:** Publicado / Reservado / En preparación / Histórico, centro = nº activos.
- **`src/components/charts/MiniBarChart.tsx`** (NUEVO): barras CSS, valor al hover, resalta el bucket
  actual (`highlightLast`). Usado para **comisión cobrada por semana/mes**.
- **Embudo de estado comercial** ("Estado comercial"): barras horizontales por `COMM_STATE_OPTIONS`
  (Nueva / En gestión / Reserva / Vendida-Alquilada / Perdida) desde `snap.opsByState`, cada fila
  clicable → `/opportunities`. **Sin la palabra "pipeline"**. (Sustituye al antiguo `OpportunityFunnel`.)

## 5. KPIs premium (6 tiles clicables)

| KPI | Valor | Navega a |
|---|---|---|
| Clientes activos | `stats.activeClients` (+ total) | `/clients` |
| Inmuebles activos | `snap.cartera.active` (+ histórico) | `/opportunities` |
| Operaciones abiertas | `stats.opportunitiesOpen` (+ potencial) | `/opportunities` |
| Citas de hoy | `snap.todayEvents.length` | `/calendar` |
| Trámites urgentes | `snap.deadlines` (kind=case) | `/opportunities` (no existe ruta dedicada de trámites) |
| **Comisión cobrada** | `snap.economics.cobradaPeriodo` · *[periodo] · control interno* | `/opportunities` |

Todos con `hover`, cursor pointer y acento de color por tono. (KPIs internos de facturación/WhatsApp
siguen **gateados** a `NEXT_PUBLIC_NOWLABS_INTERNAL`, nunca al cliente.)

## 6. Layout

1. **Header** + acciones + **segmented control de periodo** ("Vista:").
2. **KPIs principales** (6 tiles, grid responsive 2→3→6).
3. **Hero económico** "Rendimiento económico" (donut comisiones + 4 tiles + mini-barras + nota).
4. **Banda de 3**: Cartera inmobiliaria (donut) · Estado comercial (embudo de barras) · Semana operativa (`WeekRail`).
5. **Centro operativo** (Hoy / Vencimientos críticos / Actividad reciente) — preservado.
6. **Empty state**: workspace vacío → onboarding elegante (sin ceros).

## 7. Copy / vocabulario

- **Permitido y usado:** cliente, inmueble, cartera, operación, trámite, cita, comisión, histórico,
  cobrada, pendiente, potencial abierto, **control interno**.
- **Prohibido y ausente del texto visible:** lead, pipeline, oportunidad, expediente, propiedad,
  probabilidad, score, facturación fiscal (solo se nombra para **negarla**), ingresos contables,
  beneficio neto.
- **Nota discreta** (requerida): *"Las comisiones son un control interno; la facturación fiscal,
  gastos e impuestos se gestionarán en el módulo económico."* + descripción del bloque: *"control
  interno (no es facturación fiscal)"*.
- Renombrado interno `pipelineValue → openOppsValue` y comentarios sin "pipeline" (limpieza, no era
  visible pero se eliminó el término del código del Dashboard).

## 8. Snapshot puro (sin N+1, listo para el agente)

`src/lib/dashboard-snapshot.ts` (ampliado, **pure function**, sin `fetch`/Supabase → testeable):
- `PeriodKey`, `PERIOD_OPTIONS`, `periodBounds(today, period)` (límites del periodo y del **anterior**
  con aritmética de `Date`, "Todo" → sin límites).
- `Economics` + `buildEconomics(...)` (tabla §3).
- `opsByState` / `opsValueByState` (`Record<CommState, number>`), `cartera`, `commissions` (stock),
  `deadlines`, `todayEvents`.
- El Dashboard solo **lee** del snapshot; los datos llegan por los helpers de query batch existentes
  (`listOpportunities`, `listProperties`, `listServiceCases`, `listTasks`, `getCalendarEvents`,
  `getClients`, `getActivities`) → **una carga, cero N+1**.
- **Por qué pure + centralizado:** así el agente n8n/Agent V2 podrá, en una fase futura, consultar o
  replicar estas métricas vía sus tools sin duplicar lógica ni tocar el Dashboard. (En esta fase
  **no** se ha tocado el agente.)

## 9. Qué NO se tocó (constraints de la fase)

n8n / workflows · Agent V2 (`nowlabs-main-agent.ts`) · `/api/assistant/*` · `/api/agent/tool` ·
nombres/args/enums de tools · secretos · `.env` · RLS · Auth / onboarding · Storage / policies ·
Google Calendar · `service_role` (0 en front) · facturación real / impuestos / gastos / beneficio ·
módulos Clientes / Inmuebles / Operaciones / Trámites / Calendario / Comisiones (solo se **leen** sus
datos vía helpers existentes). **Sin migraciones SQL** (P11 = 0 DDL). **Sin datos fake en modo real**
(el modo demo usa los datos demo ya existentes).

## 10. Validaciones

- `npx tsc --noEmit` ✅ (verde).
- `npm run lint -- --max-warnings=0` ✅ (verde; limpiados todos los símbolos del funnel anterior:
  `PieChart`, `COMM_STATE_TONE`, `OpportunityFunnel`, `PipelineStage`, `buildPipeline`,
  `OPEN_FUNNEL_STATES`, `STAGE_COLORS`, `pipeline`/`setPipeline`, `pipelineTotal`, `commStateOf`,
  `CommState`).
- `npm run build` ✅ (`/dashboard` compila como ruta estática `○`).
- **Scans:** prohibido-visible = 0 (solo quedan, a propósito, `'lead'` como **estado de DB** de cliente
  y la nota que **niega** la facturación fiscal) · `service_role` en front = 0 · UUID visible = 0 ·
  llamadas directas a Supabase en el Dashboard = 0 (todo vía helpers) · N+1 = 0.

## 11. Verificación con datos reales (workspace de ejemplo, vía MCP de solo lectura)

Workspace `d0000000-…-0001`, hoy 2026-06-25, periodo por defecto "Este mes":

| Bloque | Esperado | Origen |
|---|---|---|
| Comisión cobrada (junio) | **16.800 €** | 1 op won+cobrada, `commission_paid_at` 2026-06-23 (en junio) |
| Variación vs anterior | **—** (`null`) | mayo 2026 sin cobros → no se inventa % |
| Pendiente de cobro | **24.300 €** | 2 won pendientes: 420k·3 % + 390k·3 % |
| Potencial abierto | **51.882 €** | 5 operaciones abiertas × 3 % de su valor |
| Total potencial | **76.182 €** | pendiente + potencial |
| Ticket medio | **13.700 €** | (16.800+12.600+11.700)/3 |
| Cartera | **3 activos / 4 histórico** (7 total) | `status` sold/rented/archived = histórico |
| Trámites | **5** | service_cases del workspace |

Todos los donuts reciben valores > 0 → renderizan; los estados vacíos se probaron por la rama
`= 0` del JSX.

## 12. Riesgos / pendientes honestos

- **`stats.leads`** se calcula (estado de DB `'lead'`) pero **no se renderiza**; es un campo heredado,
  fuera del alcance de P11 (no se borra para no tocar el contrato de `RealStats`).
- Trámites urgentes enlaza a `/opportunities` porque **no existe ruta dedicada** de trámites; cuando se
  cree, actualizar el `href` (1 línea).
- Los gráficos son SVG/CSS propios: si en el futuro se quiere drilldown avanzado, valorar `recharts`
  (ya instalado) — hoy no se necesita.

## Veredicto

**P11 COMPLETADO — DASHBOARD PREMIUM INTERACTIVO.** Cockpit visual centrado en comisiones (control
interno), con filtro de periodo global, donuts y mini-barras propios sin dependencias nuevas, KPIs
clicables, embudo de estado comercial sin vocabulario prohibido, y **todas las métricas económicas
centralizadas en `dashboard-snapshot.ts` (pure, sin N+1, lista para que el agente las consulte en el
futuro)**. Sin tocar n8n/Agent V2/API/RLS/Storage/Auth ni migraciones. `tsc`/`lint`/`build` en verde,
scans limpios y datos del workspace de ejemplo verificados por MCP. **Requiere redeploy del front.**
