# Fase 2E-2 — Checklist de APPLY (CRM core + seed)

**Fecha:** 2026-06-14 · **Estado:** preparado tras 2E-2R. **Aún NO aplicado.**
**Proyecto:** `crm-inmobiliario-demo` · ref `ylhdbawrllqygfvllhdo` · conector `claude.ai Supabase`.

Archivos:
- `supabase/migrations/20260614_2e2_core_crm_tables.sql` (schema + RLS + triggers)
- `supabase/migrations/20260614_2e2_seed_real_estate_demo_data.sql` (datos demo)
- `supabase/manual/20260614_2e2_post_apply_verification.sql` (verificación read-only)

## 1. Prechecks (read-only, abortar si algo falla)
- [ ] `git status` limpio; HEAD en el commit de 2E-2R.
- [ ] Org = `Demos Inmobiliarias Workspace`; project = `crm-inmobiliario-demo`; ref = `ylhdbawrllqygfvllhdo`.
- [ ] `list_migrations` = core + seed + hardening (2E-1), **sin** las de 2E-2.
- [ ] `clients/properties/opportunities/service_cases/tasks/calendar_events/activities` **NO** existen aún.
- [ ] `workspaces=1`, `auth.users=1`, `profiles=1`, `workspace_members=1`; workspace demo presente.
- [ ] Helpers 2E-1 presentes (`current_workspace_ids`, `current_workspace_role`, `is_workspace_admin`).

## 2. Orden de apply
1. **Core** → `apply_migration` name `20260614_2e2_core_crm_tables`, contenido del archivo core, project `ylhdbawrllqygfvllhdo`.
2. **Seed** → `apply_migration` name `20260614_2e2_seed_real_estate_demo_data`, contenido del seed.

> No tocar runtime, Auth, Storage ni billing en esta fase. No iniciar 2E-3/2E-4.

## 3. Verificación (ejecutar `supabase/manual/20260614_2e2_post_apply_verification.sql`)
Esperado:
- 7 tablas con `rls_enabled = true`.
- Counts seed: clients=8, properties=7, opportunities=7, service_cases=5, tasks=10, calendar_events=8, activities=14.
- Policies: clients/properties/opportunities/service_cases = 5 c/u; tasks/calendar_events = 4; activities = 3.
- Triggers: `updated_at` en 6 tablas (no en activities); `member_refs` en clients/opportunities/service_cases/tasks.
- `enforce_member_refs`: `security_definer=true`, `search_path=''`, sin EXECUTE para anon.
- 0 filas fuera del workspace demo; 0 relaciones huérfanas; 0 valores fuera de vocabulario.
- Núcleo intacto (workspaces=1, auth.users=1, profiles=1, members=1; roles client_admin/owner).
- `get_advisors(security)`: sin ERROR (los 3 WARN `0029` de helpers siguen aceptados).

## 4. Si falla el CORE
- PARAR. No aplicar el seed.
- Devolver el error exacto. No improvisar parches en caliente.
- Como el core es idempotente (`if not exists` / `or replace` / `drop ... if exists`), se puede corregir el archivo y reintentar **solo** si el fallo es un error sintáctico/real identificado.

## 5. Si falla el SEED
- PARAR. Devolver el error exacto.
- El seed es idempotente (`on conflict (id) do nothing`): tras corregir, se puede reaplicar sin duplicar.
- Causas probables: vocabulario fuera de CHECK (no debería: solo clients.status/channel, tasks.status, calendar_events.type tienen CHECK y el seed los respeta), o el workspace demo ausente (la guarda lo detecta).

## 6. Revertir antes de runtime (si fuese necesario)
> Solo en proyecto de pruebas / antes de integrar runtime. Operación destructiva controlada.
- Borrar datos seed sin tocar el schema:
  `delete from public.activities where workspace_id = 'd0000000-0000-4000-8000-000000000001';` (y análogo para tasks, calendar_events, service_cases, opportunities, properties, clients — **en ese orden** por las FKs).
- Eliminar tablas (rollback total de 2E-2), respetando dependencias:
  `drop table if exists public.activities, public.calendar_events, public.tasks, public.service_cases, public.opportunities, public.properties, public.clients cascade;`
  y `drop function if exists public.enforce_member_refs();`
- **No** borrar workspaces/profiles/workspace_members (núcleo 2E-1). **No** borrar el workspace demo.

## 7. Riesgos
- Columnas forward-looking nullable: no las lee el código aún; verificar tras integrar runtime.
- `stage`/`status`/`case_type` son texto libre: el seed usa el vocabulario del vertical; si se cambia el catálogo en `vertical-templates.ts`, alinear seed.
- Trigger `member_refs`: solo valida `assigned_to` no nulo y cambiante; el seed lo deja NULL (no se dispara).

## 8. Criterios de éxito
- Las 2 migraciones aplicadas y en `list_migrations`.
- Las 7 tablas con RLS, policies, índices y triggers correctos.
- Seed con los counts esperados y relaciones íntegras.
- Núcleo 2E-1 intacto. Sin ERROR en advisors. Git sin cambios runtime/env.

## 9. Criterios de bloqueo
- Aparece NowLabs / proyecto legacy → `BLOQUEADO`.
- El ref no es `ylhdbawrllqygfvllhdo` → `BLOQUEADO`.
- Las tablas CRM ya existían con otra forma → revisar antes de continuar.
- Cualquier ERROR de advisors nuevo tras apply → PARAR y reportar.

## 10. No tocar
`.env.local`, `.env.local.backup_antiguo`, secretos, API keys, Auth users, Storage, runtime `src/*`, n8n, proyectos legacy. No deploy. No commits de runtime.

## 11. Naming (2E-2N)
La tabla se llama `opportunities` (técnico) y **no se renombra** en el APPLY. La UI debe mostrar **"Operaciones" / "Pipeline comercial"** (no "Oportunidades"); la unificación de textos es trabajo de la fase runtime, no del APPLY. Ver sección Naming en [PHASE_2E2_SCHEMA_REVIEW.md](PHASE_2E2_SCHEMA_REVIEW.md).
