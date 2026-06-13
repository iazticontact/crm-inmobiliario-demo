# Fase 2B — Diseño de schema nuevo productivo

> Diseño de la base de datos nueva (Supabase/PostgreSQL): multi-tenant, RLS desde el día 1, reusable para clonar a futuros clientes inmobiliarios.
> **No es SQL final ni ejecutable.** Es el diseño aprobable antes de escribir migraciones (ver [PHASE_2_IMPLEMENTATION_PLAN.md](PHASE_2_IMPLEMENTATION_PLAN.md)).
> Anclado en [PHASE_2_CODE_SUPABASE_AUDIT.md](PHASE_2_CODE_SUPABASE_AUDIT.md). Storage en [PHASE_2_STORAGE_PLAN.md](PHASE_2_STORAGE_PLAN.md). Facturación en [PHASE_2_BILLING_DESIGN.md](PHASE_2_BILLING_DESIGN.md).

---

## Principios de diseño (no negociables)

- **Todo dato de negocio lleva `workspace_id`** (uuid, FK a `workspaces`).
- **RLS activada en TODAS las tablas de negocio** desde la primera migración.
- **`profiles` separado de `auth.users`** (extiende, no sustituye). FK `profiles.id = auth.users.id`.
- **`workspace_members` gobierna el acceso** (multi-tenant N:N) — superando el actual 1:1 `profiles.workspace_id`.
- **Nunca hardcodear `workspace_id`**: siempre derivado de la sesión vía helper SQL.
- **No reutilizar datos/keys antiguas.** Schema limpio desde cero.
- **Prepared actions para IA**, no ejecución directa: la IA propone, un humano confirma, el backend ejecuta validando.
- **Facturación es core**, no módulo secundario (ver 2D).
- **`created_at` / `updated_at`** en toda tabla; `updated_at` por trigger.
- **Soft delete** (`deleted_at timestamptz null`) en tablas de negocio con valor histórico (clients, properties, opportunities, invoices, documents). Las policies filtran `deleted_at is null`.
- **Auditabilidad**: `created_by` (uuid → profiles) donde aplique; tablas de log para acciones de IA/automatización.

### Convenciones
- PKs: `uuid` con `default gen_random_uuid()` (extensión `pgcrypto`).
- Timestamps: `timestamptz`.
- Dinero: `numeric(12,2)` + `currency text default 'EUR'`.
- Campos personalizables por cliente (stage, case_type, status): **`text` + `CHECK`** (o tabla de catálogo), **no enums rígidos**. Enums solo para lo verdaderamente fijo (`message.sender`, `invoice.status`).
- `metadata jsonb default '{}'` para extensibilidad sin migraciones.

### Helper de aislamiento (base de toda policy)
```
-- Pseudocódigo de diseño (NO ejecutar aquí)
function current_workspace_ids() returns setof uuid
  := select workspace_id from workspace_members where user_id = auth.uid()
-- (fase 1 puede derivarlo de profiles.workspace_id hasta migrar a members)
```
Toda policy de tabla de negocio: `USING (workspace_id IN (select current_workspace_ids()))`.

---

## Núcleo multi-tenant

### `workspaces` — el tenant · **día 1** · 🟢 código
- **Propósito:** la inmobiliaria. Raíz del aislamiento.
- **Columnas:** `id uuid pk`, `name text not null`, `slug text unique`, `vertical text default 'real_estate'`, `plan text default 'starter'`, `trial_ends_at timestamptz`, `branding jsonb default '{}'` (logo, color, nombre visible), `settings jsonb default '{}'`, `created_at`, `updated_at`.
- **Índices:** `pk(id)`, `unique(slug)`.
- **RLS:** miembros (`SELECT`); `client_admin`/`owner` (`UPDATE`); creación controlada (onboarding/server).
- **Soft delete:** no (un workspace se desactiva por `plan`/flag, no se borra).

### `profiles` — usuario de la app · **día 1** · 🟢 código
- **Propósito:** extiende `auth.users` con datos de app.
- **Columnas:** `id uuid pk` (= `auth.users.id`), `workspace_id uuid` (FK; workspace «principal»/por defecto), `email text`, `full_name text`, `role text check (role in ('nowlabs_admin','client_admin','member'))`, `avatar_url text`, `created_at`, `updated_at`.
- **FKs:** `id → auth.users.id (on delete cascade)`, `workspace_id → workspaces.id`.
- **Índices:** `pk(id)`, `index(workspace_id)`, `index(lower(email))`.
- **RLS:** propio perfil (`SELECT`/`UPDATE` campos básicos); admins ven los de su workspace; `DELETE` solo `nowlabs_admin`; cambios de rol solo admin.
- **Nota:** conserva el contrato de roles (`nowlabs_admin` protegido). El código resuelve profile por `id` y por `email` (ilike) — mantener ambas vías.

### `workspace_members` — membresía N:N · **día 1 (recomendado)** · 🟡 evolución
- **Propósito:** un usuario en uno o varios workspaces con rol por workspace. Reemplaza el 1:1 implícito.
- **Columnas:** `id uuid pk`, `workspace_id uuid fk`, `user_id uuid fk (auth.users)`, `role text check (...)`, `invited_by uuid`, `created_at`. **`unique(workspace_id, user_id)`**.
- **Índices:** `unique(workspace_id,user_id)`, `index(user_id)`.
- **RLS:** el usuario ve sus filas; admin del workspace gestiona miembros.
- **Decisión:** crear la tabla en día 1, pero el resolver puede empezar leyendo `profiles.workspace_id` y migrar a `workspace_members` sin romper el frontend. Documentar el corte. (Ver riesgo «modelo 1:1» en 2A.)

### `vertical_config` — config por vertical · **día 1 (ligero)** · 🟡 evolución
- **Propósito:** persistir lo que hoy vive en `vertical-templates.ts` + `localStorage` (`nowcrm.workspaceVertical`): pipelines, tipos de expediente, campos.
- **Columnas:** `id uuid pk`, `workspace_id uuid fk`, `vertical text`, `pipeline_config jsonb`, `case_types jsonb`, `field_config jsonb`, `created_at`, `updated_at`. **`unique(workspace_id, vertical)`**.
- **RLS:** por `workspace_id`.

---

## CRM

### `clients` · **día 1** · 🟢 código
- **Columnas:** `id uuid pk`, `workspace_id uuid fk not null`, `name text not null`, `company text`, `email text`, `phone text`, `channel text check (channel in ('web','whatsapp','instagram','email','crm'))`, `status text check (status in ('active','lead','inactive','churned')) default 'lead'`, `lead_score int default 0`, `notes text`, `assigned_to uuid (profiles)`, `metadata jsonb default '{}'`, `created_at`, `updated_at`, `deleted_at`.
- **Índices:** `index(workspace_id)`, `index(workspace_id,status)`, `index(workspace_id, lower(name))`, `index(assigned_to)`.
- **RLS:** por `workspace_id`. **Soft delete:** sí.

### `client_contacts` · futura · 🟡
- **Propósito:** varios contactos por cliente (empresa con varias personas).
- **Columnas:** `id`, `workspace_id`, `client_id fk`, `name`, `role`, `email`, `phone`, `is_primary bool`, `created_at`.
- **RLS:** por `workspace_id`. Adoptar si un cliente lo pide.

### `client_preferences` · futura · 🟡
- **Propósito:** criterios de búsqueda del comprador (zona, presupuesto, habitaciones) para matching con propiedades.
- **Columnas:** `id`, `workspace_id`, `client_id fk`, `operation_type`, `min_price`, `max_price`, `zones jsonb`, `min_rooms`, `property_types jsonb`, `notes`, `created_at`, `updated_at`.
- **RLS:** por `workspace_id`. Habilita el futuro «matching automático lead↔propiedad».

### `properties` · **día 1** · 🟢 código
- **Columnas:** `id uuid pk`, `workspace_id uuid fk`, `client_id uuid (owner/lead, null)`, `title text not null`, `property_type text`, `operation_type text` (venta/alquiler), `status text default 'available'`, `city text`, `area text`, `address text`, `price numeric(12,2)`, `currency text default 'EUR'`, `owner_name text`, `owner_phone text`, `reference text`, `notes text`, `metadata jsonb`, `created_at`, `updated_at`, `deleted_at`.
- **Índices:** `index(workspace_id)`, `index(workspace_id,status)`, `index(workspace_id,operation_type)`.
- **RLS:** por `workspace_id`. **Soft delete:** sí.

### `property_media` · **día 1 (para producto real)** · 🟡
- **Propósito:** fotos/planos de la propiedad (Storage `property-media`).
- **Columnas:** `id`, `workspace_id`, `property_id fk`, `storage_bucket text`, `storage_path text`, `kind text` (photo/plan/doc), `position int`, `is_cover bool`, `mime_type`, `size`, `created_by`, `created_at`.
- **Índices:** `index(workspace_id, property_id, position)`.
- **RLS:** por `workspace_id` + Storage policies (2C).

### `opportunities` · **día 1** · 🟢 código
- **Columnas:** `id uuid pk`, `workspace_id uuid fk`, `client_id uuid`, `property_id uuid` (¡promover desde `metadata.property_id`!), `title text not null`, `vertical text`, `pipeline text`, `stage text`, `value numeric(12,2)`, `probability int`, `currency text default 'EUR'`, `source text`, `assigned_to uuid (profiles)`, `expected_close_date date`, `notes text`, `metadata jsonb`, `created_at`, `updated_at`, `deleted_at`.
- **Índices:** `index(workspace_id)`, `index(workspace_id,stage)`, `index(workspace_id,assigned_to)`, `index(client_id)`, `index(property_id)`.
- **RLS:** por `workspace_id`. **Soft delete:** sí.

### `opportunity_stage_history` · **día 1 (recomendado)** · 🟡
- **Propósito:** trazabilidad de movimientos de etapa (reporting de conversión, tiempo en cada fase).
- **Columnas:** `id`, `workspace_id`, `opportunity_id fk`, `from_stage text`, `to_stage text`, `changed_by uuid`, `changed_at timestamptz default now()`.
- **Índices:** `index(opportunity_id, changed_at)`.
- **RLS:** por `workspace_id`. Lo alimenta el backend al cambiar etapa.

### `service_cases` (expedientes) · **día 1** · 🟢 código
- **Columnas:** `id uuid pk`, `workspace_id uuid fk`, `client_id uuid`, `opportunity_id uuid`, `case_type text`, `vertical text`, `title text not null`, `status text`, `priority text`, `due_date date`, `assigned_to uuid`, `notes text`, `metadata jsonb`, `created_at`, `updated_at`, `deleted_at`.
- **Índices:** `index(workspace_id)`, `index(workspace_id,status)`, `index(opportunity_id)`.
- **RLS:** por `workspace_id`. **Soft delete:** sí.

### `tasks` · **día 1** · 🟢 código
- **Columnas:** `id uuid pk`, `workspace_id uuid fk`, `title text not null`, `status text check (status in ('pending','done')) default 'pending'`, `priority text`, `due_date date`, `client_id uuid`, `client_name text`, `assigned_to uuid`, `metadata jsonb`, `created_at`, `updated_at`.
- **Índices:** `index(workspace_id,status)`, `index(workspace_id,due_date)`, `index(assigned_to)`.
- **RLS:** por `workspace_id`.

### `activities` (timeline) · **día 1** · 🟢 código
- **Columnas:** `id uuid pk`, `workspace_id uuid fk`, `type text`, `title text`, `description text`, `client_id uuid`, `client_name text`, `metadata jsonb` (`source`: 'ui_manual' | 'nowlabs_agent'), `created_by uuid`, `created_at`.
- **Índices:** `index(workspace_id, created_at desc)`, `index(client_id, created_at desc)`.
- **RLS:** por `workspace_id`. (Sin soft delete: es log.)

### `calendar_events` · **día 1** · 🟢 código
- **Columnas:** `id uuid pk`, `workspace_id uuid fk`, `client_id uuid`, `title text not null`, `type text check (type in ('call','demo','meeting','follow-up')) default 'meeting'`, `start_at timestamptz`, `end_at timestamptz`, `date date`, `start_hour int`, `start_minute int`, `duration int`, `client_name text`, `location text`, `description text`, `notes text`, `status text default 'active'`, `google_event_id text`, `google_calendar_id text`, `sync_source text`, `last_synced_at timestamptz`, `is_read_only bool default false`, `metadata jsonb`, `created_at`, `updated_at`.
- **Índices:** `index(workspace_id, start_at)`, `unique(workspace_id, google_event_id) where google_event_id is not null`.
- **RLS:** por `workspace_id`.

---

## Comunicaciones

### `conversations` · **día 1** · 🟢 código
- **Columnas:** `id uuid pk`, `workspace_id uuid fk`, `client_id uuid`, `client_name text`, `channel text`, `assistant_mode text` (`inbox|copilot`, null), `status text`, `sentiment text`, `unread bool default true`, `intent text`, `last_message text`, `last_message_at timestamptz`, `metadata jsonb`, `created_at`, `updated_at`.
- **Índices:** `index(workspace_id, channel)`, `index(workspace_id, last_message_at desc)`, `index(client_id)`.
- **RLS:** por `workspace_id`.

### `messages` · **día 1** · 🟢 código
- ⚠️ **Columnas exactas que el código espera** (`MESSAGE_COLUMNS`): `id uuid pk`, `workspace_id uuid fk`, `conversation_id uuid fk`, `sender text` (`client|agent|ai`), **`body text`**, **`is_ai bool default false`**, `metadata jsonb`, `created_at`.
- **Índices:** `index(conversation_id, created_at)`, `index(workspace_id)`.
- **RLS:** por `workspace_id` (directo) y coherente con la conversación.
- **Nota:** respetar `body`/`is_ai` o adaptar el mapeo del frontend (riesgo señalado en 2A).

### `communication_channels` · futura · 🟡
- **Propósito:** catálogo de canales activos por workspace (whatsapp, email, web…) y su estado.
- Adoptar cuando haya varios canales reales; de momento `conversations.channel` basta.

### `whatsapp_connections` · día 1 (si WhatsApp en alcance) · 🟢 código
- **Columnas (tipo `MetaWhatsAppConnection`):** `id`, `workspace_id fk`, `provider 'meta'`, `meta_business_id`, `whatsapp_business_account_id`, `phone_number_id`, `display_phone_number`, `webhook_verify_token_configured bool`, `connection_status text`, `access_token_encrypted` (**sensible**), `last_webhook_at`, `last_test_at`, `updated_at`.
- **RLS:** por `workspace_id`; **columnas con token NO accesibles vía anon** (solo backend/service_role). Valorar cifrado en columna o secreto fuera de tabla.

---

## Documentos / Storage

> Detalle completo de buckets y paths en [PHASE_2_STORAGE_PLAN.md](PHASE_2_STORAGE_PLAN.md).

### `documents` · **día 1** · 🟢 código
- **Columnas (insert real del código):** `id uuid pk`, `workspace_id uuid fk`, `client_id uuid`, `title text`, `type text check (type in ('client_file','invoice_pdf','proposal_pdf','conversation_attachment','workspace_asset'))`, `storage_bucket text`, `storage_path text`, `mime_type text`, `size bigint`, `created_by uuid`, `metadata jsonb`, `created_at`, `deleted_at`.
- **Índices:** `index(workspace_id, client_id)`, `index(workspace_id, type)`.
- **RLS:** por `workspace_id` + Storage policies por path. **Soft delete:** sí.

### `document_folders` · futura · 🟡
- Carpetas/organización de documentos. Adoptar si el volumen lo pide.

---

## Facturación (core)

> Diseño funcional completo en [PHASE_2_BILLING_DESIGN.md](PHASE_2_BILLING_DESIGN.md). Aquí solo las tablas.

### `invoices` · **día 1** · 🟢 código (ampliado)
- **Columnas:** `id uuid pk`, `workspace_id uuid fk`, `client_id uuid`, `client_name text`, `invoice_number text` (generado, ver `invoice_sequences`), `status text check (status in ('draft','sent','paid','overdue','cancelled')) default 'draft'`, `issue_date date`, `due_date date`, `paid_at timestamptz`, `subtotal numeric(12,2)`, `tax_rate numeric(5,2)`, `tax_amount numeric(12,2)`, `total numeric(12,2)`, `currency text default 'EUR'`, `concept text`, `notes text`, `pdf_document_id uuid (documents)`, `metadata jsonb`, `created_by uuid`, `created_at`, `updated_at`, `deleted_at`.
- **Índices:** `index(workspace_id,status)`, `index(workspace_id,due_date)`, `unique(workspace_id, invoice_number)`.
- **RLS:** por `workspace_id`. **Soft delete:** sí.
- **Nota:** amplía el `invoices` actual (que solo tenía `amount`) a subtotal/IVA/total + estados `draft/sent/cancelled`.

### `invoice_items` · **día 1 (facturación core)** · 🟡 nuevo
- **Columnas:** `id`, `workspace_id`, `invoice_id fk (on delete cascade)`, `description text`, `quantity numeric(10,2) default 1`, `unit_price numeric(12,2)`, `tax_rate numeric(5,2)`, `total numeric(12,2)`, `position int`, `created_at`.
- **RLS:** por `workspace_id`.

### `invoice_sequences` · **día 1** · 🟡 nuevo
- **Propósito:** numeración correlativa sin duplicados por workspace/serie/año.
- **Columnas:** `id`, `workspace_id fk`, `series text default 'FAC'`, `year int`, `prefix text`, `last_number int default 0`. **`unique(workspace_id, series, year)`**.
- **RLS:** por `workspace_id`. La asignación de número se hace en transacción/backend (atómica) para evitar huecos/duplicados.

### `invoice_payments` · futura · 🟡
- **Columnas:** `id`, `workspace_id`, `invoice_id fk`, `amount`, `method text`, `paid_at`, `notes`, `created_by`, `created_at`.
- Adoptar para pagos parciales / histórico. En v1 basta `invoices.paid_at` + `status='paid'`.

### `billing_settings` · **día 1** · 🟡 nuevo
- **Propósito:** datos fiscales y de facturación del workspace.
- **Columnas:** `id`, `workspace_id fk unique`, `legal_name`, `tax_id (NIF/CIF)`, `address`, `default_tax_rate numeric(5,2) default 21`, `invoice_prefix text`, `invoice_footer text`, `logo_path text`, `created_at`, `updated_at`.
- **RLS:** por `workspace_id`.

### `tax_rates` · futura · 🟡
- Catálogo de tipos de IVA (21/10/4/0) por workspace. En v1 basta `default_tax_rate` + `tax_rate` por línea.

---

## Automatizaciones

### `automation_workflows` · día 1 (si n8n en alcance) · 🟢 código
- **Columnas:** `id`, `workspace_id fk`, `name`, `label`, `webhook_url`, `status text` (active/inactive/demo), `source`, `metadata`, `created_at`, `updated_at`.
- **RLS:** por `workspace_id`.

### `automation_rules` · futura · 🟡
- **Propósito:** reglas «si pasa X, haz Y» declarativas.
- **Columnas:** `id`, `workspace_id`, `name`, `trigger text`, `conditions jsonb`, `actions jsonb`, `enabled bool`, `created_at`, `updated_at`.
- **RLS:** por `workspace_id`.

### `automation_runs` · futura · 🟡
- **Propósito:** histórico de ejecuciones de reglas/workflows (auditoría, debug).
- **Columnas:** `id`, `workspace_id`, `rule_id`/`workflow_id`, `status`, `payload jsonb`, `result jsonb`, `started_at`, `finished_at`.
- **RLS:** por `workspace_id`.

### `notifications` · **día 1** · 🟢 código
- **Columnas:** `id`, `workspace_id fk`, `user_id uuid`, `type text`, `title text`, `body text`, `read bool default false`, `metadata jsonb`, `created_at`.
- **Índices:** `index(workspace_id, user_id, read)`.
- **RLS:** el usuario ve sus notificaciones de su workspace.

---

## Asistente IA

> Decisión: las conversaciones del asistente reutilizan `conversations`/`messages` con `assistant_mode` (como hoy), **no** tablas separadas, salvo que se necesite separar histórico. `agent_conversations`/`agent_messages` quedan como 🟡 futura solo si hay motivo.

### `agent_action_logs` · **día 1** · 🟢 código
- **Columnas:** `id`, `workspace_id fk`, `user_id uuid`, `action_type text`, `payload jsonb`, `result jsonb`, `status text`, `created_at`.
- **Índices:** `index(workspace_id, created_at desc)`.
- **RLS:** por `workspace_id`; escritura desde backend.

### `prepared_actions` · **día 1 (para IA real)** · 🟡 nuevo
- **Propósito:** acciones que la IA prepara y el humano confirma (cita, tarea, factura, cambio de etapa). Núcleo de seguridad del asistente.
- **Columnas:** `id`, `workspace_id fk`, `created_by uuid`, `conversation_id uuid`, `action_type text` (`create_task`|`create_event`|`create_invoice`|`update_opportunity`|...), `payload jsonb`, `missing_fields jsonb`, `status text check (status in ('pending','confirmed','executed','cancelled')) default 'pending'`, `executed_at timestamptz`, `result jsonb`, `created_at`, `updated_at`.
- **Índices:** `index(workspace_id, status)`.
- **RLS:** por `workspace_id`. La ejecución (status `executed`) la hace **solo** el backend tras confirmación, validando rol/workspace.

### `tool_execution_logs` · futura · 🟡
- Log fino de cada tool del agente (entrada/salida/tiempos) para auditoría/depuración. Puede fusionarse con `agent_action_logs` en v1.

### `ai_memory` / `ai_context_snapshots` · futura · 🟡
- Memoria/contexto persistente del asistente por workspace/cliente. Solo si se necesita continuidad avanzada. No en v1.

---

## Integraciones

### `integration_settings` (o `integrations`) · día 1 (estado) · 🟢 código
- **Propósito:** estado y config (no secreta) de cada integración por workspace.
- **Columnas:** `id`, `workspace_id fk`, `provider text`, `status text`, `config jsonb` (sin secretos), `created_at`, `updated_at`. **`unique(workspace_id, provider)`**.
- **RLS:** por `workspace_id`.
- **Vistas:** `vw_integrations_status` agrega estado para la UI (mantener).

### `google_calendar_connections` · día 1 (si Google en alcance) · 🟢 código
- **Columnas (tipo `GoogleCalendarConnectionConfig`):** `id`, `workspace_id fk`, `provider 'google_calendar'`, `connection_status text`, `refresh_token_encrypted` (**sensible**), `selected_calendar_ids jsonb`, `calendar_metadata jsonb`, `last_sync_at`, `token_status text`, `updated_at`.
- **RLS:** por `workspace_id`; **tokens solo backend/service_role**. Vista `vw_google_calendar_status` para la UI.

### `meta_whatsapp_connections` → ver `whatsapp_connections` (Comunicaciones). · 🟢 código

### `n8n_webhooks` · futura · 🟡
- Registro de webhooks n8n por workspace (hoy parcialmente en `automation_workflows`). Normalizar si crece.

### `email_connections` · futura · 🟡
- Conexión de email saliente por workspace. Solo cuando email entre en alcance.

### `inbox_agent_settings` · día 1 (si inbox/IA en alcance) · 🟢 código
- Ajustes del agente de inbox por workspace. `id`, `workspace_id`, config jsonb. RLS por `workspace_id`.

### `workspace_templates` · día 1 (si plantillas en alcance) · 🟢 código
- Plantillas del workspace (mensajes, etc.). `id`, `workspace_id`, ... RLS por `workspace_id`.

---

## Resumen de prioridad

**Día 1 (mínimo para producto funcional persistente):**
`workspaces`, `profiles`, `workspace_members`, `vertical_config`, `clients`, `properties`, `opportunities`, `service_cases`, `tasks`, `activities`, `calendar_events`, `conversations`, `messages`, `documents`, `invoices`, `invoice_items`, `invoice_sequences`, `billing_settings`, `notifications`, `agent_action_logs`, `prepared_actions`. Buckets: `client-files`, `property-media`, `invoice-pdfs` (ver 2C).

**Pronto / según alcance:** `property_media`, `opportunity_stage_history`, `whatsapp_connections`, `google_calendar_connections`, `integration_settings`, `inbox_agent_settings`, `automation_workflows`, `workspace_templates`.

**Futura:** `client_contacts`, `client_preferences`, `invoice_payments`, `tax_rates`, `automation_rules`, `automation_runs`, `tool_execution_logs`, `ai_memory`, `document_folders`, `communication_channels`, `n8n_webhooks`, `email_connections`.

---

## RLS — patrón por tabla (resumen; detalle en implementación 2E)

| Grupo | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| Negocio (`clients`, `properties`, `opportunities`, `service_cases`, `tasks`, `calendar_events`, `conversations`, `messages`, `invoices`, `invoice_items`, `documents`, `notifications`, `activities`, `prepared_actions`) | workspace propio | workspace propio (forzar `workspace_id`) | workspace propio | workspace propio (o soft delete) |
| `profiles` | propio + admins del ws | server/onboarding | propio (básico) / admin (rol) | solo `nowlabs_admin` |
| `workspaces` | miembros | server/onboarding | admin/owner | — |
| `workspace_members` | propias / admin ws | admin ws | admin ws | admin ws |
| Tokens (`whatsapp_connections`, `google_calendar_connections`) | estado para miembros; **secretos solo backend** | backend | backend | backend |
| Logs (`agent_action_logs`, `automation_runs`) | admin ws | backend | — | — |

---

## Notas finales de diseño

- **No tocar contratos internos protegidos** al nombrar columnas/roles: `nowlabs_admin` (rol), `runNowLabsAgent`, `NOWCRM_*`, `x-nowcrm-*` se conservan.
- **Demo offline intacta:** el schema no afecta a la ruta demo (gated por `DEMO_MODE_KEY` antes de Supabase). Validar tras conectar.
- **Seed demo** (workspace «Demo Inmobiliaria») coherente con `demo-v1`, en archivos separados de las migraciones (ver 2E-1/2E-2).
