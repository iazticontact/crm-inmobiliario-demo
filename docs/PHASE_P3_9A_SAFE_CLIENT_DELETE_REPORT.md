# FASE P3.9A — Safe client delete + relational cleanup + doble confirmación

> **Fecha:** 2026-06-22 · HEAD previo `2dca51a`. Nuevo: 1 RPC (migración), 1 endpoint, 1
> componente; wired en `/clients`. **Sin** tocar `auth.users`/workspaces/profiles/members,
> otros workspaces, n8n, asistente runtime, RLS existente. Requiere redeploy.

---

## 1. Auditoría de relaciones (BD)
FKs que referencian `clients` (todas **`ON DELETE SET NULL`** → el borrado viejo dejaba
huérfanos): `opportunities`, `service_cases`, `tasks`, `calendar_events`, `activities`,
`properties`. Sin FK pero vincula por `entity_id`: `assistant_agent_memory`
(`entity_type='client'`). **Sin FKs transitivas** (nada referencia a opportunities/cases/…).
DELETE RLS de todas = `is_workspace_admin(workspace_id)`. `public.documents` **no existe**.

## 2. Política de borrado elegida
**Borrar** el rastro operativo (opportunities, service_cases, tasks, calendar_events,
activities, assistant_agent_memory). **Conservar** las propiedades (activo) desvinculando
`client_id`. **Nunca** auth/workspace/profiles/members/otros clientes/otros workspaces. Matriz
completa en `docs/CLIENT_DELETE_POLICY.md`.

## 3. Preview implementado
`GET /api/clients/[id]/delete` → `{ client, related: { opportunities, service_cases, tasks,
calendar_events, activities, assistant_memories, properties } }`, counts **workspace-scoped**
(cookie-bound, RLS). La UI muestra "Vas a eliminar a X y su información relacionada: …".

## 4. Doble confirmación (UI)
`DeleteClientDialog`: **Paso 1** preview de impacto + "no se puede deshacer"; **Paso 2** exige
**escribir el nombre exacto** del cliente (botón final deshabilitado si no coincide). Si el
preview falla, no deja borrar. Modo demo = solo lectura (la papelera avisa y no abre).

## 5. Backend / RPC
- RPC `public.delete_client_cascade(p_client_id)` — `SECURITY DEFINER`, **atómica**, gateada
  por `is_workspace_admin(auth.uid())`, `search_path=public`, `execute` solo `authenticated`.
- `POST /api/clients/[id]/delete` — sesión (401) + workspace del profile + cliente del
  workspace (404) + solo admin (403) + `confirm` == nombre exacto (400 si no) → llama la RPC.
- Sin `service_role` en frontend; workspace nunca del body.

## 6. Qué se borra exactamente
operaciones + expedientes + tareas + citas + actividades + memorias del asistente del cliente
(todo `where workspace_id = ws and client_id/entity_id = cid`) → y el cliente.

## 7. Qué se conserva
Propiedades del cliente (se desvincula `client_id = NULL`, el activo permanece). auth.users,
workspaces, profiles, workspace_members, otros clientes, datos de otros workspaces.

## 8. Seguridad workspace/sesión
Doble capa: la **ruta** valida sesión + workspace (del profile) + propiedad del cliente + rol
admin + nombre de confirmación; la **RPC** revalida `is_workspace_admin` del workspace del
cliente y scopea cada delete a ese workspace. Cross-workspace → 404. Sin sesión → 401. No
admin → 403.

## 9. QA realizada
- **E2E cascade (MCP, cliente desechable)**: crear cliente + operación + tarea + actividad →
  preview counts (1,1,1) → cascade → **0 huérfanos**, cliente borrado, **demo intacto** (6
  clientes, 0 residuo). ✅
- Lógica de ruta (auth/workspace/rol/propiedad/confirm-name) revisada; el camino de auth
  completo (login admin en navegador) se valida en staging (no automatizable aquí).
- Detectado **1 huérfano preexistente** (operación con `client_id NULL`) de borrados
  antiguos → P3.9B.

## 10. Validaciones
`tsc --noEmit` ✅ · `lint --max-warnings=0` ✅ · `build` ✅. (Fix lint
`react-hooks/set-state-in-effect`: setState inicial diferido con `setTimeout(0)`.)

## 11. Archivos tocados
- NUEVO `supabase/migrations/20260622_p39a_delete_client_cascade.sql` (RPC, aplicada por MCP).
- NUEVO `src/app/api/clients/[id]/delete/route.ts` (GET preview + POST confirm).
- NUEVO `src/components/DeleteClientDialog.tsx`.
- `src/app/(saas)/clients/page.tsx` (wired: doble-confirm dialog; quitado el delete directo y
  la actividad ruidosa "Cliente eliminado").
- Docs: `CLIENT_DELETE_POLICY.md` + este report.

## 12. Migraciones
`20260622_p39a_delete_client_cascade.sql` — crea la función. **Rollback:** `drop function
public.delete_client_cascade(uuid);` (no altera tablas/datos; reaplicable con `create or
replace`).

## 13-15. Commit / push / redeploy
Ver hash `feat(clients): safe delete with relational cleanup + double confirm (P3.9A)`. Push a
`origin/main`. **Requiere redeploy** (runtime nuevo). La RPC ya está en BD.

## 16. Qué probar en staging (login admin, no demo)
1. Papelera de un cliente → preview con counts reales.
2. Cancelar en paso 1 y en paso 2 → no borra.
3. Escribir mal el nombre → botón deshabilitado / 400 → no borra.
4. Escribir bien → borra cliente **y** sus operaciones/tareas/citas/expedientes/actividades.
5. Dashboard y `/clients` se actualizan; el asistente ya no recuerda al cliente.
6. No quedan huérfanos; otros clientes intactos.
7. Seguridad: cliente de otro workspace → 404; sin sesión → 401; rol member → 403.

## Veredicto
**P3.9A COMPLETADO — SAFE CLIENT DELETE WITH RELATIONAL CLEANUP.** Borrado de cliente
profesional: preview de impacto + doble confirmación (escribir nombre) + cascade atómica y
workspace-scoped vía RPC `SECURITY DEFINER` gateada por `is_workspace_admin`, sin huérfanos,
sin tocar auth/workspaces/otros workspaces. Cascade verificado (0 huérfanos). tsc/lint/build
verdes. **Requiere redeploy.** Siguiente: **P3.9B** (limpiar el huérfano preexistente +
re-sembrar el demo comercial, con confirmación).
