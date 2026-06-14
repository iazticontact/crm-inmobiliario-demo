# Fase 2E-2 — Revisión de schema CRM core (PREP, sin aplicar)

**Fecha:** 2026-06-14
**Estado:** PREPARADO y **endurecido en 2E-2R**, **NO aplicado**. Migraciones versionadas listas para 2E-2 APPLY (checklist en [PHASE_2E2_APPLY_CHECKLIST.md](PHASE_2E2_APPLY_CHECKLIST.md); verificación en `supabase/manual/20260614_2e2_post_apply_verification.sql`).
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
`id, workspace_id, client_id→clients, property_id→properties (promovido desde metadata.property_id), title, vertical, pipeline, stage, value numeric(12,2), probability int, currency, source, assigned_to (fwd), expected_close_date date, notes, created_by (fwd), metadata, created_at, updated_at, deleted_at`. Índices: `workspace_id`, `(workspace_id,updated_at desc) where deleted_at is null`, `(workspace_id,stage)`, `(workspace_id,assigned_to)`, `client_id`, `property_id`.
> **2E-2R:** se eliminó la columna `status` de opportunities — el contrato (`OpportunityRow`) no la usa; el estado ganado/perdido se modela vía `stage` (`won`/`lost`).

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
| UPDATE (tablas soft-delete) | **dos policies**: `*_update_admin` (owner/admin, sin restricción) **OR** `*_update_comercial` (`role='comercial' AND deleted_at is null` en using+check) | owner/admin libre; comercial solo operativo |
| UPDATE (tasks, calendar_events) | `current_workspace_role(workspace_id) IN ('owner','admin','comercial')` | owner/admin/comercial |
| DELETE | `is_workspace_admin(workspace_id)` | owner/admin |

- **2E-2R — soft delete por rol (Q3):** en `clients`/`properties`/`opportunities`/`service_cases` el UPDATE se parte en dos policies. `comercial` puede editar campos operativos pero su `WITH CHECK` exige `deleted_at is null`, así que **no puede fijar `deleted_at`** (soft-delete) ni tocar filas ya borradas; el soft-delete y el borrado físico quedan para owner/admin. `solo_lectura` no tiene policy de UPDATE → solo SELECT.
- **2E-2R — integridad de asignación (Q2):** trigger `enforce_member_refs` (SECURITY DEFINER, `search_path=''`) valida que `assigned_to` (cuando no es NULL y cambia) sea miembro del workspace, en `clients`/`opportunities`/`service_cases`/`tasks`. No valida `created_by` (procedencia; puede ser ex-miembro). No se dispara con NULL (el seed lo deja NULL).
- `activities`: SELECT (miembros) + INSERT (owner/admin/comercial) + DELETE (admin); **sin UPDATE** (log inmutable).
- `anon`: sin acceso (no ejecuta los helpers tras el hardening 2E-1H; `current_workspace_ids()` no devuelve nada sin `auth.uid()`).
- `service_role`: bypass de RLS (backend), implícito.

## 7. Seed demo
Workspace demo `d0000000-…-0001`, datos ficticios coherentes (espejo de la demo offline): **8 clients, 7 properties, 7 opportunities, 5 service_cases, 10 tasks, 8 calendar_events, 14 activities**. UUIDs fijos por entidad (`d1..`=clients … `d7..`=activities), idempotente (`on conflict (id) do nothing`), emails `@example.com`, teléfonos inventados. Fechas de agenda/actividad relativas a `now()`. `assigned_to`/`created_by` = NULL (no se incrusta el UUID real del owner). **No toca** `auth.users`/`profiles`/`workspace_members`/Storage.
> **2E-2R — vocabulario alineado** al vertical del código (`vertical-templates.ts` / `demo-real-estate.ts`): `opportunities.stage ∈ {new,contacted,qualified,visit_scheduled,offer,negotiation,won,lost}` + `pipeline='real_estate'`; `properties.status ∈ {prospecting,listed,under_contract,sold}` (+ `metadata {rooms,baths,m2}` espejo); `service_cases.status ∈ {open,documentation_pending,in_review}` y `priority ∈ {low,normal,high}`; `tasks.priority ∈ {low,normal,high}`. Así el board de pipeline y los estados renderizan igual que la demo offline.

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

## 14. Preguntas abiertas — RESUELTAS en 2E-2R
1. **`operation_type` (y `property_type`/`stage`/`case_type`/status de negocio) → TEXTO LIBRE (sin CHECK).** El código ya usa valores no estandarizados (defaults en inglés: `sale`/`prospecting`/`apartment`/`new`/`open`/`normal`) y la demo en español/mixto (`venta`/`alquiler`/`listed`/...); además son configurables por vertical. Un CHECK obligaría a migrar por cada personalización. CHECK se mantiene **solo** en lo que el código fija como base de producto: `clients.status`, `clients.channel`, `tasks.status`, `calendar_events.type`.
2. **`assigned_to`/`created_by` → FK a `auth.users` + trigger de pertenencia para `assigned_to`.** Se mantiene la FK a `auth.users` (id compartido con `profiles`). Se añade `enforce_member_refs` (reusable, SECURITY DEFINER, `search_path=''`) que valida que `assigned_to` sea miembro del workspace al insertar o al cambiarlo. `created_by` **no** se valida (es procedencia; validar rompería ediciones si el creador deja el workspace). Implementado en `clients`/`opportunities`/`service_cases`/`tasks`.
3. **Soft delete por `comercial` → bloqueado vía RLS.** UPDATE partido en dos policies (admin libre / comercial con `WITH CHECK deleted_at is null`). `comercial` edita pero no puede fijar `deleted_at` ni hard-delete; owner/admin sí. Sin triggers extra.
4. **`vertical_config` → DIFERIDO (sin tabla).** La parametrización de pipelines/case_types/canales vive en el **catálogo estático** `vertical-templates.ts` (viaja con el código, igual para todos los workspaces, sin migración) y, para overrides por cliente, en **`workspaces.settings` (jsonb)** que ya existe. No se crea tabla hasta que haya necesidad real de personalización persistida por workspace.

## 15. Naming de `opportunities` (decisión 2E-2N)

**Contexto:** "Oportunidades" suena poco natural en un CRM inmobiliario español. El término del dominio es **"Operación"** (compraventa/alquiler). Pero la tabla `opportunities` está embebida en ~331 referencias del código (`vertical-queries.ts`, `vertical-server.ts`, las tools del agente `list_opportunities`/`create_opportunity`/`update_opportunity_stage`, rutas, tipos) → **renombrar la tabla rompería runtime**, lo que está fuera de alcance.

**Decisión final:**
| Capa | Nombre |
|---|---|
| Tabla DB (técnico) | **`opportunities`** (sin cambio; estándar CRM, genérico y verticalizable) |
| Módulo UI (recomendado) | **"Operaciones"** |
| Etiqueta secundaria / tablero | **"Pipeline comercial"** |
| Docs técnicas | `opportunities` (operaciones comerciales) |
| Docs comerciales | "Operaciones / Pipeline comercial" |
| Evitar | "Oportunidades" como título principal visible |

Opciones descartadas: `deals` / `commercial_operations` (rename masivo, riesgo alto, sin ganancia de claridad en ES); **`real_estate_deals` (rompería la verticalización**: la misma tabla sirve a immigration / professional_services / general — ver `IMMIGRATION_PIPELINE`, etc.).

**Estado actual del runtime (inconsistente, a converger en fase RT — NO tocado aquí):**
- Sidebar nav `/opportunities` = **"Gestión"** ([Sidebar.tsx:27](../src/components/Sidebar.tsx#L27)).
- Página: KPI "Seguimientos", sección "Seguimiento comercial", vacíos "Nuevo seguimiento" ([opportunities/page.tsx](../src/app/(saas)/opportunities/page.tsx)).
- Residuales literales "oportunidad/Oportunidad" a sustituir por "operación/Operación": drawers `VerticalForms.tsx` / `VerticalEditForms.tsx` (títulos + toasts), `opportunities/page.tsx:409` (contador de columna), `clients/[id]/page.tsx:736-738` ("Oportunidades vinculadas" / "Sin oportunidades activas"), `inbox/page.tsx:1041`, y los títulos de actividad en `vertical-queries.ts` / `vertical-server.ts` ("Oportunidad creada/editada/→").
- **Recomendación RT:** unificar nav "Gestión" → "Operaciones", sección "Seguimiento comercial" → "Pipeline comercial", y reemplazar los residuales. La tabla y las claves (`stage`, `pipeline`) **no cambian**.

### Mapping visible de `stage` (real_estate; del catálogo `REAL_ESTATE_PIPELINE`)
| `stage` (DB) | Etiqueta visible |
|---|---|
| `new` | Nuevo lead |
| `contacted` | Contactado |
| `qualified` | Cualificado |
| `visit_scheduled` | Visita agendada |
| `offer` | Oferta/propuesta |
| `negotiation` | Negociación |
| `won` | Cerrado ganado |
| `lost` | Cerrado perdido |

`stage` se mantiene **texto libre** (verticalizable): immigration usa `consultation/documentation/in_review/submitted/...`. El seed real_estate usa exactamente los 8 ids de arriba (renderizan en el board). El lado de la operación (compra/venta/alquiler) se expresa con `title` + `properties.operation_type` + (opcional) `metadata.operation_side ∈ {buy,sell,rent}`; **no se añade columna** (no es crítico y el código no la usa).
