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

---

# AMPLIACIÓN CRÍTICA P11.2 — Regla de oro: solo datos reales, sin humo, reversión de ventas/alquileres

> Sobre el feedback de staging: el donut con "Histórico"/"Vendidos-alquilados" **dentro** seguía sin
> convencer (a largo plazo distorsiona), y se pide **solo datos reales** + poder **revertir** una venta/
> alquiler marcada por error. Integrado en P11.2 (mismo trabajo).

## A1. Diagnóstico ampliado

- **Comisión inventada (regla de oro):** auditado `commissionForOp` (snapshot) y `commissionOf`
  (Operaciones). **Ninguno inventa 3%**: el modelo `percent` devuelve `null` si la operación **no
  tiene `commission_rate`** (idem `one_month`/`fixed` sin su dato). El 3% del ejemplo viene **solo del
  seed** (`20260623_p610_seed_example_commission_rate.sql`), correcto para showcase; en un workspace
  real vacío **no aparece comisión**.
- **"Ticket medio"** era ambiguo (¿media de qué?). → **humo → eliminado**.
- **Reabrir una venta/alquiler:** el cambio de estado de operación cerrada → activa **no** reactivaba
  el inmueble (quedaba `sold/rented`) **ni** confirmaba. Estados incoherentes posibles.

## A2. Qué métricas eran humo/confusas → decisión

| Métrica | Decisión |
|---|---|
| **Ticket medio / Comisión media** | **Eliminada** del Dashboard y del snapshot (`ticketMedio` + `previstaTotal` borrados). |
| **Potencial abierto / Comisión prevista** | **Se mantienen** (son reales: solo suman operaciones **con comisión pactada**), con tooltip de fórmula: *"Comisión prevista de operaciones abiertas con comisión pactada (orientativo)"*. |
| **Vendidos/alquilados en el donut** | **Fuera del donut** (ver A3). |

## A3. Cómo queda Cartera en el Dashboard (cambio final)

- **Donut = SOLO cartera activa:** Publicados · Reservados · En preparación. Centro **"N activos"**.
- **Vendidos/alquilados**, **Archivados** (si > 0) y **Valor activo** → **lista secundaria** bajo el
  donut (no porciones que distorsionen).
- Copy: título **"Cartera activa"** · subcopy **"Inmuebles actualmente gestionables"** · nota
  *"Vendidos/alquilados se conservan como histórico, pero no cuentan en la cartera activa."*
- Así, aunque la inmobiliaria venda 500 inmuebles, el donut **no se distorsiona**: siempre muestra el
  estado actual del negocio.

## A4. Rendimiento comercial (final)

- Subcopy **"Comisiones y cobros registrados en el CRM"**; tiles con **tooltip de fórmula** (Cobrada /
  Pendiente de cobro / Potencial abierto / **Operaciones cerradas** = nº vendidas/alquiladas con
  comisión, sustituye a "Comisión media"). Nota única de control interno (sin repetir "facturación
  fiscal").

## A5. Comisiones (módulo)

Ya cumplía el criterio (KPIs: Comisión prevista / Pendiente de cobro / Cobrada / Operaciones cerradas;
lista con cliente·inmueble·tipo·% pactado·€ previsto·estado; acciones **Registrar cobro** / **Marcar
pendiente**). Solo se **alineó la nota** a *"Control interno de comisiones. Las facturas, gastos e
impuestos se gestionarán en el módulo económico."*

## A6. Reversión de vendido/alquilado (nuevo)

En **Operaciones**, al pasar una operación **cerrada (Vendida/Alquilada) → activa** (o Perdida):
- **Confirmación guiada** (`ConfirmDialog`): *"¿Reabrir esta operación? La operación dejará de estar
  cerrada y volverá a aparecer como activa. El inmueble «…» saldrá del histórico y volverá a la cartera
  activa. No se elimina nada: las comisiones registradas se conservan…"*.
- Al confirmar: la operación vuelve al estado activo **y**, si su inmueble estaba `sold/rented`, se
  **reactiva** (`reserved` si la operación pasa a Reserva, `listed`/Publicado en el resto).
- **No borra nada:** ni comisión cobrada, ni documentos, ni operación, ni inmueble, ni cliente.
- **Recalcado por estado actual:** mientras la operación esté abierta deja de contar como cerrada/
  pendiente en Dashboard y Comisiones; si se vuelve a cerrar, vuelve a contar. `commission_status`
  ('cobrada'/'pendiente') se **conserva** como histórico interno (no se altera automáticamente).
- Verificado por MCP: el ejemplo tiene 3 operaciones won ligadas a inmuebles `sold` (1 cobrada, 2
  pendientes) + 1 won sin inmueble → ambas ramas (con y sin reactivación) son reales.

## A7. Real vs demo/mock (reconfirmado)

`commissionForOp`/`commissionOf` no inventan tasas. Dashboard: todo `demo*`/`mock` gateado por
`localStorage[nowlabs_demo_mode]` (líneas ~411-452); el branch real solo lee Supabase con fallback
`[]`. **0 valores hardcodeados de comisión** (los únicos "3" del scan son aritmética de trimestre
`m/3*3` y una opacidad de sombra Tailwind).

## A8. Archivos (ampliación)

| Archivo | Cambio |
|---|---|
| `src/lib/dashboard-snapshot.ts` | elimina `ticketMedio`/`previstaTotal` (humo) |
| `src/app/(saas)/dashboard/page.tsx` | donut Cartera **solo activos** + secundarios; tiles económicos (quita "Comisión media", añade "Operaciones cerradas" + tooltips de fórmula); subcopy "Comisiones y cobros registrados en el CRM" |
| `src/app/(saas)/opportunities/page.tsx` | **reversión** de operación cerrada (estado + reactivación de inmueble + confirmación), nota de comisiones alineada |

## A9. Validaciones (ampliación)

`tsc` ✅ · `lint --max-warnings=0` ✅ · `build` ✅. Scans: comisión inventada/hardcodeada **0** ·
ticket medio **0** · mock en real **0** · pipeline/expediente/probabilidad/stage/listed/won/lost
visibles **0** · service_role **0** · UUID **0** · botón muerto **0**.

## A10. Pendientes honestos (ampliación)

- **Reactivación de inmueble desde la pestaña Cartera** (select directo histórico→activo) se aplica
  con toast (no destructivo, no borra nada) pero **sin** modal de confirmación dedicado; la reversión
  guiada se ofrece desde **Operaciones** (que es donde nace el cierre). Modal de "Reactivar inmueble"
  en Cartera = micro-ajuste futuro.
- La reversión reactiva el inmueble a `listed`/`reserved` (estado activo razonable), no necesariamente
  al estado exacto previo al cierre (no se guarda histórico de estado del inmueble). Documentado.
- `closedValue` sigue calculado y reservado para el módulo económico futuro.

## Veredicto

**P11.2 COMPLETADO — DASHBOARD SIN HUMO Y COMISIONES REALISTAS.** La cartera del Dashboard muestra
**solo el estado actual** (donut de activos; vendidos/alquilados y archivados como contexto
secundario), sin que el histórico distorsione aunque crezca; se eliminó "Ticket medio" (humo) y se
etiquetaron con fórmula las métricas orientativas (potencial/previsto), que **solo existen sobre
operaciones con comisión pactada real** — **nunca se inventa un 3%**; y una operación marcada como
vendida/alquilada por error **se puede reabrir de forma segura y guiada**, reactivando el inmueble sin
borrar nada y recalculando comisiones por el estado actual. **Cero mocks en modo real.** Sin tocar
n8n/Agent V2/API/RLS/Storage/Auth ni migraciones. `tsc`/`lint`/`build` en verde, scans limpios, datos
del workspace de ejemplo verificados por MCP. **Requiere redeploy del front.** Listo para el Asistente.
