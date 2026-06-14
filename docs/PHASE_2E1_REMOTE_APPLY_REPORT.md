# Fase 2E-1 — Informe de aplicación remota en Supabase

**Fecha:** 2026-06-14
**Estado:** `FASE 2E-1` APPLY + `FASE 2E-1H` HARDENING completadas.

> Documento de estado. No contiene secretos, claves ni contraseñas.

## 1. Proyecto Supabase (correcto y confirmado por API)

| Campo | Valor |
|---|---|
| Organization | `Demos Inmobiliarias Workspace` |
| Organization id | `ayaibwutgawwfhlvmfmb` |
| Project name | `crm-inmobiliario-demo` |
| Project ref | `ylhdbawrllqygfvllhdo` |
| Region | `eu-west-1` (West EU, Ireland) |
| Status | `ACTIVE_HEALTHY` |
| PostgreSQL | 17.6 |
| Conector usado | `claude.ai Supabase` (cloud). No se usó el MCP local, ni n8n, ni GitHub MCP. |

> Nota histórica: hubo un typo previo en prompts/docs (`ylhdbawrllqygfvlhldo`, transposición). El ref **correcto y único** es `ylhdbawrllqygfvllhdo`. No quedó ninguna referencia al ref incorrecto en el repo.

## 2. Migraciones remotas aplicadas

Aplicadas con `apply_migration` sobre `ylhdbawrllqygfvllhdo` (orden cronológico):

| Versión | Nombre | Resultado |
|---|---|---|
| `20260614143939` | `20260613_2e1_core_multitenant` | success |
| `20260614144059` | `20260613_2e1_seed_demo_workspace` | success |
| `20260614144931` | `20260614_2e1_hardening_security_warnings` | success |

Archivos fuente versionados en `supabase/migrations/`.

## 3. Tablas creadas (`public`)

- `public.workspaces` — tenant / inmobiliaria.
- `public.profiles` — extiende `auth.users`; `role` con valores legacy (`nowlabs_admin` / `client_admin` / `member`).
- `public.workspace_members` — membresía N:N con rol de negocio (`owner` / `admin` / `comercial` / `solo_lectura`).

Las 3 con RLS habilitada.

## 4. Funciones creadas (`public`)

| Función | Tipo | `search_path` | EXECUTE tras hardening |
|---|---|---|---|
| `set_updated_at()` | trigger, SECURITY INVOKER | `''` | solo `postgres` (PUBLIC/anon/authenticated revocados) |
| `current_workspace_ids()` | SECURITY DEFINER | `''` | `postgres`, `authenticated` |
| `is_workspace_admin(uuid)` | SECURITY DEFINER | `''` | `postgres`, `authenticated` |
| `current_workspace_role(uuid)` | SECURITY DEFINER | `''` | `postgres`, `authenticated` |

Los helpers SECURITY DEFINER bypasean la RLS de `workspace_members` (evita recursión) y filtran por `auth.uid()`.

## 5. RLS, policies y triggers

- **RLS:** habilitada en `workspaces`, `profiles`, `workspace_members`.
- **Policies (9 en total):**
  - `workspaces`: `ws_select` (SELECT), `ws_update` (UPDATE).
  - `profiles`: `pr_select` (SELECT), `pr_insert_self` (INSERT), `pr_update_self` (UPDATE).
  - `workspace_members`: `wm_select` (SELECT), `wm_insert` (INSERT), `wm_update` (UPDATE), `wm_delete` (DELETE).
  - Las policies de `workspace_members` no hacen subquery directa a la propia tabla (anti-recursión vía `is_workspace_admin`).
- **Triggers:** `trg_workspaces_updated` y `trg_profiles_updated` (BEFORE UPDATE → `set_updated_at`).

## 6. Seed (workspace demo)

| Campo | Valor |
|---|---|
| id | `d0000000-0000-4000-8000-000000000001` |
| name | `Demo Inmobiliaria` |
| slug | `demo-inmobiliaria` |
| vertical | `real_estate` |
| plan | `starter` |

Recuentos: `workspaces = 1`, `profiles = 0`, `workspace_members = 0`, `auth.users = 0`.
El seed **no** crea usuarios ni toca `auth.users`.

## 7. Security Advisor — antes del hardening

| Código | Objeto(s) | Nivel |
|---|---|---|
| `0011 function_search_path_mutable` | `set_updated_at` | WARN |
| `0028 anon_security_definer_function_executable` | `current_workspace_ids`, `is_workspace_admin`, `current_workspace_role` | WARN |
| `0029 authenticated_security_definer_function_executable` | los 3 helpers | WARN |

Total: 7 WARN (0 ERROR).

## 8. Hardening aplicado (`20260614_2e1_hardening_security_warnings`)

1. `CREATE OR REPLACE` de `set_updated_at()` añadiendo `SET search_path = ''` (mismo contrato; los triggers conservan el OID, no se recrean).
2. `REVOKE EXECUTE` de `set_updated_at()` a `PUBLIC`, `anon`, `authenticated` (solo se invoca por triggers; la ejecución de un trigger no comprueba EXECUTE del rol que dispara el evento).
3. `REVOKE EXECUTE` de los 3 helpers a `PUBLIC` y `anon`.
4. `GRANT EXECUTE` de los 3 helpers a `authenticated` (necesario para que las RLS policies los evalúen).

No tocó tablas, datos, seed, Auth, Storage ni API keys.

## 9. Security Advisor — después del hardening

| Código | Estado |
|---|---|
| `0011 function_search_path_mutable` | ✅ eliminado |
| `0028 anon_security_definer_function_executable` | ✅ eliminado (los 3) |
| `0029 authenticated_security_definer_function_executable` | 🟡 3 restantes — **aceptado por diseño** |

Total: 3 WARN (0 ERROR).

### Riesgo aceptado (0029)
Los helpers **deben** ser ejecutables por `authenticated`: las RLS policies los invocan en contexto del usuario autenticado. Quitarles `EXECUTE` a `authenticated` rompería los SELECT/UPDATE con *permission denied for function*. Como filtran internamente por `auth.uid()`, no exponen datos de otros tenants. Se mantiene como warning residual seguro.

## 10. Lo que NO se tocó

`.env.local` · `.env.local.backup_antiguo` · secretos · API keys · Storage · `auth.users` (no se crearon usuarios) · GitHub · runtime `src/*` · n8n · proyectos legacy (`nowcrm-demo`, `costadelsol-crm`, `proyecto-costadelsolrealhomes`, NowLabs/CostaDelSol). No se cambiaron roles de negocio ni el seed. No se hizo deploy.

## 11. Riesgos pendientes

- **0029 (authenticated)**: residual aceptado (ver §9). Mitigación futura **opcional, no obligatoria**: mover los helpers a un schema privado (p.ej. `private`) fuera de la API REST expuesta. No se hace ahora porque podría requerir tocar las policies y futuras migraciones; queda como posible fase futura.
- `.env.local` / `.env.local.backup_antiguo` aún apuntan a un ref **legacy** (`costadelsol-crm`). Intactos por política; pendiente de actualizar al ref nuevo cuando se trabaje el runtime.

## 12. Siguiente paso recomendado

1. **Crear usuario demo** vía Supabase Auth (signup/invite) y vincularlo server-side: `profiles` (role legacy `client_admin`) + `workspace_members` (role `owner`) sobre el workspace `d0000000-0000-4000-8000-000000000001`.
2. Después, **Fase 2E-2** (tablas CRM) — no iniciada.
