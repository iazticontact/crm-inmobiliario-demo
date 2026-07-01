# FASE P35 — Facturación como módulo extra AISLADO (sin Asistente IA)

> **Fecha:** 2026-07-02 · Aclaración estratégica: Facturación es un **extra integrado en el CRM pero
> MANUAL**, y **NO** forma parte de lo que el Asistente IA lee o acciona todavía. Esta fase **blinda la
> frontera**: el módulo funciona a mano (P34), pero el Asistente no lee ni crea facturas. Sin n8n, sin
> emails, sin notificaciones, sin nuevas features.

---

## 1. Diagnóstico
Al crear la tabla `invoices` en P33, dos tools **reachables** del Asistente (`get_crm_overview`,
`get_client_360`) seguían consultando `invoices` con el **esquema antiguo** (`amount`/`concept`/
`client_name`), que ya no existe → lecturas que **erroraban en silencio** pero, sobre todo, **intentaban
leer facturas**. Además `get_invoices_summary` (registrada pero **no** expuesta por el n8n vivo) leía la
misma tabla. Y el intent local podía construir un `preparedAction` de factura incompleto.

## 2. Estado de facturación manual (P34, intacto)
`/facturacion` sigue operativo: listado + crear/editar borrador + líneas + cálculo live (IVA/IRPF/descuento)
+ emisión con **numeración atómica** + **PDF** + guardado en `entity-files` + descarga por signed URL +
estados + actividad. No se tocó su funcionalidad en P35.

## 3. Frontera del módulo (regla)
- **Integrado con:** clientes, operaciones, inmuebles, workspace, `entity_files`, `activities`, UI/Sidebar.
- **NO integrado (todavía) con:** **Asistente IA**, n8n, acciones automáticas, notificaciones, emails.
- **El Asistente NO tiene info de facturas por ahora.**

## 4. Confirmación de NO integración con el Asistente (cambios)
- **`get_crm_overview`** (agent-tool-readers): eliminada la query a `invoices` + el campo `invoices` del
  tipo y de la respuesta. Ya no lee facturas.
- **`get_client_360`**: eliminada la query a `invoices` + el campo `invoices` del tipo y de la respuesta.
- **`get_invoices_summary`**: neutralizada — **no consulta** `invoices`; devuelve un mensaje honesto
  (`not_available`: "La facturación se gestiona manualmente desde el módulo Facturación…").
- **`crm_read_query`**: **no** tiene entidad `invoices` (nunca se añadió). Confirmado.
- **Verificado E2E** (backend local + Supabase real): `get_crm_overview` keys = clients/tasks/calendar/
  activity/conversations (**sin `invoices`**); `get_invoices_summary` → **`not_available`**; `get_client_360`
  **sin campo `invoices`**. El Asistente no devuelve datos de facturas.

## 5. Action detection
- **`preparedAction` de factura DESACTIVADO** (`buildPreparedAction` ya no construye la acción `invoice`).
- **Intents de factura** (`invoice`/`invoice_concrete`/`invoice_general`) → respuesta que **remite al módulo
  Facturación** ("se gestiona de forma manual desde la sección Facturación…"), sin fingir que puede crearla,
  sin `preparedAction`, sin inventar datos.
- **Microparche en el fallback local** (`nowlabs-main-agent.ts`): "MÓDULO FACTURACIÓN (manual, no integrado):
  el Asistente NO crea/emite/consulta facturas todavía; remite a la sección Facturación".
- **Mantenido de P29:** precio/comisión/presupuesto/importe **≠** factura (solo facturación explícita).
- **Eval** añadida (`assistant-coherence`): petición de factura → menciona "Facturación", NO "la he creado"/
  "ya está emitida"/"factura preparada", NO "facturas pendientes:".

## 6. UI / QA manual (facturación)
Auditado el listado/filtros/crear-editar/líneas/cálculo/emitir/PDF/descarga/estados/empty-error states de
P34. Sin bugs nuevos; no se añadieron features. La QA visual en la app queda como manual (build verde).

## 7. Mobile
Sin cambios: inputs ≥16px (P28C), drawer usable, filtros con scroll horizontal limpio, cards responsive.

## 8. RLS / seguridad
Sin cambios en la RLS de P33 (verificada en P34: miembro sí, otro workspace rechazado; DELETE solo admin+
draft; emitidas no se borran). PDFs privados con signed URLs. Sin `service_role` en frontend. **El Asistente
usa service-role server-side pero ya no consulta `invoices`** → cero fuga de facturas por esa vía.

## 9. Archivos tocados
| Archivo | Cambio |
|---|---|
| `src/lib/agent-tool-readers.ts` | Quitadas lecturas de `invoices` en get_crm_overview + get_client_360; get_invoices_summary neutralizada (not_available) |
| `src/app/(saas)/assistant/page.tsx` | Sin `preparedAction` de factura; intents de factura → remiten al módulo |
| `src/lib/agents/nowlabs-main-agent.ts` | Microparche de frontera (facturación = módulo manual) |
| `src/lib/agents/__evals__/assistant-coherence.evals.ts` | +fixture de aislamiento de facturación |

## 10. Tests / validaciones
`npx tsc --noEmit` ✅ · `npm run lint -- --max-warnings=0` ✅ · `npm run build` ✅ ·
`node --check scripts/check-agent-deploy.mjs` ✅ · **probe E2E de aislamiento** ✅ · git limpio · sin secretos ·
sin temp files · **sin n8n** · **sin `crm_read_query` invoices** · **sin `preparedAction` invoice** · sin
emails/notificaciones · sin service_role frontend.

## 11–12. Commit / Push
Commit `refactor(p35): facturación aislada del Asistente IA (módulo manual)` → `origin/main`.

## 13. Pendientes honestos
- **Integración futura OPCIONAL (P36+ o cuando se decida):** el Asistente podría **leer** facturas
  (`crm_read_query` entidad `invoices` + reader) y **preparar** facturas (`prepare_invoice` como
  `preparedAction` con **confirmación**). Hoy queda deliberadamente fuera. El microparche del prompt vivo de
  n8n para reforzar la frontera **no** se aplicó (no imprescindible: no hay tool de facturas en el agente).
- **QA visual/manual de facturación** en la app + dispositivo real (heredado de P34).
- **get_workspace_summary** (tool muerta, no expuesta por n8n) aún referencia `invoices` degradando a 0;
  inofensiva y no reachable — limpieza futura opcional.

## 14. Veredicto
**P35 COMPLETADO — FACTURACIÓN AISLADA COMO EXTRA INTEGRADO, SIN ASISTENTE IA.** Facturación funciona a mano
(P34) y está integrada con clientes/operaciones/inmuebles/entity_files/activities/UI, pero el **Asistente no
lee ni acciona facturas**: se quitaron todas las lecturas de `invoices` de las tools reachables (verificado
E2E: sin campo `invoices`, `get_invoices_summary`→`not_available`), se desactivó el `preparedAction` de
factura y los intents de factura remiten al módulo manual; precio/comisión/presupuesto siguen sin ser
factura. `tsc`/`lint`/`build` verde. Sin tocar n8n, secretos ni la base. La integración con el Asistente
queda documentada como fase futura **opcional**.
