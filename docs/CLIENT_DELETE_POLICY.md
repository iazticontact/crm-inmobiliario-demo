# Política de borrado de cliente

> Cómo elimina el CRM un cliente de forma segura, coherente y sin dejar basura
> huérfana. Borrado **workspace-scoped**, **atómico**, con **doble confirmación** y
> **preview de impacto**. Nunca toca `auth.users`, `workspaces`, `profiles`,
> `workspace_members`, otros clientes ni otros workspaces.

## 1. Qué pasaba antes (problema)
Todas las FKs a `clients` son `ON DELETE SET NULL`. El borrado anterior solo hacía
`delete from clients` → las operaciones, tareas, citas, expedientes y actividades quedaban
con `client_id = NULL` pero **seguían existiendo** (basura huérfana en el pipeline y la
agenda). Y se borraba con **un solo click**.

## 2. Qué se borra / qué se conserva (matriz)
| Tabla | Vínculo | Acción | Razón |
|---|---|---|---|
| `opportunities` | `client_id` (FK SET NULL) | **BORRAR** | operación del cliente |
| `service_cases` | `client_id` (FK SET NULL) | **BORRAR** | expediente del cliente |
| `tasks` | `client_id` (FK SET NULL) | **BORRAR** | tarea del cliente |
| `calendar_events` | `client_id` (FK SET NULL) | **BORRAR** | cita del cliente |
| `activities` | `client_id` (FK SET NULL) | **BORRAR** | actividad del cliente |
| `assistant_agent_memory` | `entity_id` (sin FK, `entity_type='client'`) | **BORRAR** | que el asistente "olvide" al cliente |
| `properties` | `client_id` (FK SET NULL) | **CONSERVAR** (desvincular `client_id=NULL`) | una propiedad es un **activo**, no un rastro del cliente |
| `documents` | — | N/A | la tabla `public.documents` no existe (módulo Storage no activo) |
| `auth.users`, `workspaces`, `profiles`, `workspace_members`, otros clientes/workspaces | — | **NUNCA** | fuera del alcance |

## 3. Backend — RPC atómica
`public.delete_client_cascade(p_client_id uuid)` (migración
`20260622_p39a_delete_client_cascade.sql`):
- `SECURITY DEFINER` (para borrar las filas relacionadas en **una sola transacción**), pero
  **gateada** por `is_workspace_admin(v_ws)` sobre `auth.uid()` (el llamante). Solo puede
  borrar datos del **workspace del cliente** y solo si el llamante es **admin** de ese
  workspace. `search_path = public`. `execute` solo para `authenticated`.
- Orden: memorias del asistente → actividades → tareas → citas → expedientes → operaciones →
  (propiedades: `client_id = NULL`) → cliente. Todo `where workspace_id = v_ws`.
- Devuelve `{ client, workspace_id, removed: {counts} }`.

## 4. Backend — endpoint
`/api/clients/[id]/delete` (cookie-bound, `runtime=nodejs`):
- **`GET`** → preview de impacto (counts workspace-scoped). 
- **`POST`** → confirma y ejecuta. Exige `confirm` == nombre exacto del cliente (guard de
  backend contra borrado accidental/automatizado), y llama a la RPC.
- Seguridad: sesión obligatoria (401), workspace resuelto del **profile del llamante** (nunca
  del body), cliente debe pertenecer al workspace (404), solo **workspace admin**
  (`client_admin`/`nowlabs_admin`, 403). No expone `service_role` al frontend.

## 5. UI — doble confirmación + preview
`DeleteClientDialog`:
- **Paso 1**: muestra el impacto real ("Vas a eliminar a X y su información relacionada: N
  operaciones, N tareas, N citas, N expedientes, N actividades, N referencias del asistente";
  las propiedades se conservan) + "Esta acción no se puede deshacer."
- **Paso 2**: exige **escribir el nombre exacto** del cliente; el botón "Eliminar
  definitivamente" se habilita solo si coincide.
- Si el preview falla → **no** se permite borrar.
- Tras borrar: toast humano, recarga del listado, no quedan en ficha inexistente.
- **Modo demo**: solo lectura (el botón papelera muestra aviso y no abre el diálogo).

## 6. Cómo se evita
- **Borrado accidental**: doble confirmación + escribir el nombre exacto (UI) + revalidación
  del nombre en el backend.
- **Cross-workspace**: workspace del *profile* del llamante (no del body) + el cliente debe
  pertenecer a ese workspace + `is_workspace_admin` en la RPC + todos los deletes
  `where workspace_id = v_ws`. Cliente de otro workspace → 404.
- **Sin sesión** → 401. **No admin** → 403.
- **Huérfanos**: la RPC borra explícitamente cada relación (las FKs son SET NULL, no cascade).

## 7. QA (verificado)
Test E2E del cascade con cliente desechable (crear cliente + operación + tarea + actividad →
preview counts correctos → cascade → **0 huérfanos**, cliente borrado, demo intacto: 6
clientes, sin residuo). La ruta valida sesión/workspace/rol/propiedad/nombre. La ruta de
auth completa (login admin) se prueba en staging.

## 8. Reparación de demo (P3.9B)
Existe **1 operación huérfana** (`client_id NULL`) de borrados antiguos (antes de este
sistema). Limpieza + re-siembra del demo comercial = **P3.9B** (con confirmación).
