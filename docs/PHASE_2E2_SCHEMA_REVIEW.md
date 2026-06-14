# Fase 2E-2 — Revisión de schema CRM core (PREP, sin aplicar)

**Fecha:** 2026-06-14
**Estado:** PREPARADO, **NO aplicado**. Migraciones versionadas listas para revisar antes de 2E-2 APPLY.
**Conector:** solo `claude.ai Supabase` · proyecto `crm-inmobiliario-demo` (ref `ylhdbawrllqygfvllhdo`).

Anclado en [PHASE_2_CODE_SUPABASE_AUDIT.md](PHASE_2_CODE_SUPABASE_AUDIT.md) (fuente de verdad de columnas) y [PHASE_2_SCHEMA_DESIGN.md](PHASE_2_SCHEMA_DESIGN.md) (diseño). Continúa [PHASE_2E1_REMOTE_APPLY_REPORT.md](PHASE_2E1_REMOTE_APPLY_REPORT.md).

## 1. Objetivo de 2E-2
Crear las **7 tablas operativas core** del CRM inmobiliario sobre el núcleo multi-tenant de 2E-1, con RLS por workspace desde el minuto cero y un seed demo coherente. Convertir la demo offline en producto real, módulo a módulo, sin romper `demo-v1`.

## 2. Estado actual remoto (pre-apply)
- Migraciones aplicadas: `2e1_core_multitenant`, `2e1_seed_demo_workspace`, `2e1_hardening_security_warnings`.
- Tablas públicas: `workspaces`, `profiles`, `workspace_members` (solo núcleo). **Ninguna tabla CRM aún.**
- `workspaces=1` (demo `d0000000-0000-4000-8000-000000000001`), `auth.users=1`, `profiles=1`, `workspace_members=1` (owner vinculado: profile `client_admin` + member `owner`).
- Helpers RLS disponibles: `current_workspace_ids()`, `is_workspace_admin(uuid)`, `current_workspace_role(uuid)` (SECURITY DEFINER, `search_path=''`, ejecutables por `authenticated`).

## 3. Tablas propuestas (alcance 2E-2)
`clients`, `properties`, `opportunities`, `service_cases`, `tasks`, `calendar_events`, `activities`.

Migración: `supabase/migrations/20260614_2e2_core_crm_tables.sql`. Seed: `supabase/migrations/20260614_2e2_seed_real_estate_demo_data.sql`.

Reglas globales aplicadas a todas: `id uuid pk default gen_random_uuid()`, `workspace_id uuid not null → workspaces(id) on delete cascade`, `created_at`, `updated_at` (+trigger `set_updated_at`, salvo `activities`), índices por `workspace_id` y por campos de filtro, RLS activada.

## 4. Campos por tabla
> Leyenda: **(código)** = ya lo usa el frontend/API hoy · **(fwd)** = forward-looking de 2E-2 (nullable aditivo; no rompe el código actual).

### clients (soft delete)
`id, workspace_id, name, company, email, phone, channel [CHECK web|whatsapp|instagram|email|crm], status [CHECK active|lead|inactive|churned, def lead], lead_score int, notes, assigned_to→auth.users (fwd), created_by→auth.users (fwd), metadata jsonb, created_at, updated_at, deleted_at`. Índices: `workspace_id`, `(workspace_id,status)`, `(workspace_id,lower(name))`, `assigned_to`.
> `lastInteraction` y `avatar` del tipo `Client` NO son columnas: se derivan en UI (iniciales / última actividad). Confirmado con el diseño.

### properties (soft delete)
`id, workspace_id, client_id→clients (propietario/lead), title, reference (fwd), property_type, operation_type, status [def available], city, area, address, price numeric(12,2), currency [def EUR], bedrooms int (fwd), bathrooms int (fwd), area_m2 numeric (fwd), owner_name, owner_phone, notes, created_by (fwd), metadata, created_at, updated_at, deleted_at`. Índices: `workspace_id`, `(workspace_id,status)`, `(workspace_id,operation_type)`, `client_id`.

### opportunities (soft delete)
`id, workspace_id, client_id→clients, property_id→properties (promovido desde metadata.property_id), title, vertical, pipeline, stage, status, value numeric(12,2), probability int, currency, source, assigned_to (fwd), expected_close_date date, notes, created_by (fwd), metadata, created_at, updated_at, deleted_at`. Índices: `workspace_id`, `(workspace_id,stage)`, `(workspace_id,assigned_to)`, `client_id`, `property_id`.

### service_cases (soft delete)
`id, workspace_id, client_id→clients, opportunity_id→opportunities, property_id→properties (fwd), case_type, vertical, title, status, priority, due_date date, assigned_to (fwd), notes, created_by (fwd), metadata, created_at, updated_at, deleted_at`. Índices: `workspace_id`, `(workspace_id,status)`, `client_id`, `opportunity_id`.

### tasks
`id, workspace_id, title, status [CHECK pending|done, def pending], priority, due_date, client_id→clients, client_name (denormalizado, código), property_id (fwd), opportunity_id (fwd), case_id (fwd), assigned_to (fwd), created_by (fwd), metadata, created_at, updated_at`. Índices: `(workspace_id,status)`, `(workspace_id,due_date)`, `assigned_to`, `client_id`.

### calendar_events
`id, workspace_id, client_id, property_id (fwd), opportunity_id (fwd), case_id (fwd), title, type [CHECK call|demo|meeting|follow-up, def meeting], start_at, end_at, date, start_hour, start_minute, duration, client_name, location, description, notes, status [def active], google_event_id, google_calendar_id, sync_source, last_synced_at, is_read_only bool, created_by (fwd), metadata, created_at, updated_at`. Índices: `(workspace_id,start_at)`, `client_id`, **unique `(workspace_id, google_event_id)` where not null** (anti-duplicado de sync).

### activities (log; sin soft delete, sin updated_at)
`id, workspace_id, type, title, description, client_id→clients, client_name, entity_type (fwd), entity_id (fwd), created_by (fwd), metadata (source: ui_manual|nowlabs_agent), created_at`. Índices: `(workspace_id, created_at desc)`, `(client_id, created_at desc)`.

## 5. Relaciones
- Todas → `workspaces(id)` ON DELETE CASCADE (aislamiento del tenant).
- `properties.client_id → clients` (SET NULL).
- `opportunities.client_id → clients`, `opportunities.property_id → properties` (SET NULL).
- `service_cases.client_id/opportunity_id/property_id` (SET NULL).
- `tasks.client_id/property_id/opportunity_id/case_id` (SET NULL).
- `calendar_events.client_id/property_id/opportunity_id/case_id` (SET NULL).
- `activities.client_id → clients` (SET NULL); `entity_type/entity_id` = puntero genérico (sin FK).
- `assigned_to` / `created_by → auth.users(id)` (SET NULL). (Semánticamente apuntan a usuarios de app; `profiles.id = auth.users.id`, así que un JOIN a `profiles` sigue funcionando.)

## 6. RLS / policies
Patrón por tabla, usando **solo** los helpers de 2E-1 (SECURITY DEFINER → sin recursión; no se consulta `workspace_members` directamente en ninguna policy):

| Acción | Regla | Roles |
|---|---|---|
| SELECT | `workspace_id IN (current_workspace_ids())` (+ `deleted_at is null` en soft-delete) | todos los miembros (incl. `solo_lectura`) |
| INSERT | `current_workspace_role(workspace_id) IN ('owner','admin','comercial')` | owner/admin/comercial |
| UPDATE | idem (using + with check) | owner/admin/comercial |
| DELETE | `is_workspace_admin(workspace_id)` | owner/admin |

- `activities`: SELECT (miembros) + INSERT (owner/admin/comercial) + DELETE (admin); **sin UPDATE** (es un log inmutable).
- `anon`: sin acceso (no ejecuta los helpers tras el hardening 2E-1H; `current_workspace_ids()` no devuelve nada sin `auth.uid()`).
- `service_role`: bypass de RLS (backend), implícito.
- **Soft delete**: el SELECT filtra `deleted_at is null`; el borrado lógico se hace por UPDATE (`deleted_at = now()`), el borrado físico queda restringido a owner/admin.

## 7. Seed demo
Workspace demo `d0000000-…-0001`, datos ficticios coherentes (espejo de la demo offline): **8 clients, 7 properties, 7 opportunities, 5 service_cases, 10 tasks, 8 calendar_events, 14 activities**. UUIDs fijos por entidad (`d1..`=clients … `d7..`=activities), idempotente (`on conflict (id) do nothing`), emails `@example.com`, teléfonos inventados. Fechas de agenda/actividad relativas a `now()`. `assigned_to`/`created_by` = NULL (no se incrusta el UUID real del owner). **No toca** `auth.users`/`profiles`/`workspace_members`/Storage.

## 8. Módulos frontend que podrá alimentar
- **Dashboard** (KPIs y timeline: clients, opportunities, tasks, calendar_events, activities).
- **Clients** (lista) y **Client detail / ficha 360** (parcial: clients + opportunities + properties + service_cases + tasks + calendar_events + activities; faltarán `conversations`, `documents`, `invoices` → fases posteriores).
- **Opportunities / pipeline** (+ pestañas Propiedades y Expedientes).
- **Calendar** (eventos locales; el sync Google se conecta en runtime, columnas listas).
- **Tasks**, **Activities** (timeline).

## 9. Qué queda fuera y por qué
- **documents** → 2E-3: requiere buckets de Storage + policies por path (`client-files`, `facturas-pdf`, `informes-pdf`), ver [PHASE_2_STORAGE_PLAN.md](PHASE_2_STORAGE_PLAN.md). No tiene sentido la tabla sin los buckets/policies.
- **conversations / messages** → 2E-3: subsistema inbox/IA, con contrato sensible de columnas (`messages.body`/`is_ai`, no `content`/`sender`), atado a WhatsApp/canales. Merece su propia fase.
- **invoices / invoice_items / invoice_sequences / billing_settings** → 2E-4: facturación core con numeración correlativa atómica, IVA, estados ampliados; ver [PHASE_2_BILLING_DESIGN.md](PHASE_2_BILLING_DESIGN.md).
- **notifications, agent_action_logs, prepared_actions, integrations, *_connections, automation_workflows, vertical_config** → fases siguientes (IA, integraciones, automatización).

Criterio: **7 tablas perfectas** > 15 mediocres. Lo diferido tiene dependencias (Storage, numeración, tokens) que exigen diseño propio.

## 10. Riesgos
1. **`messages.body/is_ai`** (no en esta fase, pero anotado): respetar nombres exactos al crear comms en 2E-3.
2. **FK implícita histórica** `opportunities.metadata.property_id`: ahora hay columna real `property_id`; al integrar runtime, migrar lecturas/escrituras de metadata→columna sin romper datos viejos (en el proyecto nuevo no hay datos viejos → bajo riesgo).
3. **`assigned_to`/`created_by` → auth.users**: si el frontend espera join a `profiles`, funciona (id compartido), pero documentarlo.
4. **CHECK vs personalización**: `status`/`channel`/`type` con CHECK fijo (valores que el código ya asume); `stage`/`pipeline`/`case_type`/`property_type`/`operation_type` como texto libre (configurable por vertical). Si un cliente necesita otros valores de `status`/`channel`, requerirá migración del CHECK.
5. **Demo offline**: el schema no afecta a la ruta demo (gated por `DEMO_MODE_KEY` antes de Supabase). Validar tras integrar runtime.
6. **Columnas fwd nullable**: el código actual hace `select('*')`/inserts por columnas → columnas extra nullable no rompen nada; verificar igualmente tras apply.

## 11. Plan de aplicación (2E-2 APPLY)
1. Verificación read-only previa (org/project/ref, migrations = core+seed+hardening, counts núcleo intactos).
2. `apply_migration` `20260614_2e2_core_crm_tables` sobre `ylhdbawrllqygfvllhdo`.
3. `apply_migration` `20260614_2e2_seed_real_estate_demo_data`.
4. (No tocar runtime, Auth, Storage, billing en esa fase.)

## 12. Plan de verificación post-apply
- `list_migrations` incluye las 2 nuevas.
- `list_tables` muestra las 7 tablas con `rls_enabled=true`.
- Por tabla: columnas, FKs, índices, trigger `updated_at`, policies (SELECT/INSERT/UPDATE/DELETE) presentes y sin recursión.
- Seed: counts (8/7/7/5/10/8/14) y coherencia de relaciones (FKs resueltas).
- `get_advisors(security)`: sin ERROR; documentar WARN nuevos (esperable que los helpers sigan con el `0029` aceptado).
- Núcleo intacto: `workspaces=1`, `profiles=1`, `workspace_members=1`, `auth.users=1`.

## 13. Plan de integración runtime futura
Detallado en [PHASE_2E2_RUNTIME_INTEGRATION_PLAN.md](PHASE_2E2_RUNTIME_INTEGRATION_PLAN.md). Resumen: server-first por módulos (clients → properties → opportunities → tasks/calendar → activities → documents/billing/inbox → assistant), manteniendo el cortocircuito demo offline y `demo-v1` intactos.

## 14. Preguntas abiertas
1. **`operation_type`**: ¿fijar CHECK (`venta`/`alquiler`/`traspaso`) o dejar texto libre? (Ahora: texto libre, máxima flexibilidad.)
2. **`assigned_to`/`created_by`**: ¿referenciar `profiles(id)` (exige perfil) o `auth.users(id)` (más laxo)? (Ahora: `auth.users(id)`.)
3. **Soft delete vía RLS**: ¿restringir que `comercial` pueda fijar `deleted_at` (borrado lógico)? (Ahora: `comercial` puede UPDATE; el borrado físico es solo admin. Si se quiere blindar el soft-delete por rol, hace falta lógica extra.)
4. **`vertical_config`**: ¿persistir ya la config de pipelines/case_types (hoy en `vertical-templates.ts` + localStorage) en 2E-2, o esperar a 2E-3? (Ahora: fuera de 2E-2.)
