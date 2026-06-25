# FASE P11.1 — Dashboard accionable + vencimientos resolubles + tooltips explicativos

> **Fecha:** 2026-06-25 · Pulido final del Dashboard premium (sobre P11, commit `3c07647`): tooltips
> útiles, "Todo" entendido como histórico, gráfico mensual de comisiones con nº de cobros,
> **vencimientos accionables** (completar tareas desde Dashboard y Calendario) y **corrección del bug
> "No se pudo actualizar la tarea"**. Trabajo 100 % sobre el CRM (código + MCP de lectura). **Sin
> tocar n8n / Agent V2 / API / RLS / Storage / Auth / migraciones.** Requiere redeploy del front.

---

## 1. Diagnóstico

- **Bug crítico:** completar una tarea (ficha de cliente → Tareas → "Completar") fallaba con toast
  genérico "No se pudo actualizar la tarea".
- **Tooltips:** los KPIs/gráficos/filtros no explicaban su significado; el filtro **"Todo"** no se
  entendía (¿stock o flujo?).
- **Gráfico de cobros:** el mini-bar no decía cuántas operaciones se habían cobrado por mes, y "Todo"
  solo cubría el año natural actual.
- **Actividad reciente:** mostraba texto técnico crudo ("Stage won · 390000€ · 10%", "piso · venta ·
  Valencia · listed", "pasa a archived.") — feo y con vocabulario prohibido.
- **Vencimientos:** se listaban pero no se podían resolver desde el Dashboard.

## 2. Bug de completar tarea — causa raíz y arreglo

**Causa (verificada por MCP):** la columna `tasks.status` tiene un CHECK constraint
`tasks_status_check = status IN ('pending','done')`. El handler de la ficha escribía
`status: 'completed'` → Postgres rechazaba el UPDATE → `updateTask` **se tragaba el error** y devolvía
`null` → toast genérico. (RLS correcta: owner/admin/comercial pueden actualizar; `updated_at` lo pone
el trigger `set_updated_at`.)

**Arreglo (solo código, sin migración — `'done'` ya es el valor canónico y existe en la BD):**
- `src/app/(saas)/clients/[id]/page.tsx`: al completar se escribe **`'done'`** (antes `'completed'`).
  Reabrir sigue escribiendo `'pending'`. Ambos válidos para el constraint.
- `src/lib/supabase-queries.ts` → `updateTask`:
  - **`normalizeTaskStatus()`** (nuevo, exportado): mapea sinónimos (`completed/complete/closed/
    completada/finalizada/hecha → done`; `open/todo/pendiente/abierta → pending`) para que ningún
    llamador (incl. las nuevas acciones del Dashboard/Calendario) rompa el constraint.
  - Ahora **propaga el error real** (`throwNormalized`) en vez de devolver `null` en silencio → los
    toasts pueden mostrar la causa útil.
- Efecto: completar funciona; al completar una tarea vencida desaparece de "Vencimientos críticos"
  (Dashboard) y de "Vencen pronto" (Calendario) y del contador de vencidos, sin F5. Reabrir/editar
  intactos. RLS respetada (mismo workspace, usuario autenticado, sin `service_role`).

## 3. Vencimientos accionables

**Dashboard → "Vencimientos críticos"** y **Calendario → "Vencen pronto"** (mismo patrón, consistente):
- **Tarea:** botón **"Completar"** (✓) → `updateTask(status:'done')` con **actualización optimista** +
  **rollback** si falla + toast con causa. En el Dashboard se actualiza el snapshot local (la tarea
  sale de la lista y del badge de vencidos sin recargar); en el Calendario se quita de la lista.
- **Trámite (service_case):** acción **"Ver"** → abre el inmueble/cliente/cartera. (No se completa el
  trámite directamente desde aquí: ver §12 "Pendientes honestos".) **Sin botones muertos**: el botón
  solo aparece cuando hay acción real.
- Máximo 5 visibles + "y N más"; cada item muestra tipo (Tarea/Trámite), título, cliente/inmueble y
  venció/vence. Modo demo: las acciones avisan "Modo demo (no se guarda)".

## 4. Tooltips / explicaciones

Componente nuevo **`src/components/InfoTooltip.tsx`**: icono (i) accesible (hover, focus de teclado y
tap en móvil; `role="tooltip"`, `aria-label`), sin dependencias. Para datos densos se usa el atributo
nativo `title` (no satura, accesible, no rompe en móvil).

- **Filtro "Vista:"** → `InfoTooltip` general + `title` por opción (mes/trimestre/semestre/año/**Todo =
  histórico completo desde el inicio**).
- **KPIs** (`MetricTile hint`): Comisión cobrada ("control interno, no facturación fiscal"), Trámites
  urgentes, Operaciones abiertas, Inmuebles activos, Clientes activos, Citas de hoy.
- **Donut comisiones** (`DonutSegment.hint`): Cobrada / Pendiente de cobro / Potencial abierto.
- **Donut cartera:** Publicado / Reservado / En preparación / Histórico + activos.
- **Estado comercial:** cada estado (Nueva / En gestión / Reserva / Vendida-Alquilada / Perdida).

## 5. Filtro "Todo" y métrica histórica

"Todo" ahora se entiende como **histórico**:
- Subcopys: "Comisión cobrada **histórica**", sección "Comisiones · **histórico desde el inicio** ·
  control interno", tile "Cobrada · histórico", KPI "Histórico · control interno".
- Nota de aclaración **stock vs flujo** (solo en "Todo"): *"En vista histórica, la comisión cobrada es
  el total acumulado; pendiente y potencial reflejan el estado actual."*
- El tooltip de "Vista:" lo explica: las métricas temporales se filtran; cartera/pendiente/potencial
  son siempre estado actual.

## 6. Gráfico mensual de comisiones / cobros

`buildEconomics` (snapshot) ahora:
- Cada bucket lleva **`count`** (nº de cobros) además del importe → tooltip por barra: *"Jun: 16.800 €
  · 1 cobro"*.
- **"Este mes"** → barras por semana (S1–S5); resto → por mes.
- **"Todo"** → **últimos 12 meses (rolling)** hasta el mes actual (antes solo el año natural, que
  recortaba el histórico entre años).
- Empty state honesto ("Sin cobros registrados en el histórico/periodo"). Encabezado "Comisión cobrada
  por mes/semana · control interno". Sin librerías nuevas, sin N+1.

## 7. Actividad reciente

Humanizador de presentación **`humanizeActivity()`** (no toca los datos almacenados):
- "Stage won · 390000€ · 10%" → **"Operación actualizada · 390.000 €"** (sin stage/won/probabilidad).
- "piso · venta · Valencia · listed" → **"Inmueble actualizado"**.
- "… pasa a etapa won." → **"… pasa a Vendida."**; "… pasa a archived." → **"… pasa a Archivado."**;
  "… pasa a under_contract." → **"… pasa a Reservado."**, etc.
- Quita "Stage", "etapa", inglés técnico (listed/sold/rented/won/lost/…) y los "· NN %" legacy.
  Verificado contra las cadenas reales del workspace de ejemplo (9/9 limpias).

## 8. Copy final

Se mantiene: cliente, inmueble, cartera, operación, trámite, cita, comisión, vencimiento, histórico,
control interno, comisión cobrada / pendiente de cobro / potencial abierto. **No visible:** pipeline,
lead, expediente, probabilidad, stage, listed, won/lost, score; "facturación fiscal" solo aparece para
**negarla** (nota de límite). Las comisiones nunca se llaman ingreso/beneficio/facturación.

## 9. Rendimiento

0 N+1 · snapshot puro + `useMemo` · carga única `Promise.all` · sin Storage/signed URLs · sin
dependencias nuevas. Las acciones de completar son **optimistas con rollback** (no recargan la
página); el Dashboard recalcula el snapshot desde los datos crudos en memoria.

## 10. Seguridad

RLS intacta · scoped por workspace · usuario autenticado · **sin `service_role` en frontend (0)** ·
sin UUID visible (0) · sin PII real inventada · sin datos de otros workspaces · no se borra nada
(completar = update de status). Modo demo no persiste.

## 11. Qué NO se tocó

n8n · Agent V2 (`nowlabs-main-agent.ts`, `deterministic-db-actions.ts`) · `/api/agent/tool` ·
`/api/assistant/*` · Google Calendar OAuth/sync · Auth/onboarding · Storage/RLS policies · secretos/env
· facturación/impuestos/gastos reales · migraciones (0 DDL) · el resto de módulos salvo el arreglo
mínimo del bug en la ficha de cliente.

## 12. Validaciones

- `npx tsc --noEmit` ✅ · `npm run lint -- --max-warnings=0` ✅ · `npm run build` ✅ (`/dashboard` `○`).
- **Scans:** pipeline/expediente/probabilidad/stage/listed/won/lost **visibles = 0** (solo identifica-
  dores de código, comparaciones de enum de DB y claves de mapeo del humanizador) · `service_role`
  frontend = 0 · UUID visible = 0 · botón muerto = 0 · mock en modo real = 0.
- **MCP (solo lectura):** `tasks_status_check = (pending|done)` confirmado; `service_cases.status` sin
  constraint (free text: open/documentation_pending/in_review); humanizador verificado contra las 9
  actividades reales del workspace de ejemplo.

## 13. Archivos

| Archivo | Cambio |
|---|---|
| `src/lib/supabase-queries.ts` | `normalizeTaskStatus` (nuevo) + `updateTask` propaga error real y normaliza status |
| `src/app/(saas)/clients/[id]/page.tsx` | completar tarea escribe `'done'` (fix del bug) |
| `src/lib/dashboard-snapshot.ts` | `Deadline.rawId`; buckets con `count`; "Todo" = últimos 12 meses rolling |
| `src/app/(saas)/dashboard/page.tsx` | tooltips (InfoTooltip + hints), vencimientos accionables, humanizeActivity, copy "Todo", gráfico mensual con nº cobros |
| `src/components/UpcomingDeadlinesPanel.tsx` | completar tarea desde el Calendario (optimista + rollback) |
| `src/components/charts/DonutChart.tsx` | `hint` por segmento (tooltip) |
| `src/components/charts/MiniBarChart.tsx` | `hint` por barra (tooltip) |
| `src/components/InfoTooltip.tsx` | **nuevo** componente de tooltip accesible |

## 14. Commit

`polish(dashboard): vencimientos accionables + tooltips + fix completar tarea (P11.1)` (ver git).

## 15. Push

`origin/main` (ver sección final).

## 16. Redeploy

**Requiere redeploy del front** (cambios de cliente; sin migraciones ni cambios de backend).

## 17. Checklist de staging (QA manual)

- [ ] Dashboard: cambiar Vista (mes/trimestre/semestre/año/Todo); "Todo" muestra histórico claro.
- [ ] Hover/focus en KPIs, donuts (cobrada/pendiente/potencial, cartera), barras de estado y filtro.
- [ ] Gráfico "Comisión cobrada por mes/semana": tooltip con importe + nº de cobros.
- [ ] Actividad reciente sin "stage/won/listed/%": textos humanos.
- [ ] Completar una tarea vencida **desde el Dashboard** → desaparece de vencidos y del badge, sin F5.
- [ ] Completar una tarea **desde "Vencen pronto" del Calendario** → desaparece, sin F5.
- [ ] Completar una tarea **desde la ficha de cliente** → ya **no** sale "No se pudo actualizar".
- [ ] Reabrir tarea desde la ficha sigue funcionando.
- [ ] Trámite en vencimientos → botón "Ver" abre el inmueble/cliente (sin botón muerto).
- [ ] Móvil 390: tooltips no rompen; tarjetas y acciones legibles.
- [ ] Regresión: Cartera, Calendario (grid), Clientes y Asistente sin cambios.

## 18. Pendientes honestos

- **Completar trámite (service_case) desde Dashboard/Calendario:** se deja como "Ver" a propósito. El
  helper `updateServiceCaseStatus` existe, pero (a) registra una actividad con la palabra prohibida
  "Expediente" y estado en inglés, y (b) el cierre de un trámite suele requerir revisión. Alinear el
  workflow de estados + copy del trámite es una micro-fase del módulo Cartera/Trámites.
- **Agente (`deterministic-db-actions.ts`)** mapea "completada" → `'completed'`; si el agente actualiza
  tareas por esa vía, le afectaría el mismo constraint. Está **fuera de alcance** (no tocar Agent V2);
  se documenta para una pasada futura del agente (bastaría reutilizar `normalizeTaskStatus`).
- **WeekRail** (semana operativa) no se recalcula al completar una tarea (es un recuento informativo,
  no accionable); se actualiza al recargar.

## Veredicto

**P11.1 COMPLETADO — DASHBOARD ACCIONABLE Y EXPLICATIVO.** El bug de completar tarea está corregido de
raíz (constraint `pending|done`, sin migración) y con errores ahora visibles; las tareas vencidas se
resuelven desde el Dashboard **y** el Calendario (optimista + rollback); los KPIs, donuts, barras y el
filtro explican su significado al pasar el cursor; "Todo" se entiende como histórico (stock vs flujo
aclarado); el gráfico mensual muestra importe y nº de cobros; y la actividad reciente habla en humano
sin vocabulario técnico. Sin tocar n8n/Agent V2/API/RLS/Storage/Auth ni migraciones. `tsc`/`lint`/
`build` en verde, scans limpios. **Requiere redeploy del front.**
