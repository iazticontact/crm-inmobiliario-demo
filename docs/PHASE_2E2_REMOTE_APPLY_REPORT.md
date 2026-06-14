# Fase 2E-2 — Informe de aplicación remota (CRM core + seed)

**Fecha de aplicación:** 2026-06-14
**Conector:** `claude.ai Supabase` (cloud, read/write vía MCP). No se usó MCP local, n8n ni GitHub.

> Documento de estado post-apply. No contiene secretos, contraseñas ni API keys.

## 1. Resumen ejecutivo
Las 7 tablas operativas del CRM inmobiliario (2E-2) y su seed demo quedaron **aplicadas correctamente** sobre el proyecto Supabase nuevo. RLS, policies, triggers e índices verificados; seed coherente dentro del workspace demo; núcleo 2E-1 intacto; sin ERRORES en los advisors de seguridad. No se tocó runtime, env, Storage, Auth ni integraciones.

## 2. Proyecto Supabase
| Campo | Valor |
|---|---|
| Organization | `Demos Inmobiliarias Workspace` |
| Organization id | `ayaibwutgawwfhlvmfmb` |
| Project | `crm-inmobiliario-demo` |
| Ref | `ylhdbawrllqygfvllhdo` |
| Region | `eu-west-1` |
| Status | `ACTIVE_HEALTHY` |

## 3. Estado Git en el momento del apply
Branch `main`, HEAD `1b22166 chore(supabase): polish 2e2 crm naming before apply`. Tag `demo-v1` → `ca04af9` intacto. Las migraciones 2E-2 se aplican desde los archivos versionados en `supabase/migrations/`.

## 4. Migraciones aplicadas (orden)
| # | Nombre | Version remota | Resultado |
|---|---|---|---|
| 1 | `20260613_2e1_core_multitenant` | `20260614143939` | (2E-1, previa) |
| 2 | `20260613_2e1_seed_demo_workspace` | `20260614144059` | (2E-1, previa) |
| 3 | `20260614_2e1_hardening_security_warnings` | `20260614144931` | (2E-1H, previa) |
| 4 | **`20260614_2e2_core_crm_tables`** | **`20260614172930`** | **success** |
| 5 | **`20260614_2e2_seed_real_estate_demo_data`** | **`20260614173117`** | **success** |

## 5. Tablas CRM creadas
`clients`, `properties`, `opportunities`, `service_cases`, `tasks`, `calendar_events`, `activities`. Todas con `workspace_id NOT NULL → workspaces(id) on delete cascade`, `created_at`, `updated_at` (salvo `activities`, que es log sin `updated_at`), y RLS habilitada.

## 6. RLS / policies por tabla (verificado)
| Tabla | RLS | Nº policies | Esquema |
|---|---|---|---|
| clients | ✅ | 5 | select / insert / update_admin / update_comercial / delete |
| properties | ✅ | 5 | idem |
| opportunities | ✅ | 5 | idem |
| service_cases | ✅ | 5 | idem |
| tasks | ✅ | 4 | select / insert / update / delete |
| calendar_events | ✅ | 4 | idem |
| activities | ✅ | 3 | select / insert / delete (sin update) |

Modelo: SELECT = miembros del workspace (`current_workspace_ids()`); INSERT/UPDATE = owner/admin/comercial; en tablas con soft-delete el UPDATE se parte (admin libre / comercial sin poder fijar `deleted_at`); DELETE = owner/admin. anon sin acceso. Sin recursión (helpers SECURITY DEFINER de 2E-1).

## 7. Triggers / functions
- `set_updated_at` (de 2E-1) en triggers `trg_*_updated` de clients/properties/opportunities/service_cases/tasks/calendar_events.
- **`enforce_member_refs`** (nueva, SECURITY DEFINER, `search_path=''`, sin EXECUTE para anon): triggers `trg_*_member_refs` (BEFORE INSERT OR UPDATE) en clients/opportunities/service_cases/tasks — valida que `assigned_to` (no nulo y cambiante) sea miembro del workspace.

## 8. Índices principales
Por tabla: `workspace_id`; parciales `(workspace_id, updated_at desc) where deleted_at is null` en las 4 soft-delete; filtros `(workspace_id, status|stage|operation_type)`, `due_date`, `(workspace_id, start_at)`; FKs (`client_id`/`property_id`/`opportunity_id`/`assigned_to`); unique `(workspace_id, google_event_id) where not null`; `activities (workspace_id, created_at desc)` y `(client_id, created_at desc)`.

## 9. Seed demo
Workspace `d0000000-0000-4000-8000-000000000001`. Counts: **clients 8 · properties 7 · opportunities 7 · service_cases 5 · tasks 10 · calendar_events 8 · activities 14**. Datos ficticios y coherentes (espejo de la demo offline), UUIDs fijos (`d1..`–`d7..`), idempotente (`on conflict do nothing`), emails `@example.com`, teléfonos inventados, fechas relativas a `now()`, `assigned_to`/`created_by` = NULL. Vocabulario alineado al vertical (`stage` real_estate, `status` de propiedad, `priority` low/normal/high).

## 10. Verificación (read-only post-apply)
- ✅ Las 7 tablas con `rls_enabled = true`.
- ✅ Counts seed exactos (8/7/7/5/10/8/14).
- ✅ **0 filas fuera del workspace demo.**
- ✅ **0 relaciones huérfanas.**
- ✅ **0 valores fuera de vocabulario** (stage/status/priority).
- ✅ Núcleo 2E-1 intacto: workspaces=1, auth.users=1, profiles=1, workspace_members=1; owner = profile `client_admin` + member `owner`.
- ✅ `enforce_member_refs`: `security_definer=true`, `search_path=''`.

## 11. Advisors
- **Security:** sin ERROR. WARN existentes: 3× `0029 authenticated_security_definer_function_executable` (helpers `current_workspace_ids`/`current_workspace_role`/`is_workspace_admin`) — **aceptados por diseño** (las RLS policies los invocan como `authenticated`; filtran por `auth.uid()`).
- **WARN ajeno a 2E-2:** `auth_leaked_password_protection` (protección de contraseñas filtradas deshabilitada). No depende de estas migraciones. **Opcional:** activar en Supabase Dashboard → Authentication → Password protection (HaveIBeenPwned). No se tocó por SQL (no se toca Auth).
- **Performance:** no se detectaron problemas críticos tras el apply (tablas vacías/seed pequeño; índices ya creados para los patrones de query reales).

## 12. Lo que NO se tocó
`.env.local` · `.env.local.backup_antiguo` · secretos · API keys · Auth users (0 cambios) · Storage · runtime `src/*` · n8n · proyectos legacy. No deploy.

## 13. Riesgos pendientes
- ⚠️ **`.env.local` apunta aún a un proyecto legacy** (`ktsgfukjgldeylfzrayr`, costadelsol). Hasta actualizarlo al ref nuevo (manual, en RT1), una sesión "real" NO conectaría a este Supabase. Mientras tanto, la demo offline sigue funcionando.
- WARN residual `0029` (aceptado) y `auth_leaked_password_protection` (opcional, dashboard).
- Columnas forward-looking nullable aún no leídas por el código (sin impacto hasta RT).

## 14. Decisión de naming
- DB (técnico): **`opportunities`** (sin cambio).
- UI: **"Operaciones" / "Pipeline comercial"** (evitar "Oportunidades"). Ver sección Naming en [PHASE_2E2_SCHEMA_REVIEW.md](PHASE_2E2_SCHEMA_REVIEW.md).

## 15. Siguiente fase recomendada
**FASE 2E-2RT1** — integración runtime read-only de clients + properties + opportunities (Operaciones). Auditoría en [PHASE_2E2_RT0_RUNTIME_AUDIT.md](PHASE_2E2_RT0_RUNTIME_AUDIT.md); plan en [PHASE_2E2_RT1_CLIENTS_PROPERTIES_OPERATIONS_PLAN.md](PHASE_2E2_RT1_CLIENTS_PROPERTIES_OPERATIONS_PLAN.md); prompt listo en [PROMPT_PHASE_2E2_RT1_IMPLEMENTATION.md](PROMPT_PHASE_2E2_RT1_IMPLEMENTATION.md).
