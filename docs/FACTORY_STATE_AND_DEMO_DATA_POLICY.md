# Factory State & Demo Data Policy

> Cómo arranca un cliente nuevo (vacío y limpio) vs el workspace de demo comercial (con
> datos ficticios). Operaciones de BD **admin-only** (SQL editor / service_role), nunca
> expuestas al cliente. **Nunca** `truncate` global ni tocar `auth.users`.

## 1. Estado actual (auditado 2026-06-21)
- **1 usuario, 1 workspace, 1 membership, 1 profile.**
- **No hay triggers en `auth.users`** ni funciones `handle_new_user`/provisioning.
- ⇒ **No existe auto-provisioning**: un signup crea el `auth.user` pero NO crea
  profile/workspace → `AuthGate` lo manda a `/login?error=no_profile`. Un usuario nuevo
  **no hereda** datos demo automáticamente (no se le asigna ningún workspace).
- El único workspace existente (`d0000000-0000-4000-8000-000000000001`) es el **DEMO
  COMERCIAL** y contiene el seed ficticio (clientes, operaciones, citas, etc.).
- **Conclusión:** el riesgo "cliente nuevo arranca con datos demo" es **NULO** con el
  flujo actual (no hay provisioning automático). El trabajo real es: (a) un procedimiento
  limpio para dar de alta clientes, y (b) separar demo de cliente. No es un bug de datos.

## 2. Dos experiencias separadas
| | DEMO COMERCIAL | CLIENTE NUEVO |
|---|---|---|
| Para | enseñar/vender | producción del cliente |
| Datos | ficticios bonitos (seed) | **vacío** (0 clientes/operaciones/…) |
| Acceso | botón "Ver demo" (offline mock) **o** workspace `d0000000…` | workspace propio + login real |
| Branding | "Demo Inmobiliaria" | nombre del cliente (`workspaces.name`, `src/lib/brand.ts`) |
| Env | `NEXT_PUBLIC_ENABLE_DEMO_DATA=true` | `NOWLABS_INTERNAL=false`, demo data OFF |

La **demo offline** (botón "Ver demo", `DEMO_MODE_KEY`) usa mocks de `src/lib/demo/` y NO
toca Supabase → siempre limpia y separada del cliente real.

## 3. Alta de un cliente nuevo (workspace VACÍO)

### 3.a Self-onboarding desde la UI (recomendado, P3.1)
Implementado en P3.1. Un usuario autenticado **sin workspace** ya no se expulsa: `AuthGate`
lo lleva a **`/onboarding`**, donde escribe el nombre de su inmobiliaria y se crea su
espacio **vacío** (workspace + profile `client_admin` + member `owner`, **sin seed**) vía
`POST /api/onboarding/workspace` (server-side, service_role tras verificar la sesión;
idempotente: si ya tiene workspace, no crea otro). Flujo comercial:
1. El operador crea (o invita) el `auth.user` del cliente.
2. El cliente entra, ve **"Crea tu espacio de trabajo"**, pone su nombre → CRM vacío.
No requiere SQL manual. Requiere `SUPABASE_SERVICE_ROLE_KEY` en el servidor; si falta, el
endpoint responde 503 y se cae al alta admin (§3.b).

### 3.b Alta admin por SQL (fallback)
El usuario se registra por Supabase Auth (o invitación) → existe `auth.users.id`. Luego,
**en el SQL editor (service_role)**:
```sql
-- 1) Workspace vacío
insert into public.workspaces (id, name, slug, plan)
values (gen_random_uuid(), 'Inmobiliaria del Cliente', 'inmobiliaria-cliente', 'basic')
returning id;   -- copia el <WS_ID>

-- 2) Vincular el usuario (reemplaza <USER_ID>, <WS_ID>, email, nombre)
insert into public.profiles (id, workspace_id, email, full_name, role)
values ('<USER_ID>', '<WS_ID>', 'cliente@dominio.com', 'Nombre Cliente', 'client_admin')
on conflict (id) do update set workspace_id = excluded.workspace_id;

insert into public.workspace_members (workspace_id, user_id, role)
values ('<WS_ID>', '<USER_ID>', 'owner')
on conflict do nothing;
-- SIN seed. El CRM arranca vacío -> el cliente ve los empty states de fábrica.
```
No ejecutar ningún seed de demo para este workspace.

> **Borrado de un cliente concreto (no del workspace entero):** usar el flujo de producto
> con doble confirmación + limpieza relacional (RPC `delete_client_cascade`), documentado en
> `docs/CLIENT_DELETE_POLICY.md` (P3.9A). El reset de abajo es para vaciar un workspace entero.

## 4. Reset SEGURO de un workspace (datos, no estructura)
Borra SOLO las entidades del workspace elegido. Workspace-scoped, transaccional, **nunca**
`auth.users`/`workspaces`/`profiles`/`workspace_members`.
```sql
-- Reemplaza <WS_ID>. OJO: d0000000… es la DEMO; no la reinicies salvo intención.
begin;
delete from public.assistant_agent_memory where workspace_id = '<WS_ID>';
delete from public.assistant_messages      where workspace_id = '<WS_ID>';
delete from public.assistant_threads       where workspace_id = '<WS_ID>';
delete from public.activities              where workspace_id = '<WS_ID>';
delete from public.tasks                   where workspace_id = '<WS_ID>';
delete from public.calendar_events         where workspace_id = '<WS_ID>';
delete from public.service_cases           where workspace_id = '<WS_ID>';
delete from public.opportunities           where workspace_id = '<WS_ID>';
delete from public.documents               where workspace_id = '<WS_ID>';
delete from public.properties              where workspace_id = '<WS_ID>';
delete from public.clients                 where workspace_id = '<WS_ID>';
commit;
```

## 5. Datos demo — calidad y PII
- El seed demo debe verse **bonito**: "Cliente creado", "Visita programada", "Operación
  actualizada", "Tarea completada". **El dashboard ya filtra borrados** ("Cliente
  eliminado: …") para que no aparezcan en la home (P3).
- **PII**: ✅ **SANEADO en P3.1** (`20260621_p31_sanitize_demo_workspace_pii.sql`, aplicado
  vía MCP). El único cliente con PII real (el contacto de prueba del propio owner: nombre,
  DNI, email, teléfono y dirección reales) se sustituyó por un cliente ficticio coherente
  (**"Javier Ortega Ruiz"**, `javier.ortega@example.com`, `+34 600 109 209`, DNI demo
  `00000000T`). El resto de clientes del seed ya eran ficticios (`example.com`,
  `+34 600 10X`). Verificado: 0 tokens de PII real en el workspace demo. **Nota:** el
  *owner/profile* sigue siendo el real (saludo "Buenas tardes, …") — eso es la identidad del
  usuario que enseña su CRM, no un contacto; no es PII de cliente.

## 6. Qué NO tocar
`auth.users`, `workspaces`/`profiles`/`workspace_members` (salvo el alta controlada de §3),
RLS, migraciones previas, `/api/assistant/v2`, `/api/agent/tool`, `assistant_agent_memory`,
la demo offline. Sin `truncate` global. Sin borrar datos reales sin confirmación explícita.

## 7. Checklist alta de cliente nuevo
1. Deploy con `NEXT_PUBLIC_NOWLABS_INTERNAL=false`, `NEXT_PUBLIC_ENABLE_DEMO_DATA=false`,
   branding en `src/lib/brand.ts`, `N8N_ASSISTANT_V2_*` del agente.
2. Usuario se registra (Auth) → admin ejecuta §3 (workspace vacío + vínculo).
3. El cliente entra y ve los **empty states de fábrica** (sin Oier/Soler/demo).
4. QA con `docs/QA_CHECKLIST.md` (secciones "P2 — Pack básico cliente" + "Clone readiness").
