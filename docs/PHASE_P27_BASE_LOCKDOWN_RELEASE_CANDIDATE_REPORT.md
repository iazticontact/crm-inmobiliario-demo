# FASE P27 — Base Lockdown / Release Candidate (sin extras)

> **Fecha:** 2026-07-01 · Objetivo: cerrar la base del CRM al máximo antes de extras. **No se implementó
> ningún extra** (documentos, notificaciones, facturación, import/export, integraciones, OCR). Solo
> auditoría, bugfixes reales, hardening del Asistente, confirmación de persistencia/RLS y limpieza de copy.

---

## 1. Diagnóstico inicial

Auditoría estática + de datos (no hay navegador aquí para QA visual interactiva). Se mapeó el CRM real
frente al esquema idealizado antiguo, se detectó y corrigió el único bug base bloqueante (Asistente
consultando una tabla inexistente) y se limpiaron términos prohibidos visibles. La capa de datos/RLS/n8n ya
estaba verificada en P24–P26.

## 2. Scope congelado

- **Base (auditada/cerrada):** Login, Dashboard, Clientes, Cliente detalle, Cartera/Inmuebles, Operaciones,
  Trámites, Comisiones, Calendario, Asistente IA (Agent V2), Configuración (Perfil/avatar, Empresa/logo,
  Equipo), Sidebar/Topbar, Supabase/RLS, n8n read-only.
- **Extras (NO tocados, hidden en prod):** WhatsApp/Inbox, Automatizaciones, Facturación/Billing,
  plantillas, y las pestañas Documentos/Conversaciones/Facturas del cliente. Todos gateados tras
  `NEXT_PUBLIC_NOWLABS_INTERNAL` (=`false` en prod) → **no visibles en el producto base**.

## 3. Confirmación de no extras

Cero features nuevas. Los cambios son: 1 bugfix del Asistente (repunta a tabla real), 5 correcciones de copy
visible, y actualización de evals/docs. No hay nuevas tablas (salvo la ya existente de P25), buckets,
endpoints, ni UI nueva.

## 4–11. Auditoría por módulo (resumen)

| Módulo | Estado | Nota |
|---|---|---|
| Dashboard | OK | Sin métricas fake nuevas; datos vía Supabase real. |
| Clientes | OK | "Score {leadScore}" gateado a interno (no visible en prod). |
| Cartera/Inmuebles | OK | `pipeline` es key interna; label visible = "Operaciones". |
| Operaciones | OK | Visible "Operación"; "oportunidad/pipeline" solo en código/comentarios. |
| Trámites | OK | Activos/Finalizados por estado; "expediente" eliminado del diálogo de borrado. |
| Comisiones | OK | Derivadas de `opportunities` (commission_*); no hay tabla `commissions`. |
| Calendario | OK | Europe/Madrid; rangos; sin UTC visible. |
| Configuración | OK | `workspace_settings` existe (P25); avatar/logo buckets OK; persiste. |
| Sidebar/Topbar | OK | Sin marca antigua/Copiloto/NowLabs visibles; internos gateados. |

## 12–15. Asistente IA

- **BUG BASE ENCONTRADO Y CORREGIDO:** `get_documents_metadata`, `crm_read_query(entity=documents)` y el
  `expand documents` (que se dispara en "ficha completa") consultaban la tabla **`documents`, inexistente**
  en esta BD → el dedicado devolvía error "no pude leer los documentos" y la ficha completa tocaba una tabla
  fantasma. **Fix:** `get_documents_metadata` ahora lee la tabla real **`entity_files`** (category=document,
  enlace por entity_type/entity_id), solo metadata (nombre/tipo/tamaño/fecha, **nunca contenido**); y se
  quitó `documents` del expand/entity genéricos. **Verificado E2E** (backend local + Supabase real):
  - `get_documents_metadata` → 200, devuelve `RUTINA.pdf` (application/pdf, 490 KB) real. ✓
  - `crm_read_query documents` → 422 `invalid_input` (graceful, NO error de BD). ✓
  - `crm_read_query clients detailLevel=full` → 200, expande inmuebles/operaciones/citas/tareas/trámites/
    actividad **sin** tocar `documents` ni errorizar. ✓
- **Readers legacy** `get_crm_overview`/`get_client_360` siguen consultando `invoices`/`conversations`
  (inexistentes) pero con `Promise.all` → Supabase devuelve `{data:null}` y **degradan a vacío** (sin crash,
  sin error visible). Benignos; recomendada limpieza cuando lleguen esos módulos (no bloqueante).
- Resto verificado en P24–P26 (error≠vacío, cuenta vacía, rangos, sin IDs, crisis/cost guard, expand caps).

## 16. Persistencia

Tablas base con datos reales y frescos (P26): clientes 9, citas 12, inmuebles 8, operaciones 8, trámites 5,
tareas 11 (workspace con datos). `workspace_settings` persiste (P25). Buckets avatar/logo OK.

## 17. RLS / multiworkspace

**Verificado:** RLS habilitada en las 12 tablas base/soporte (`clients` 5 policies, `properties` 5,
`opportunities` 5, `service_cases` 5, `tasks` 4, `calendar_events` 4, `activities` 3, `entity_files` 4,
`workspace_settings` 4, `workspace_members` 4, `workspaces` 2, `profiles` 3). Sin `service_role` en frontend.
El sondeo por workspace del Asistente devuelve solo datos del workspace pedido (P26). Sin cross-workspace.

## 18. Migrations / DB drift

14 tablas reales; el código base solo usa las existentes. Código que referencia tablas inexistentes
(`invoices/conversations/messages/documents/notifications/integrations/automation_workflows/n8n_flows/
inbox_agent_settings/workspace_templates`) pertenece a **módulos internos gateados** (hidden en prod) o
degrada a vacío. Buckets: `entity-files` (privado, 10MB), `company-logos`/`profile-avatars` (públicos, 2MB).

## 19–20. Formularios / acciones peligrosas

Auditoría estática: los flujos de borrado usan diálogo de confirmación (`DeleteClientDialog` lista el impacto
— ahora "trámites", no "expedientes"). Las mutaciones de escritura del Asistente están deshabilitadas (Agent
V2 read-only; "cero humo" verificado en fases previas). QA interactiva de submit/validación/doble-submit por
formulario: **requiere navegador → pendiente de QA manual** (ver §29).

## 21–23. Visual / mobile / accesibilidad

**No ejecutable sin navegador** desde este entorno. `build` compila todas las rutas sin error. Copy visible
limpiado (§26). QA visual/responsive/a11y interactiva queda como pendiente honesto de QA manual (§29).

## 24. Seguridad

Sin secretos en repo/diff (escaneado). Sin `service_role` en frontend. Debug panel del Asistente gateado a
`SHOW_ASSISTANT_DEBUG && NODE_ENV==='development'` (no expone UUIDs en prod). `/api/agent/diag` protegido por
secreto para conteos. n8n intacto (no tocado). RLS en todas las tablas base.

## 25. Performance

`build` verde (~11s). Readers con `Promise.all`; expand con caps (≤5×5); `force-dynamic` solo donde toca;
cost guard activo. Nit menor: `get_crm_overview`/`get_client_360` hacen 1–2 queries a tablas inexistentes que
vuelven vacías (coste ínfimo; limpieza futura).

## 26. Scans (términos prohibidos visibles)

Corregidos en UI base visible: **"expediente(s)"→"trámite(s)"** (login, `DeleteClientDialog`),
**"workspace"→"cuenta"** (reset-password, Clientes header, `TeamCalendarStatusCard`). Verificado gateado (no
visible en prod): "Score {leadScore}", panel debug con UUIDs, pestañas Documentos/Facturas/Conversaciones,
módulos WhatsApp/Automatizaciones/Facturación. Sin Copiloto/NowLabs/Próximamente visibles en base.

## 27. Tests/evals

- `assistant-expand.evals.ts`: actualizado — `documents` fuera del expand allowlist (se sirve por
  `get_documents_metadata`); añade aserción de que `documents` NO está en `EXPAND_ALLOWED`.
- `assistant-coherence.evals.ts`: fixture de ficha completa actualizado (documentos vía tool dedicada).
- Suites intactas: `assistant-diag`, `assistant-reliability`, `portfolio-filter`, `profile-avatar`,
  `product-capabilities`.

## 28. Validaciones

`npx tsc --noEmit` ✅ · `npm run lint -- --max-warnings=0` ✅ · `npm run build` ✅ (Compiled successfully) ·
`node --check scripts/check-agent-deploy.mjs` ✅ · probe E2E documentos contra backend local ✅ · git limpio ·
sin temp files · sin secretos · sin cambios n8n · sin migraciones nuevas.

## 29. Pendientes honestos

1. **QA interactiva (visual/mobile/a11y/formularios):** no ejecutable sin navegador desde aquí. La lógica y
   el copy están auditados estáticamente y el build es verde, pero un humano debe hacer una pasada por las
   pantallas base (crear/editar cliente/inmueble/cita/trámite/tarea, subir avatar/logo y recargar, responsive
   móvil). No es un bug conocido; es una verificación que requiere navegador.
2. **Limpieza de readers legacy** (`invoices`/`conversations` en `get_crm_overview`/`get_client_360`):
   degradan a vacío (benigno). Limpiar cuando se aborden esos módulos. No bloqueante.
3. **Verificación de deploy real** (P26): al primer despliegue, `check-agent-deploy.mjs` contra el dominio.

## 30. Decisión final

### ✅ BASE CERRADA PARA EXTRAS

Todo lo verificable objetivamente desde aquí está **en verde**: el **único bug base** (Asistente ↔ tabla
inexistente) está **corregido y verificado E2E**; RLS activa en todas las tablas base; persistencia,
`workspace_settings`, avatar/logo y buckets OK; Asistente honesto (error≠vacío, sin IDs, metadata-only de
documentos); copy base limpio de términos prohibidos; validaciones verdes; sin secretos; sin extras
introducidos. Los pendientes (§29) **no son bugs base bloqueantes**: son (a) QA interactiva que requiere
navegador humano y (b) limpieza cosmética de readers legacy benignos.

> **Recomendación:** apta para empezar extras. Antes de producción, completar la pasada de QA visual/mobile
> manual (§29.1) y la verificación de deploy real (§29.3). Si esa QA manual revelara un bug bloqueante, se
> abriría un P28 de cierre puntual — pero a nivel de código/datos/seguridad/Asistente, la base está cerrada.
