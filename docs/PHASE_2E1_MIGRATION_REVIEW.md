# Fase 2E-1 — Revisión de la migración core multi-tenant

> Revisión de las migraciones preparadas (versionadas en el repo, **sin ejecutar**).
> Archivos: [`supabase/migrations/20260613_2e1_core_multitenant.sql`](../supabase/migrations/20260613_2e1_core_multitenant.sql) · [`supabase/migrations/20260613_2e1_seed_demo_workspace.sql`](../supabase/migrations/20260613_2e1_seed_demo_workspace.sql)
> Contexto: [PHASE_2_SCHEMA_DESIGN.md](PHASE_2_SCHEMA_DESIGN.md) · [PHASE_2_IMPLEMENTATION_PLAN.md](PHASE_2_IMPLEMENTATION_PLAN.md) (corte 2E-1).
> ⚠️ **NO se ha ejecutado SQL.** No hay Supabase nuevo verificado todavía. Estos archivos quedan listos para ejecutar cuando el MCP apunte al proyecto NUEVO.

---

## Qué crea la migración core

**Extensión / utilidades**
- `pgcrypto` (para `gen_random_uuid()`).
- `public.set_updated_at()` — función trigger reutilizable que pone `updated_at = now()`.

**Tablas**
- **`workspaces`** — el tenant (la inmobiliaria): `id`, `name`, `slug` (único), `vertical` (default `real_estate`), `plan`, `trial_ends_at`, `branding jsonb`, `settings jsonb`, `created_at`, `updated_at` (+ trigger).
- **`profiles`** — extiende `auth.users` (`id` FK `auth.users on delete cascade`): `workspace_id`, `email`, `full_name`, `role` **legacy** (`nowlabs_admin|client_admin|member`), `avatar_url`, timestamps (+ trigger). Índices: `workspace_id`, `lower(email)`.
- **`workspace_members`** — membresía N:N: `workspace_id`, `user_id` (FK `auth.users`), `role` **negocio** (`owner|admin|comercial|solo_lectura`), `invited_by`, `created_at`, `unique(workspace_id,user_id)`. Índices: `user_id`, `workspace_id`.

**Helpers RLS (SECURITY DEFINER, `search_path=''`)**
- `current_workspace_ids()` — workspaces del usuario actual.
- `is_workspace_admin(target_workspace_id uuid)` — true si el usuario es `owner`/`admin` de ese workspace.
- `current_workspace_role(target_workspace_id uuid)` — el rol del usuario en ese workspace.
- `grant execute` a `authenticated` en las tres.

**RLS + policies**
- RLS activada en `workspaces`, `profiles`, `workspace_members`.
- `workspaces`: SELECT miembros; UPDATE owner/admin.
- `profiles`: SELECT propio o del mismo workspace; INSERT/UPDATE solo el propio.
- `workspace_members`: SELECT propias o (si admin) las del workspace; INSERT/UPDATE/DELETE solo owner/admin.

---

## Qué NO crea (a propósito)

- ❌ **Ninguna tabla de negocio** (clients, properties, opportunities, etc.) — eso es 2E-2 en adelante.
- ❌ **Nada de Storage / buckets** — eso es 2E-4.
- ❌ **Nada en `auth.users`** — los usuarios se crean por Supabase Auth.
- ❌ **Ningún usuario/email real** — el seed solo inserta la fila del workspace demo.
- ❌ **Ninguna policy de INSERT de `workspaces`** ni de bootstrap del primer owner para el cliente — eso se hace server-side con `service_role` durante el onboarding (ver abajo).
- ❌ **No toca el runtime de la app** ni el modo demo offline (`DEMO_MODE_KEY`).

---

## Por qué se mantiene `profiles.role` legacy

El código actual (`current-user.ts`, `team/users`, gating de UI) lee `profiles.role` y espera los valores **`nowlabs_admin` / `client_admin` / `member`** — son **contratos internos protegidos**. Cambiarlos rompería el gating y las rutas de equipo. Por eso `profiles.role` se crea **idéntico** al actual y NO se toca en 2E-1.

## Por qué `workspace_members.role` es el rol de negocio nuevo

Los roles que Oier quiere para el producto real (**`owner` / `admin` / `comercial` / `solo_lectura`**) son roles **por workspace** (un usuario puede ser owner de uno y comercial de otro). Eso encaja en la membresía N:N, no en el perfil global. Así:
- `profiles.role` = compatibilidad con el código existente (no se rompe nada).
- `workspace_members.role` = control de acceso real por workspace (lo nuevo).

Cuando se conecte el frontend (2E-6+) decidiremos cómo mapea la UI a estos roles. Hasta entonces conviven sin conflicto. (Decisión abierta: si se quisiera unificar a un único modelo, sería un cambio de código de gating planificado — no en 2E-1.)

---

## Cómo se evita la recursión RLS

**El problema:** una policy sobre `workspace_members` que haga `SELECT ... FROM workspace_members` vuelve a disparar la RLS de `workspace_members` al evaluarse → **recursión infinita** (error `infinite recursion detected in policy`).

**La solución aplicada:**
- Toda comprobación de pertenencia/rol se hace mediante **funciones `SECURITY DEFINER`** (`current_workspace_ids`, `is_workspace_admin`) con **`set search_path = ''`** y nombres totalmente cualificados.
- Al ser `SECURITY DEFINER`, la función se ejecuta con privilegios del **owner** (que **bypasea RLS**), así que cuando consulta `workspace_members` **no** se re-evalúa la policy de esa tabla → **sin recursión**.
- En la policy `SELECT` de `workspace_members`, la rama del propio usuario usa `user_id = auth.uid()` **directo** (sin subquery a la tabla); la rama de admin usa `is_workspace_admin(workspace_id)` (la función definer).
- **Nunca** hay una subquery directa `select ... from workspace_members` dentro de una policy de `workspace_members`.

`search_path = ''` + nombres cualificados (`public.workspace_members`, `auth.uid()`) también blindan las funciones definer frente a ataques de `search_path`.

---

## Cómo se ejecutará (cuando el MCP apunte al proyecto NUEVO)

> Prerrequisito **obligatorio**: Supabase MCP conectado a un proyecto **nuevo y vacío**, con su `ref` confirmado (y que NO sea `nowcrm-demo` / `costadelsol-crm` / `proyecto-costadelsolrealhomes`).

1. **Verificar entorno:** `list_projects` → confirmar org y ref del proyecto nuevo.
2. **Aplicar core:** ejecutar el contenido de `20260613_2e1_core_multitenant.sql` (vía `apply_migration` con el SQL del archivo, o CLI `supabase db push` si se usa CLI con el proyecto enlazado).
3. **Aplicar seed:** ejecutar `20260613_2e1_seed_demo_workspace.sql`.
4. **Crear usuario demo** por Supabase Auth (signup/invite) → obtener su `auth.users.id`.
5. **Vincular** (server-side / service_role): insertar su `profiles` y su `workspace_members` (`role='owner'`) en el workspace demo `d0000000-0000-4000-8000-000000000001`.

---

## Checks post-migración

Tras ejecutar (en el proyecto nuevo):
- [ ] `workspaces`, `profiles`, `workspace_members` existen; RLS = **enabled** en las tres.
- [ ] Funciones `current_workspace_ids`, `is_workspace_admin`, `current_workspace_role` existen y son `SECURITY DEFINER`.
- [ ] Triggers `trg_workspaces_updated` y `trg_profiles_updated` activos (UPDATE refresca `updated_at`).
- [ ] El workspace demo (`slug = 'demo-inmobiliaria'`) existe (1 fila).
- [ ] **Sin recursión:** `select * from workspace_members` como usuario autenticado no lanza `infinite recursion detected in policy`.
- [ ] **Aislamiento:** con dos usuarios/workspaces, el usuario A no ve filas de `workspace_members`/`profiles`/`workspaces` del workspace B.
- [ ] El `advisor`/linter de Supabase no reporta tablas con RLS desactivada ni funciones definer con `search_path` mutable.

---

## Rollback manual (si hiciera falta)

Como es un proyecto **nuevo y sin datos reales**, el rollback es seguro:
```sql
drop table if exists public.workspace_members cascade;
drop table if exists public.profiles cascade;
drop table if exists public.workspaces cascade;
drop function if exists public.current_workspace_ids();
drop function if exists public.is_workspace_admin(uuid);
drop function if exists public.current_workspace_role(uuid);
drop function if exists public.set_updated_at();
```
(En entornos con CLI, preferible revertir creando una nueva migración de `down` versionada en vez de drops manuales.)

---

## Riesgos

1. ⛔ **Ejecutar en el proyecto equivocado.** Mitigación: verificar `ref` del proyecto nuevo antes de aplicar; NO ejecutar nunca en los 3 legacy.
2. ⚠️ **Bootstrap del primer owner.** Las policies de `workspace_members` requieren un admin ya existente para insertar. El **primer** owner se inserta server-side con `service_role` (onboarding). Documentado en el seed; no es un bug, es diseño.
3. ⚠️ **Doble modelo de roles** (`profiles.role` legacy vs `workspace_members.role`). Conviven sin conflicto en 2E-1; unificar sería cambio de código futuro.
4. ⚠️ **Funciones definer.** Deben quedar con `search_path=''` y `EXECUTE` a `authenticated`. El linter de Supabase debe salir limpio.
5. ⚠️ **Profile self-insert con `workspace_id` arbitrario.** La policy de `profiles` permite al usuario crear su propio perfil; aunque pusiera un `workspace_id` ajeno, **no** gana acceso a datos (las tablas de negocio filtran por `workspace_members`, no por `profiles.workspace_id`). Aceptable en 2E-1.
6. ⚠️ **Demo offline.** No se toca; pero al conectar el frontend a Supabase (2E-6) hay que verificar que `DEMO_MODE_KEY` sigue cortocircuitando antes de cualquier query.
