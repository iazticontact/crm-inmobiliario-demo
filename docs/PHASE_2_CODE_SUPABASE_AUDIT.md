# Fase 2A — Auditoría del código actual contra Supabase

> Auditoría **real** de qué tablas/columnas/Storage espera el código de hoy, para diseñar el backend nuevo sin sorpresas.
> Estado base: branch `main`, commit `261d447`, tag `demo-v1` → `ca04af9`.
> **No se ha ejecutado SQL ni se ha tocado Supabase.** Documento de solo lectura.
> Fuente de verdad: el código en `src/`. Documentos antiguos en `docs/supabase/*` son referencia histórica (no se reutilizan).
> Siguiente: [PHASE_2_SCHEMA_DESIGN.md](PHASE_2_SCHEMA_DESIGN.md) · [PHASE_2_STORAGE_PLAN.md](PHASE_2_STORAGE_PLAN.md) · [PHASE_2_BILLING_DESIGN.md](PHASE_2_BILLING_DESIGN.md) · [PHASE_2_IMPLEMENTATION_PLAN.md](PHASE_2_IMPLEMENTATION_PLAN.md)

---

## Cómo accede el código a Supabase

| Cliente | Archivo | Uso | Clave |
|---|---|---|---|
| **Browser** | `src/lib/supabase.ts` (`createBrowserClient`) | Lecturas/escrituras desde el navegador (RLS aplicada). Sesión en cookies. | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (o `ANON_KEY`) |
| **Server (SSR)** | `createServerClient` en `src/proxy.ts` + rutas API | Auth server-side, lecturas con permisos del usuario. | publishable/anon (cookies) |
| **Admin (service_role)** | `src/lib/supabase-admin.ts` (`getSupabaseAdmin`) | Operaciones privilegiadas **solo backend** (invitar/borrar usuarios, borrar Storage, leer tokens). | `SUPABASE_SERVICE_ROLE_KEY` |

**Observaciones de seguridad (ya correctas en el código):**
- `service_role` se usa **solo** en rutas server (`api/agent/tool`, `api/team/users*`, `api/clients/[id]/documents/[docId]` delete, `debug/*`). Nunca en el navegador.
- Los helpers degradan a `null`/`[]` cuando Supabase no está configurado → la demo offline no se rompe.
- **No hay `.rpc()`** en el código: cero dependencia de stored procedures/funciones SQL. Todo es CRUD sobre tablas + Storage.
- Auth: `signInWithPassword`, `signOut`, `getUser`, `getSession`, `exchangeCodeForSession`, `updateUser`, `resetPasswordForEmail`, `onAuthStateChange`, y admin `inviteUserByEmail` / `deleteUser`.
- El workspace **se deriva siempre de la sesión** (`profiles.workspace_id`), nunca del body del request (ver `reports/invoice`, `clients/documents`).

---

## Inventario por módulo

> Leyenda RLS: ✅ = necesita RLS por `workspace_id`. Storage: 📦 = usa bucket. service_role: 🔑 = necesita backend privilegiado.

### Auth / profiles / workspaces
- **Tablas:** `profiles`, `workspaces`.
- **`profiles` (columnas que usa el código):** `id` (= `auth.users.id`), `workspace_id`, `email`, `full_name`, `role` (`'nowlabs_admin' | 'client_admin' | 'member'`). Resuelto por `id` y, como fallback, por `email` (`ilike`).
- **`workspaces`:** `id`, `name`, `workspace_id` referenciado por todo. `.select('*')`.
- **Relaciones:** `profiles.id → auth.users.id`; `profiles.workspace_id → workspaces.id`.
- **Usado por:** `AuthGate.tsx`, `current-user.ts`, `getResolvedWorkspaceContext` (supabase-queries.ts), casi todas las rutas API (derivan workspace).
- **Fallback demo:** ✅ sí (`current-user.ts` cortocircuita con `DEMO_MODE_KEY`).
- **RLS:** ✅ crítico. **service_role:** 🔑 para crear/borrar usuarios (`team/users`).
- **Riesgo:** el modelo actual es **1 profile → 1 workspace** (`profiles.workspace_id`). Multi-workspace requiere cambiar este resolver (ver 2B `workspace_members`).

### Dashboard
- **Tablas:** lee de las demás (clients, opportunities, calendar_events, tasks, activities, invoices).
- **Usado por:** `app/(saas)/dashboard/page.tsx`.
- **Fallback demo:** ✅ sí (mock-data.ts).
- **RLS:** ✅ (heredada de las tablas que consulta). **Storage/service_role:** no.
- **Riesgo:** muchos KPIs son agregaciones; en real conviene índices por `workspace_id`.

### Clients
- **Tabla:** `clients`. **Columnas (tipo `Client` + queries):** `id`, `workspace_id`, `name`, `email`, `phone`, `channel` (`web|whatsapp|instagram|email|crm`), `status` (`active|lead|inactive|churned`), `lead_score`, `company`, `notes`, `metadata (jsonb)`, `created_at`, `updated_at`.
- **Usado por:** `clients/page.tsx`, `ClientPicker.tsx`, agent tools, reports.
- **Fallback demo:** ✅ sí (guards demo en crear/editar/borrar).
- **RLS:** ✅. **Storage/service_role:** no (directo).
- **Riesgo:** `channel`/`status` como enums vs texto+CHECK (personalización por cliente).

### Client detail (Ficha 360)
- **Tablas:** `clients` + agregados: `opportunities`, `service_cases`, `properties`, `activities`, `conversations`, `calendar_events`, `invoices`, `documents`, `tasks`.
- **Usado por:** `clients/[id]/page.tsx`.
- **Fallback demo:** ✅ sí (carga `demoClientsList` + filtra demo data; guards en notas y subir documento — añadidos en Fase 1J).
- **RLS:** ✅. **Storage:** 📦 `client-files` (documentos). **service_role:** 🔑 para borrar documento.
- **Riesgo:** la ficha hace muchas queries en paralelo; en real, cuidar N+1 e índices por `client_id`.

### Opportunities
- **Tabla:** `opportunities`. **Columnas (`OpportunityRow`):** `id`, `workspace_id`, `client_id`, `title`, `vertical`, `pipeline`, `stage`, `value`, `probability`, `currency`, `source`, `assigned_to`, `expected_close_date`, `notes`, `metadata (jsonb, p.ej. property_id)`, `created_at`, `updated_at`.
- **Usado por:** `opportunities/page.tsx`, `vertical-queries.ts`, agent tools, ficha cliente.
- **Fallback demo:** ✅ (cambios de etapa optimistas + toast «Modo demo»).
- **RLS:** ✅. **Riesgo:** historial de cambios de etapa **no existe** hoy (ver `opportunity_stage_history` en 2B). `metadata.property_id` es una FK implícita en jsonb.

### Properties
- **Tabla:** `properties`. **Columnas (`PropertyRow`):** `id`, `workspace_id`, `client_id`, `title`, `property_type`, `operation_type`, `status`, `city`, `area`, `address`, `price`, `currency`, `owner_name`, `owner_phone`, `notes`, `metadata (jsonb)`, `created_at`, `updated_at`.
- **Usado por:** `opportunities/page.tsx` (pestaña Propiedades), `vertical-queries.ts`, ficha cliente.
- **Fallback demo:** ✅. **RLS:** ✅.
- **Riesgo:** no hay tabla de **media** de propiedad (fotos) — necesaria en real (`property_media` + bucket, ver 2B/2C).

### Service cases / Expedientes
- **Tabla:** `service_cases`. **Columnas (`ServiceCaseRow`):** `id`, `workspace_id`, `client_id`, `opportunity_id`, `case_type`, `vertical`, `title`, `status`, `priority`, `due_date`, `assigned_to`, `notes`, `metadata (jsonb)`, `created_at`, `updated_at`.
- **Usado por:** `opportunities/page.tsx` (pestaña Expedientes), `vertical-queries.ts`, ficha cliente.
- **Fallback demo:** ✅. **RLS:** ✅.

### Calendar
- **Tabla:** `calendar_events`. **Columnas (tipo `CalendarEvent` + queries):** `id`, `workspace_id`, `client_id`, `title`, `start_at`, `end_at`, `date`, `start_hour`, `start_minute`, `duration`, `type` (`call|demo|meeting|follow-up`), `client_name`, `location`, `notes`, `description`, `status`, `metadata`, `google_event_id`, `google_calendar_id`, `sync_source`, `last_synced_at`, `is_read_only`, `created_at`, `updated_at`.
- **Usado por:** `calendar/page.tsx`, sync de Google (`api/integrations/google/calendar/*`), agent tools, ficha cliente.
- **Fallback demo:** ✅ sí (crea/edita/borra optimista local; no toca Supabase en demo).
- **RLS:** ✅. **service_role:** 🔑 en algunas rutas de sync. **Storage:** no.
- **Riesgo:** unicidad por `google_event_id` para evitar duplicados de sync; coherencia local↔Google.

### Tasks
- **Tabla:** `tasks`. **Columnas:** `id`, `workspace_id`, `title`, `status` (`pending|done`), `priority`, `due_date`, `client_id`, `client_name`, `assigned_to`, `metadata`, `created_at`, `updated_at`.
- **Usado por:** dashboard, ficha cliente, agent tools (`assistant-tools.ts`, `confirm` route crea tareas).
- **Fallback demo:** ✅. **RLS:** ✅.

### Activities
- **Tabla:** `activities`. **Columnas:** `id`, `workspace_id`, `type`, `title`, `description`, `client_id`, `client_name`, `metadata (jsonb; `source`='ui_manual'|'nowlabs_agent')`, `created_at`.
- **Usado por:** timeline en dashboard/ficha; escrito best-effort por casi toda escritura de negocio (`logActivity` en vertical-queries; `createActivity`).
- **Fallback demo:** ✅. **RLS:** ✅.
- **Riesgo:** se escribe mucho; índice por `(workspace_id, created_at desc)` y por `client_id`.

### Conversations
- **Tabla:** `conversations`. **Columnas (tipo `Conversation` + queries):** `id`, `workspace_id`, `client_id`, `client_name`, `channel`, `assistant_mode` (`inbox|copilot`, nullable), `status`, `last_message`, `timestamp/last_message_at`, `sentiment`, `unread`, `intent`, `metadata`, `created_at`, `updated_at`.
- **Usado por:** `inbox`, `assistant`, ficha cliente, agent tools.
- **Fallback demo:** ✅ (assistant usa `nowcrm-offline-*` en localStorage en demo).
- **RLS:** ✅.

### Messages
- **Tabla:** `messages`. **Columnas reales (de `MESSAGE_COLUMNS`):** `id`, `workspace_id`, `conversation_id`, `sender`, **`body`** (¡no `content`!), **`is_ai`** (bool), `created_at`. La UI (`Message`) mapea `body`→`content` y deriva `sender='ai'` de `is_ai`.
- **Usado por:** inbox, assistant, agent tools.
- **RLS:** ✅ (por `workspace_id` y/o vía conversation).
- **Riesgo:** ⚠️ **nombres de columna**: el schema nuevo debe usar `body` + `is_ai` (o adaptar el código). Documentar la decisión para no romper el mapeo.

### Documents
- **Tabla:** `documents`. **Columnas (insert real):** `id`, `workspace_id`, `client_id`, `title`, `type` (`client_file|invoice_pdf|proposal_pdf|conversation_attachment|workspace_asset`), `storage_bucket`, `storage_path`, `mime_type`, `size`, `created_by`, `metadata`, `created_at`.
- **Usado por:** `clients/[id]/documents/route.ts` (upload/list), `clients/[id]/documents/[docId]/route.ts` (signed URL / delete), assistant (PDFs).
- **Storage:** 📦 `client-files`. Path: `{workspace_id}/clients/{clientId}/{timestamp}-{safeName}`. Allowlist MIME, máx 50 MB.
- **service_role:** 🔑 para borrar (storage + fila atómico).
- **Fallback demo:** ✅ (en demo lista `[]` y guard al subir).
- **RLS:** ✅ + Storage policies por path `workspace_id/...`.

### Reports / PDF
- **Rutas:** `api/reports/invoice/route.ts`, `api/reports/client/route.ts`. Generan texto/PDF (`generateInvoicePdfBytes`, `simple-pdf`).
- **Tablas:** leen `invoices`/`clients` (workspace de sesión). Footer ya neutralizado a `BRAND.appName` (Fase 1J).
- **Storage:** PDFs van a buckets `facturas-pdf` / `informes-pdf` (registrados en `documents`).
- **service_role:** no obligatorio para generar; sí si se guarda server-side.
- **Riesgo:** facturación necesita PDF persistido + numeración (ver 2D).

### Invoices
- **Tabla:** `invoices`. **Columnas (tipo `Invoice` + queries):** `id`, `workspace_id`, `client_id`, `client_name`, `invoice_number`/`number`, `amount`, `currency`, `status` (`paid|pending|overdue`), `date`/`issue_date`, `due_date`, `paid_at`, `concept`/`plan`, `notes`, `metadata`, `created_at`, `updated_at`.
- **Usado por:** dashboard, ficha cliente, reports/invoice, agent tools.
- **Fallback demo:** ✅ (mock).
- **RLS:** ✅.
- **Riesgo:** **no hay `invoice_items`** hoy (importe único). Facturación core (2D) requiere items, IVA, numeración, estados ampliados (`draft`/`sent`/`cancelled`).

### Invoice items
- **Tabla:** ❌ **no existe hoy**. El código trata la factura como importe único (`amount`).
- **Necesidad:** sí, para facturación real (ver 2B + 2D).

### Assistant / agent tools
- **Tablas:** lee de `clients`, `invoices`, `calendar_events`, `tasks`, `opportunities`, `service_cases`, `properties`, `conversations`, `messages`; escribe `activities`, `agent_action_logs`, y vía `confirm` crea `tasks`/`calendar_events`/`invoices`.
- **Usado por:** `assistant-tools.ts`, `agent-tool-readers.ts`, `agents/nowlabs-main-agent.ts` (`runNowLabsAgent` — contrato protegido), `api/assistant/v2`, `api/assistant/confirm`, `api/agent/tool` (service_role + `AGENT_TOOL_SECRET`).
- **Tabla propia:** `agent_action_logs` (`id`, `workspace_id`, `user_id`, `action_type`, `payload`, `result`, `status`, `created_at`).
- **service_role:** 🔑 `api/agent/tool`.
- **Fallback demo:** ✅ (respuestas de muestra en demo).
- **RLS:** ✅. **Riesgo:** las prepared actions deben ejecutarse **solo tras confirmación** y validar workspace/rol server-side.

### Automations
- **Tablas:** `automation_workflows` (`workspace_id`, `name`, `label`, `webhook_url`, `status`, `source`, `metadata`). Catálogo estático en `automation-catalog`.
- **Usado por:** settings, `integrations.ts`, `api/n8n/trigger`, `api/automations/n8n/*`.
- **Gating:** módulo Automations oculto tras `nowlabsInternal`.
- **RLS:** ✅.
- **Necesidad nueva:** `automation_rules` + `automation_runs` para motor de reglas real (hoy solo se registran workflows n8n).

### Settings / Integrations
- **Tablas:** `integrations`, `inbox_agent_settings`, `whatsapp_connections`, `google_calendar_connections`, `automation_workflows`, `workspace_templates`. **Vistas:** `vw_integrations_status`, `vw_google_calendar_status`.
- **Tipos:** `MetaWhatsAppConnection`, `GoogleCalendarConnectionConfig`.
- **Usado por:** `settings/page.tsx`, rutas `api/integrations/*`.
- **service_role:** 🔑 para leer/escribir tokens sin RLS en algunas rutas de sync (Google/WhatsApp).
- **RLS:** ✅ — pero **tokens sensibles no deben exponerse vía anon key** (leer solo backend).
- **Riesgo:** ⚠️ tokens OAuth/WhatsApp en estas tablas → tratar como secretos (columnas separadas / cifrado / solo service_role).

### Team / roles
- **Tabla:** `profiles` (rol). **Rutas:** `api/team/users`, `api/team/users/[id]`.
- **Roles:** `nowlabs_admin` (operador interno, protegido), `client_admin`, `member`.
- **service_role:** 🔑 invitar (`inviteUserByEmail`) y borrar (`deleteUser`) usuarios.
- **RLS:** ✅ — `DELETE` de profiles restringido a `nowlabs_admin`; escalado de rol bloqueado.
- **Riesgo:** mantener el contrato de roles exacto (nombres protegidos).

### Notifications
- **Tabla:** `notifications` (`id`, `workspace_id`, `user_id`, `type`, `title`, `body`, `read`, `created_at`).
- **Usado por:** supabase-queries (`getNotifications`, marcar leídas).
- **RLS:** ✅ (usuario ve las suyas de su workspace).

---

## Resumen: tablas que el código YA espera

`profiles`, `workspaces`, `clients`, `properties`, `opportunities`, `service_cases`, `calendar_events`, `tasks`, `activities`, `conversations`, `messages`, `invoices`, `documents`, `integrations`, `inbox_agent_settings`, `whatsapp_connections`, `google_calendar_connections`, `automation_workflows`, `workspace_templates`, `notifications`, `agent_action_logs`.

**Vistas:** `vw_integrations_status`, `vw_google_calendar_status`.

**Buckets de Storage:** `client-files`, `facturas-pdf`, `informes-pdf`.

**No existen hoy pero el producto real necesita:** `workspace_members` (multi-tenant N:N), `invoice_items` + `invoice_sequences` + `billing_settings` (facturación core), `property_media` (fotos), `opportunity_stage_history` (trazabilidad), `automation_rules` + `automation_runs`, `prepared_actions` (IA), `vertical_config` (persistir config de vertical).

---

## Riesgos transversales detectados

1. **Nombres de columna en `messages`** (`body`/`is_ai`, no `content`/`sender='ai'`): el schema nuevo debe respetarlos o adaptar el mapeo del código. **Verificar antes de migrar.**
2. **FKs implícitas en `jsonb`** (`opportunities.metadata.property_id`): documentarlas; considerar columna real `property_id` en el rediseño.
3. **Tokens sensibles** en `whatsapp_connections`/`google_calendar_connections`/`integrations`: nunca exponer vía anon key; solo backend/service_role; valorar cifrado.
4. **Modelo de workspace 1:1** (`profiles.workspace_id`): multi-workspace real requiere `workspace_members` y tocar `getResolvedWorkspaceContext`.
5. **Facturación incompleta** para uso real (sin items/IVA/numeración/estados): rediseñar como core (2D).
6. **Sin historial de pipeline**: añadir `opportunity_stage_history` si se quiere reporting de conversión.
7. **Contratos internos protegidos** (`runNowLabsAgent`, `nowlabs_admin`, `NOWCRM_*`, `x-nowcrm-*`): conservar nombres; no romper al rediseñar.
8. **Demo offline**: el flag `DEMO_MODE_KEY` debe seguir cortocircuitando antes de Supabase en todas las páginas. No romper.
