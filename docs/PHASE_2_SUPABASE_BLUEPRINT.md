# Fase 2 — Blueprint Supabase nuevo

> ⚠️ **Este documento NO ejecuta nada.** Es el plan para reconstruir la base de datos desde cero cuando se arranque Fase 2.
> Estado de partida: **tag `demo-v1`** → commit `ca04af9`. Demo offline completa y vendible.
> Regla de oro: **no se reutiliza el Supabase antiguo ni el `.env.local` antiguo.** Base de datos nueva, limpia, desde cero.

---

## Objetivo

Crear una **base de datos nueva desde cero** en un proyecto Supabase nuevo para convertir el CRM demo (offline) en un **CRM real multi-tenant** donde cada inmobiliaria tiene sus datos aislados, seguros y persistentes — sin perder el modo demo offline como fallback de venta.

El código de la aplicación **ya está escrito** esperando un conjunto concreto de tablas y columnas (ver inventario en 2A). El trabajo de Fase 2 es **construir el backend que el frontend ya pide**, bien hecho: multi-tenant, con RLS desde el minuto uno, migraciones versionadas y seed coherente con `demo-v1`.

---

## Principios

Estos principios mandan sobre cualquier atajo:

- **Multi-tenant por `workspace_id`.** Cada fila de negocio pertenece a un workspace. Ninguna query cruza workspaces.
- **RLS (Row Level Security) desde el principio.** Activada en todas las tablas de negocio antes de meter un solo dato real. No «la activamos luego».
- **`service_role` solo en backend.** La clave de servicio jamás llega al navegador. Solo la usan rutas server-side controladas.
- **No secrets en el frontend.** El cliente del navegador usa solo la `anon`/`publishable key`. Todo lo sensible vive en el servidor.
- **Datos de cada cliente aislados.** El aislamiento es por RLS + `workspace_id`, no por «confiamos en que la query filtre bien».
- **Seed demo controlado.** Los datos de demo se cargan con un seed reproducible y separado, nunca mezclados con datos reales de clientes.
- **Migraciones versionadas.** Todo cambio de schema es un archivo de migración en git, aplicable en orden, reproducible en cualquier entorno.
- **No depender de nada viejo.** Ni schema antiguo, ni claves antiguas, ni contratos que no entendamos. Lo que migremos del pasado se migra **con plan y revisión**, no por inercia.
- **El modo demo offline sobrevive.** `DEMO_MODE_KEY` (`localStorage['nowcrm-demo-mode']`) sigue funcionando como fallback comercial aunque exista backend real.

---

## Subfase 2A — Auditoría del código actual

**Objetivo:** inventariar exactamente qué espera el frontend antes de diseñar nada. El código es la fuente de verdad de qué tablas y columnas hacen falta.

### Tablas que el código YA consulta (`.from('...')`)

Confirmadas por búsqueda en `src/` (clientes Supabase browser + server + agent tools):

**Núcleo CRM**
- `profiles` — usuario ↔ workspace ↔ rol.
- `workspaces` — el tenant.
- `clients` — contactos / cartera.
- `opportunities` — pipeline comercial (Vertical Pack).
- `service_cases` — expedientes / trámites (Vertical Pack).
- `properties` — cartera de inmuebles (Vertical Pack).
- `calendar_events` — visitas, llamadas, firmas.
- `tasks` — tareas pendientes.
- `activities` — timeline de actividad (UI + agente).
- `invoices` — facturación.
- `documents` — documentos de cliente (+ Storage).

**Conversaciones / Inbox**
- `conversations` — hilos (WhatsApp y otros canales).
- `messages` — mensajes dentro de un hilo.

**Integraciones / config**
- `integrations` — estado de integraciones por workspace.
- `inbox_agent_settings` — ajustes del agente de inbox.
- `whatsapp_connections` — conexión Meta WhatsApp por workspace.
- `automation_workflows` — workflows n8n registrados.
- `workspace_templates` — plantillas del workspace.
- `notifications` — notificaciones in-app.
- `agent_action_logs` — log de acciones del asistente IA.

**Vistas (views) que el código lee**
- `vw_integrations_status` — estado agregado de integraciones.
- `vw_google_calendar_status` — estado de la conexión de Google Calendar.

### Qué auditar para cada tabla (output esperado de 2A)

Antes de escribir el schema nuevo, producir un **inventario** con, por cada tabla:
- **Columnas necesarias** — extraídas de los `.select()`, `.insert()` y `.update()` del código + de los tipos TS (`OpportunityRow`, `ServiceCaseRow`, `PropertyRow` en `src/lib/vertical-queries.ts`; tipos de `src/lib/types.ts`).
- **Relaciones** — claves foráneas implícitas (`client_id`, `opportunity_id`, `workspace_id`, `assigned_to`, etc.).
- **Endpoints/áreas que dependen de ella** — qué rutas API y qué páginas se rompen si la tabla falta.

### Tipos ya definidos en el código (anclaje de columnas)

De `src/lib/vertical-queries.ts` (autoritativo para el Vertical Pack):

- **`OpportunityRow`**: `id, workspace_id, client_id, title, vertical, pipeline, stage, value, probability, currency, source, assigned_to, expected_close_date, notes, metadata(jsonb), created_at, updated_at`.
- **`ServiceCaseRow`**: `id, workspace_id, client_id, opportunity_id, case_type, vertical, title, status, priority, due_date, assigned_to, notes, metadata(jsonb), created_at, updated_at`.
- **`PropertyRow`**: `id, workspace_id, client_id, title, property_type, operation_type, status, city, area, address, price, currency, owner_name, owner_phone, notes, metadata(jsonb), created_at, updated_at`.

De `src/lib/current-user.ts`:
- **`profiles.role`** ∈ `'nowlabs_admin' | 'client_admin' | 'member'` (contrato interno protegido — **conservar los nombres**).
- `profiles` enlaza a `workspace_id`; hoy el modelo es **un profile → un workspace**.

### Endpoints server-side que dependen de Supabase (no romper)

Rutas en `src/app/api/**` que leen/escriben Supabase y que habrá que validar contra el schema nuevo (smoke tests en 2G):
- `assistant/v2`, `assistant/confirm`, `agent/tool` (asistente + tools).
- `reports/invoice`, `reports/client` (PDFs).
- `clients/[id]/documents` (Storage).
- `integrations/google/calendar/*` (Google Calendar real).
- `integrations/meta/whatsapp/*`, `inbox/whatsapp/inbound` (WhatsApp real).
- `n8n/trigger`, `automations/n8n/*` (n8n).
- `team/users`, `team/users/[id]` (gestión de equipo + roles).

> Nota: `docs/supabase/SCHEMA_MAP.md` y los `.sql` antiguos en `docs/supabase/*` existen como **referencia histórica** del schema viejo. NO se reutilizan tal cual (regla «no tocar / no confiar»), pero pueden consultarse en 2A para entender decisiones pasadas. La fuente de verdad para Fase 2 es **el código actual**, no esos SQL.

---

## Subfase 2B — Diseño del schema nuevo

Tablas candidatas. Para cada una: **propósito · columnas principales · relaciones · índices · notas RLS**. (Diseño, no SQL final.)

> Leyenda: 🟢 = ya usada por el código · 🟡 = nueva propuesta (evolución, aún no en el código).

### 🟢 `workspaces` — el tenant
- **Propósito:** representa a una inmobiliaria. Raíz del aislamiento multi-tenant.
- **Columnas:** `id (uuid pk)`, `name`, `slug`, `vertical (default 'real_estate')`, `plan`, `trial_ends_at`, `settings (jsonb)`, `created_at`, `updated_at`.
- **Relaciones:** padre de casi todo vía `workspace_id`.
- **Índices:** `pk(id)`, `unique(slug)`.
- **RLS:** un usuario solo ve su(s) workspace(s) (vía `profiles`/`workspace_members`).

### 🟢 `profiles` — usuario de la app
- **Propósito:** extiende `auth.users` con datos de app y pertenencia a workspace.
- **Columnas:** `id (uuid pk = auth.users.id)`, `workspace_id (fk)`, `full_name`, `email`, `role ('nowlabs_admin'|'client_admin'|'member')`, `avatar_url`, `created_at`, `updated_at`.
- **Relaciones:** `id → auth.users.id`; `workspace_id → workspaces.id`.
- **Índices:** `pk(id)`, `index(workspace_id)`.
- **RLS:** un usuario lee su propio profile; admins leen los de su workspace; `DELETE` solo `nowlabs_admin` (igual que el contrato actual del endpoint `team/users`).

### 🟡 `workspace_members` — membresía N:N (evolución)
- **Propósito:** permitir que un usuario pertenezca a varios workspaces y con rol por workspace. **Hoy el código asume 1 profile → 1 workspace** (`profiles.workspace_id`). Esta tabla es una evolución opcional; si se adopta, hay que adaptar `getResolvedWorkspaceContext` y las queries que leen `profiles.workspace_id`.
- **Columnas:** `id`, `workspace_id (fk)`, `user_id (fk auth.users)`, `role`, `created_at`. **Unique(`workspace_id`,`user_id`)**.
- **RLS:** un usuario ve solo sus filas; admin del workspace gestiona miembros.
- **Decisión Fase 2:** empezar con el modelo simple (`profiles.workspace_id`) para no romper el código, y migrar a `workspace_members` solo si un cliente necesita multi-workspace real. Documentar la decisión antes de tocar queries.

### 🟢 `clients` — cartera de contactos
- **Propósito:** personas/empresas (leads y clientes) de la inmobiliaria.
- **Columnas:** `id`, `workspace_id (fk)`, `name`, `company`, `email`, `phone`, `channel` (whatsapp/web/portal/instagram/referido), `status` (lead/active/…), `lead_score`, `notes`, `metadata (jsonb)`, `created_at`, `updated_at`.
- **Relaciones:** padre de `opportunities`, `properties` (interés), `service_cases`, `invoices`, `documents`, `conversations`, `activities`.
- **Índices:** `pk`, `index(workspace_id)`, `index(workspace_id, status)`.
- **RLS:** aislamiento por `workspace_id`.

### 🟢 `properties` — cartera de inmuebles
- **Propósito:** inmuebles gestionados por la inmobiliaria.
- **Columnas (del tipo `PropertyRow`):** `id`, `workspace_id`, `client_id (owner/lead, nullable)`, `title`, `property_type`, `operation_type` (venta/alquiler), `status` (disponible/reservado/vendido…), `city`, `area`, `address`, `price`, `currency`, `owner_name`, `owner_phone`, `notes`, `metadata (jsonb)`, `created_at`, `updated_at`.
- **Índices:** `pk`, `index(workspace_id)`, `index(workspace_id, status)`.
- **RLS:** por `workspace_id`.

### 🟢 `opportunities` — pipeline comercial
- **Propósito:** operaciones de venta en el embudo.
- **Columnas (del tipo `OpportunityRow`):** `id`, `workspace_id`, `client_id`, `title`, `vertical`, `pipeline`, `stage`, `value`, `probability`, `currency`, `source`, `assigned_to (fk profiles)`, `expected_close_date`, `notes`, `metadata (jsonb)`, `created_at`, `updated_at`.
- **Relaciones:** `client_id → clients`; `assigned_to → profiles`; referenciada por `service_cases.opportunity_id` y por `metadata.property_id`.
- **Índices:** `pk`, `index(workspace_id)`, `index(workspace_id, stage)`, `index(workspace_id, assigned_to)`.
- **RLS:** por `workspace_id`.

### 🟢 `service_cases` — expedientes / trámites
- **Propósito:** gestión documental y de trámites (venta, hipoteca, tasación).
- **Columnas (del tipo `ServiceCaseRow`):** `id`, `workspace_id`, `client_id`, `opportunity_id`, `case_type`, `vertical`, `title`, `status`, `priority`, `due_date`, `assigned_to`, `notes`, `metadata (jsonb)`, `created_at`, `updated_at`.
- **Índices:** `pk`, `index(workspace_id)`, `index(workspace_id, status)`, `index(opportunity_id)`.
- **RLS:** por `workspace_id`.

### 🟢 `calendar_events` — agenda
- **Propósito:** visitas, llamadas, reuniones, firmas. Base de la sincronización con Google Calendar.
- **Columnas:** `id`, `workspace_id`, `client_id (nullable)`, `title`, `type` (demo/call/meeting/follow-up), `start_at`, `end_at`, `start_hour`, `start_minute`, `duration`, `date`, `description`, `client_name`, `status` (active/cancelled), `google_event_id`, `google_calendar_id`, `sync_source`, `is_read_only`, `metadata (jsonb)`, `created_at`, `updated_at`.
- **Relaciones:** `client_id → clients`; unicidad por `google_event_id` para evitar duplicados de sync.
- **Índices:** `pk`, `index(workspace_id, start_at)`, `unique(workspace_id, google_event_id)` (parcial, donde no nulo).
- **RLS:** por `workspace_id`. Eventos de Google de solo lectura marcados con `is_read_only`.

### 🟢 `tasks` — tareas
- **Propósito:** to-dos del equipo (llamadas, follow-ups).
- **Columnas:** `id`, `workspace_id`, `title`, `status` (pending/done), `priority`, `due_date`, `client_id`, `client_name`, `assigned_to`, `metadata (jsonb)`, `created_at`, `updated_at`.
- **Índices:** `pk`, `index(workspace_id, status)`, `index(workspace_id, due_date)`.
- **RLS:** por `workspace_id`.

### 🟢 `activities` — timeline
- **Propósito:** registro cronológico de lo que pasa (acciones de UI y del agente). `metadata.source` distingue `'ui_manual'` vs `'nowlabs_agent'`.
- **Columnas:** `id`, `workspace_id`, `type` (message/call/note/…), `title`, `description`, `client_id`, `client_name`, `metadata (jsonb)`, `created_at`.
- **Índices:** `pk`, `index(workspace_id, created_at desc)`, `index(client_id)`.
- **RLS:** por `workspace_id`.

### 🟢 `conversations` — hilos de mensajería
- **Propósito:** conversaciones (WhatsApp y otros canales), también las del asistente.
- **Columnas:** `id`, `workspace_id`, `client_id`, `client_name`, `channel` (whatsapp/…), `assistant_mode` (inbox/copilot, nullable), `status`, `last_message`, `last_message_at`, `lead_score`, `metadata (jsonb)`, `created_at`, `updated_at`.
- **Índices:** `pk`, `index(workspace_id, channel)`, `index(workspace_id, last_message_at desc)`.
- **RLS:** por `workspace_id`.

### 🟢 `messages` — mensajes
- **Propósito:** mensajes individuales dentro de una `conversation`.
- **Columnas:** `id`, `conversation_id (fk)`, `workspace_id`, `content`, `sender` (client/agent/ai), `timestamp`, `metadata (jsonb)`, `created_at`.
- **Índices:** `pk`, `index(conversation_id, created_at)`.
- **RLS:** por `workspace_id` (vía conversation o columna directa).

### 🟢 `invoices` — facturación
- **Propósito:** facturas/honorarios.
- **Columnas:** `id`, `workspace_id`, `invoice_number`, `client_id`, `client_name`, `concept/plan`, `amount`, `currency`, `status` (paid/pending/overdue), `issue_date/date`, `due_date`, `notes`, `metadata (jsonb)`, `created_at`, `updated_at`.
- **Índices:** `pk`, `index(workspace_id, status)`, `index(workspace_id, due_date)`.
- **RLS:** por `workspace_id`.

### 🟡 `invoice_items` — líneas de factura (evolución)
- **Propósito:** desglose por concepto. Hoy el código trata la factura como importe único; esta tabla es para facturación más rica.
- **Columnas:** `id`, `invoice_id (fk)`, `workspace_id`, `description`, `quantity`, `unit_price`, `total`, `created_at`.
- **RLS:** por `workspace_id`. Adoptar solo si se necesita facturación detallada.

### 🟢 `documents` — documentos de cliente
- **Propósito:** archivos asociados a un cliente (+ Supabase Storage).
- **Columnas:** `id`, `workspace_id`, `client_id`, `title`, `storage_path`, `mime_type`, `size`, `uploaded_by`, `metadata (jsonb)`, `created_at`.
- **Relaciones:** `client_id → clients`; `storage_path → bucket`.
- **Índices:** `pk`, `index(workspace_id, client_id)`.
- **RLS:** por `workspace_id` + storage policies por path `workspace_id/...`.

### 🟢 `automation_workflows` — workflows n8n
- **Propósito:** registro de workflows n8n vinculados al workspace.
- **Columnas:** `id`, `workspace_id`, `name`, `label`, `webhook_url`, `status` (active/inactive/demo), `source`, `metadata (jsonb)`, `created_at`, `updated_at`.
- **RLS:** por `workspace_id`.

### 🟡 `automation_rules` — reglas de automatización (evolución)
- **Propósito:** reglas declarativas «cuando pasa X, haz Y» (más allá de registrar workflows n8n). Nueva.
- **Columnas:** `id`, `workspace_id`, `trigger`, `conditions (jsonb)`, `actions (jsonb)`, `enabled`, `created_at`, `updated_at`.
- **RLS:** por `workspace_id`. Adoptar cuando se construya el motor de reglas.

### 🟢 `integrations` + `inbox_agent_settings` + `whatsapp_connections`
- **Propósito:** configuración de integraciones por workspace (estado, credenciales no sensibles, ajustes del agente de inbox, conexión de WhatsApp).
- **Columnas clave:** `workspace_id`, `provider/type`, `status`, `config (jsonb)`, tokens **solo** los que deban vivir server-side (idealmente cifrados o en vault, no en texto plano accesible al cliente).
- **Vistas:** `vw_integrations_status` y `vw_google_calendar_status` agregan estado para la UI.
- **RLS:** por `workspace_id`. **Tokens sensibles nunca expuestos vía `anon key`** — leer solo desde backend con `service_role`.

### 🟡 `integration_settings` — ajustes finos de integración (evolución)
- Posible normalización de `integrations.config`. Decidir si hace falta o si `jsonb` basta.

### 🟢 `agent_action_logs` — auditoría del asistente IA
- **Propósito:** registrar cada acción que el asistente prepara/ejecuta, para auditoría y seguridad.
- **Columnas:** `id`, `workspace_id`, `user_id`, `action_type`, `payload (jsonb)`, `result`, `status`, `created_at`.
- **Índices:** `pk`, `index(workspace_id, created_at desc)`.
- **RLS:** por `workspace_id`; escritura desde backend.

### 🟢 `notifications` — notificaciones in-app
- **Columnas:** `id`, `workspace_id`, `user_id`, `type`, `title`, `body`, `read`, `created_at`.
- **RLS:** el usuario ve sus notificaciones de su workspace.

### 🟡 `vertical_config` — configuración por vertical (evolución)
- **Propósito:** persistir la configuración de vertical (pipelines, tipos de expediente, campos) que hoy vive en `src/lib/demo/vertical-templates.ts` y `localStorage` (`nowcrm.workspaceVertical`).
- **Columnas:** `id`, `workspace_id`, `vertical`, `pipeline_config (jsonb)`, `case_types (jsonb)`, `field_config (jsonb)`, `created_at`, `updated_at`.
- **RLS:** por `workspace_id`.

---

## Subfase 2C — Migraciones SQL

Plan de construcción (cada paso = una migración versionada en git, p. ej. `supabase/migrations/`):

1. **Extensiones** — `pgcrypto`/`uuid-ossp` para `gen_random_uuid()`.
2. **Enums** (si conviene): `profile_role`, `opportunity_stage`, `case_status`, `invoice_status`, `event_type`, `conversation_channel`, `message_sender`. *Decisión:* enums dan integridad pero son rígidos para personalización por cliente; alternativa = `text` + `CHECK`. Recomendado: `text + CHECK` para campos que el cliente personaliza (stage, case_type), enums solo para los verdaderamente fijos (sender).
3. **Tablas base sin FKs cruzadas** — `workspaces`, luego `profiles`.
4. **Tablas de negocio** — `clients`, `properties`, `opportunities`, `service_cases`, `calendar_events`, `tasks`, `activities`, `conversations`, `messages`, `invoices`, `documents`.
5. **Tablas de integración/config** — `integrations`, `inbox_agent_settings`, `whatsapp_connections`, `automation_workflows`, `notifications`, `agent_action_logs`, `workspace_templates`.
6. **Constraints y FKs** — claves foráneas con `ON DELETE` pensado (p. ej. `SET NULL` en `assigned_to`, `CASCADE` en `messages → conversations`).
7. **Índices** — los listados en 2B (siempre incluir `workspace_id` en los compuestos).
8. **Triggers `updated_at`** — función `set_updated_at()` + trigger por tabla.
9. **Vistas** — `vw_integrations_status`, `vw_google_calendar_status`.
10. **Storage buckets** — `client-files` (documentos), `facturas-pdf` (PDFs). Con sus policies (2D).
11. **Seeds separados** — el seed demo (2E) va en archivos **aparte** de las migraciones de schema, nunca mezclado.

> Regla: las migraciones describen **estructura**; los seeds describen **datos**. Nunca mezclar. El schema debe poder aplicarse a una BD que tendrá datos reales de cliente, sin arrastrar datos de demo.

---

## Subfase 2D — RLS y policies

Plan por tabla. **RLS activada en TODAS las tablas de negocio.** Patrón base:

- **Helper de workspace:** una función `current_workspace_ids()` que devuelva los workspace(s) del usuario autenticado (vía `profiles.workspace_id` hoy; vía `workspace_members` si se evoluciona). Las policies la usan en vez de repetir subqueries.

**Por tipo de tabla:**
- **Tablas de negocio** (`clients`, `properties`, `opportunities`, `service_cases`, `calendar_events`, `tasks`, `activities`, `conversations`, `messages`, `invoices`, `documents`, `notifications`):
  - `SELECT/INSERT/UPDATE/DELETE` permitido solo si `workspace_id IN current_workspace_ids()`.
  - `INSERT`: forzar que `workspace_id` sea uno de los del usuario (no puede insertar en otro workspace).
- **`profiles`:**
  - `SELECT`: el propio usuario + admins (`client_admin`/`nowlabs_admin`) de su workspace.
  - `UPDATE`: el propio usuario (datos básicos); cambios de rol y de otros perfiles solo admin (refleja el contrato actual de `team/users`).
  - `DELETE`: solo `nowlabs_admin`.
- **`workspaces`:** `SELECT` los miembros; `UPDATE` admins.
- **Integraciones / tokens** (`integrations`, `whatsapp_connections`, `inbox_agent_settings`): `SELECT` de estado para miembros; **lectura de campos con tokens/secretos solo backend con `service_role`** (no exponer columnas sensibles vía `anon`). Considerar columnas separadas o vista «pública» sin secretos.
- **`agent_action_logs`:** `SELECT` para admins del workspace; `INSERT` desde backend.
- **Storage policies** (buckets `client-files`, `facturas-pdf`):
  - Path convencional `:workspace_id/...`. Policy: el usuario solo accede a objetos cuyo primer segmento de path esté en `current_workspace_ids()`.
  - Subida/borrado: miembros del workspace; lectura: miembros.
- **Rutas server-only:** los endpoints que usan `service_role` (`agent/tool`, parte de `assistant/*`, sync de calendar/whatsapp) **bypassean RLS a propósito** — por eso deben validar `workspace_id` ellos mismos antes de escribir (como ya hace `reports/invoice` derivando el workspace de la sesión, nunca del body).

---

## Subfase 2E — Seed demo inmobiliario

**Objetivo:** un seed reproducible que cargue una inmobiliaria de ejemplo **coherente con `demo-v1`**, para entornos de demo/staging (no para producción de cliente).

Contenido del seed (espejo de los datos offline en `src/lib/demo/demo-real-estate.ts` + `src/lib/mock-data.ts`):
- **1 workspace demo** — «Demo Inmobiliaria» (`vertical='real_estate'`).
- **1 usuario demo/admin** — profile con rol `client_admin` ligado al workspace demo.
- **Clientes** — Lucía Herrera, Marcos Beltrán, Familia Soler, Roberto Díaz, Marta Vidal, Inversiones Atlántico SL, Pablo Ferrer, Carmen Lozano…
- **Propiedades** — la cartera de `demoProperties` (piso Calle Mayor, ático Plaza España, chalet Los Robles, etc.) con estados variados.
- **Oportunidades** — pipeline completo (`op1`–`op8`): de lead nuevo a ganado, cubriendo todas las etapas.
- **Visitas / `calendar_events`** — visitas y firmas de esta semana (fechas **relativas a hoy**, como el helper `demo-dates.ts`).
- **Tareas** — to-dos pendientes (llamar a Pablo, preparar visita de Lucía…).
- **Conversaciones + mensajes** — hilos de WhatsApp de ejemplo.
- **Expedientes / `service_cases`** — documentación de venta, hipoteca, tasación.
- **Facturas** — pagadas/pendientes/vencidas coherentes.
- **Documentos ficticios** — entradas de `documents` (con archivos de muestra en Storage, o solo metadatos).
- **Actividades** — timeline poblado.

Reglas del seed:
- **Idempotente** — poder re-ejecutarlo sin duplicar (upsert por id estable, p. ej. ids `op1`, `pr1` como en la demo).
- **Aislado** — todo bajo el `workspace_id` demo; jamás se mezcla con workspaces reales.
- **Fechas relativas** — calcular fechas en función de `now()` para que el seed nunca «envejezca» (igual filosofía que `demo-dates.ts`).
- **Separado de las migraciones** — archivo(s) de seed aparte, ejecutables a voluntad.

---

## Subfase 2F — Conexión `.env.local` nueva

**Reglas estrictas:**
- ❌ **No copiar el `.env.local` antiguo** ni `.env.local.backup_antiguo`. Nada del proyecto Supabase viejo.
- ✅ **Crear un `.env.local` nuevo** partiendo de [`.env.example`](../.env.example).
- ✅ Usar la **`anon`/publishable key NUEVA** del proyecto Supabase nuevo en `NEXT_PUBLIC_SUPABASE_*`.
- ✅ `SUPABASE_SERVICE_ROLE_KEY` **solo** en variables de servidor (Vercel server env / local server). Nunca con prefijo `NEXT_PUBLIC_`, nunca en el cliente.
- ✅ Guardar todos los secrets en un **gestor de secretos / vault** (Proton Pass, etc.), **no en el chat, no en git, no en capturas**.
- ✅ Generar los secretos propios (`AGENT_TOOL_SECRET`, `N8N_WEBHOOK_SECRET`, `NOWCRM_WEBHOOK_SECRET`) nuevos con `openssl rand -base64 48`. Los nombres de variable legacy (`NOWCRM_*`, `NOWLABS_MODEL`) se **conservan** (contratos internos protegidos); solo cambian sus **valores**.
- ✅ Variables opcionales (OpenAI, Meta, n8n, Google) se rellenan **solo cuando se integre cada cosa**; sin ellas, el módulo correspondiente degrada a «pendiente de configuración».

---

## Subfase 2G — Smoke tests por módulo

Tras aplicar schema + RLS + seed, validar cada módulo antes de dar nada por bueno:

- **Login** — un usuario real (no demo) entra y `AuthGate` lo deja pasar; sin profile → redirige a `/login?error=no_profile`.
- **Dashboard** — carga KPIs/agenda/tareas desde datos reales del workspace (no mock).
- **Clients CRUD** — crear, editar, borrar cliente; aparece en el listado y persiste tras refrescar.
- **Client detail (Ficha 360)** — carga oportunidades, propiedades, actividad, conversaciones, facturas, visitas del cliente; guardar notas persiste; subir documento va a Storage.
- **Opportunities** — listar y mover de etapa persiste (`updateOpportunityStage`).
- **Properties** — listar y cambiar estado persiste.
- **Service cases** — listar y cambiar estado persiste.
- **Calendar** — crear/editar/cancelar evento persiste; (con Google conectado) sincroniza.
- **Assistant (read-only tools)** — el asistente lee datos reales del workspace y prepara acciones; nada se ejecuta sin confirmación.
- **Documents / Invoices** — subir documento, generar PDF de factura (footer ya neutralizado a `BRAND.appName`).
- **RLS isolation (crítico)** — con dos workspaces y dos usuarios: el usuario A **no** puede leer ni escribir datos del workspace B por ninguna vía (browser client). Probar explícitamente que una query cruzada devuelve vacío/403.

---

## Subfase 2H — Asistente IA con tools reales

Plan para pasar del asistente «de muestra» (demo) al asistente real:

- **Read tools por workspace** — herramientas de solo-lectura (`listClients`, `getClient`, `listOpportunities`, `listCalendarEvents`, `listInvoices`…) que **siempre** filtran por el `workspace_id` de la sesión. (El esqueleto ya existe en `src/lib/assistant-tools.ts` y `agent-tool-readers.ts`.)
- **Prepared actions** — el asistente **prepara** una acción (cita, propuesta, tarea, factura) y la devuelve como borrador con campos faltantes, **sin ejecutarla**.
- **Confirm actions** — la ejecución pasa por `/api/assistant/confirm`, que valida permisos y workspace **server-side** antes de escribir. Humano en el bucle.
- **No `if/else` bot** — el cerebro es el modelo (OpenAI) razonando sobre las tools, no una cascada de condicionales. La demo usa respuestas deterministas de muestra; lo real usa el modelo + tools.
- **OpenAI + Supabase tools** — el modelo recibe las tools, consulta Supabase con permisos del workspace, y propone. Configurar `OPENAI_API_KEY` (y modelo vía `OPENAI_MODEL`/`NOWLABS_MODEL`).
- **Logging `agent_action_logs`** — registrar cada preparación/ejecución para auditoría.
- **Seguridad de ejecución** — las escrituras del agente nunca se hacen con permisos del cliente del navegador; van por rutas server con `service_role` que **validan workspace y rol** antes de actuar. Mantener el contrato interno `runNowLabsAgent` / `nowlabs_agent` (protegido).

---

## Subfase 2I — Integraciones externas

Plan futuro (cada una, su propia mini-fase; ninguna bloquea el CRM base):

- **n8n** — brazo de automatización **opcional**. Registrar workflows en `automation_workflows`; disparar vía `/api/n8n/trigger` con `x-nowcrm-secret`. **n8n NO es el cerebro del asistente** (el cerebro es OpenAI + tools server-side); n8n ejecuta automatizaciones externas.
- **Meta WhatsApp** — Cloud API oficial. Inbound por webhook (`/api/inbox/whatsapp/inbound`, valida `x-nowcrm-webhook-secret`/`NOWCRM_WEBHOOK_SECRET`); outbound con `META_WHATSAPP_ACCESS_TOKEN`. Conexión por workspace en `whatsapp_connections`.
- **Google Calendar** — OAuth ya implementado en `integrations/google/calendar/*`. Sincroniza `calendar_events` ↔ Google. Requiere `GOOGLE_CLIENT_ID/SECRET/REDIRECT_URI`.
- **Email** — notificaciones/avisos (proveedor a decidir). Opcional.
- **Webhooks** — entradas/salidas para integraciones a medida del cliente.

Principio transversal: cada integración **degrada con elegancia** si no está configurada (estado «pendiente»), nunca rompe el CRM.

---

## Riesgos

- **Romper la demo offline.** Al conectar Supabase, asegurarse de que `DEMO_MODE_KEY` sigue cortocircuitando **antes** de cualquier llamada a Supabase (como hoy en `AuthGate`/`current-user`). El modo demo debe sobrevivir intacto.
- **Mezclar datos viejos.** No importar datos del Supabase antiguo «porque estaban ahí». Migrar solo con plan, mapeo de columnas y revisión.
- **Exponer `service_role`.** El mayor riesgo de seguridad. Nunca en el cliente, nunca con prefijo `NEXT_PUBLIC_`, nunca en capturas/chat. Una fuga = acceso total saltándose RLS.
- **RLS incompleta.** Una tabla sin RLS o con una policy floja = fuga entre clientes. Activar RLS en **todas** las tablas de negocio y probar el aislamiento explícitamente (2G).
- **Hardcodear `workspace_id`.** Jamás fijar un workspace en código. Siempre derivarlo de la sesión autenticada.
- **Migrar contratos antiguos sin plan.** Los nombres internos protegidos (`NOWCRM_*`, `NOWLABS_*`, `x-nowcrm-*`, `runNowLabsAgent`, `nowlabs_admin`) se **conservan**; cambiar uno por error rompe webhooks/roles. Tocarlos solo con plan explícito.
- **Olvidar los `metadata.property_id` y FKs implícitas.** Algunas relaciones viven en `jsonb` (p. ej. `opportunities.metadata.property_id`). Documentarlas para no perderlas en el rediseño.

---

## Prompt de arranque para Fase 2

> Cópialo tal cual cuando quieras empezar Fase 2 con Supabase MCP. Está pensado para frenar la prisa: **primero auditar y diseñar, luego ejecutar.**

```
FASE 2 — Arranque Supabase (auditoría y diseño primero, sin ejecutar SQL)

Modelo: Opus 4.8 Ultra Code. Effort: máximo.
Modo: auditoría + diseño. NO ejecutar SQL ni migraciones todavía.

Contexto: CRM Inmobiliario Demo, tag demo-v1 (commit ca04af9), demo offline
vendible. Vamos a construir el backend real desde cero en un Supabase NUEVO.
No se reutiliza el Supabase antiguo ni el .env.local antiguo.

Lee primero: docs/PHASE_2_SUPABASE_BLUEPRINT.md (este es el plan maestro).

ANTES de conectar Supabase MCP o tocar nada:
1. Audita el código (Subfase 2A): confirma el inventario de tablas/columnas
   que el frontend espera, leyendo src/lib/supabase-queries.ts,
   src/lib/vertical-queries.ts, src/lib/assistant-tools.ts,
   src/lib/agent-tool-readers.ts, src/lib/types.ts y las rutas src/app/api/**.
2. Diseña el schema nuevo (Subfase 2B): tablas, columnas, relaciones, índices,
   notas RLS. Multi-tenant por workspace_id, RLS desde el inicio.
3. Propón el plan de migraciones (2C) y de RLS (2D) por escrito.
4. NO ejecutes SQL todavía. NO crees el proyecto Supabase todavía. NO toques
   .env.local. Preséntame el diseño para revisión.

Reglas duras: no exponer service_role; RLS en todas las tablas de negocio;
no romper el modo demo offline (DEMO_MODE_KEY); conservar contratos internos
protegidos (NOWCRM_*, NOWLABS_*, x-nowcrm-*, runNowLabsAgent, nowlabs_admin);
no force push; no deploy.

Cuando apruebe el diseño, pasamos a ejecutar migraciones paso a paso.
```
