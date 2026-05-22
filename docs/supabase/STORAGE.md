# Supabase Storage — `client-files`

Confirmado en `costadelsol-crm` (`project_id=ktsgfukjgldeylfzrayr`) por consulta directa a `storage.buckets` y `pg_policies`. Última verificación: 2026-05-22.

## Bucket

| Campo | Valor |
|---|---|
| `id` / `name` | `client-files` |
| `public` | `false` |
| `file_size_limit` | `52428800` (50 MB) |
| `allowed_mime_types` | `application/pdf`, `image/png`, `image/jpeg`, `image/webp`, `application/msword`, `application/vnd.openxmlformats-officedocument.wordprocessingml.document`, `application/vnd.ms-excel`, `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`, `text/plain`, `text/csv` |

## Convención de paths

```
{workspace_id}/clients/{client_id}/{timestamp-safeFilename}
```

- `workspace_id` y `client_id` son UUIDs.
- `timestamp` = `Date.now()` (millis).
- `safeFilename` se sanitiza en el servidor: se eliminan slashes, backslashes, `..`, caracteres no `[a-zA-Z0-9._-]`, y se trunca a 120 caracteres.
- **Nunca** confíes en `storage_path` de la tabla `documents` sin validar que comienza por `${workspaceId}/clients/${clientId}/` y que no contiene `..` ni empieza por `/`.

## Modelo de borrado — el delete pasa SIEMPRE por la API

Para evitar filas huérfanas o objetos huérfanos:

1. El usuario **no puede borrar objetos** en `storage.objects` directamente desde el browser. La policy `DELETE` para `authenticated` sobre `client-files` **no existe** (ver SQL).
2. La fila en `public.documents` requiere `is_workspace_admin()` (policy `documents_delete`). Un user normal tampoco puede borrarla desde el cliente.
3. Por eso el endpoint `DELETE /api/clients/[id]/documents/[docId]` usa `SUPABASE_SERVICE_ROLE_KEY` server-side tras validar workspace + client + bucket + path, y borra de forma atómica fila + objeto.
4. Si `SUPABASE_SERVICE_ROLE_KEY` no está configurada el endpoint responde `503` antes de tocar nada.

`service_role` **nunca** se envía al cliente.

## Policies en `storage.objects`

Tres policies para rol `authenticated`. Todas comprueban:

```
bucket_id = 'client-files'
AND EXISTS (
  SELECT 1 FROM public.profiles p
  WHERE p.id = auth.uid()
    AND p.workspace_id::text = split_part(objects.name, '/', 1)
)
```

| Policy | CMD | USING | WITH CHECK |
|---|---|---|---|
| `client_files_select_workspace` | SELECT | ✓ | — |
| `client_files_insert_workspace` | INSERT | — | ✓ |
| `client_files_update_workspace` | UPDATE | ✓ | ✓ |

**No existe** `client_files_delete_workspace`. Storage rechazará cualquier DELETE directo desde el browser. Solo `service_role` puede borrar, vía la API server-side.

## Policies relevantes en `public.documents`

| Policy | CMD | Regla |
|---|---|---|
| `documents_select` | SELECT | `workspace_id = current_workspace_id() OR is_nowlabs_admin()` |
| `documents_insert` | INSERT | `workspace_id = current_workspace_id() OR is_nowlabs_admin()` |
| `documents_update` | UPDATE | `workspace_id = current_workspace_id() OR is_nowlabs_admin()` |
| `documents_delete` | DELETE | **`is_workspace_admin() AND workspace_id = current_workspace_id()`** OR `is_nowlabs_admin()` |

Resumen: los miembros del workspace pueden insertar/listar/leer sus documentos, pero el borrado requiere admin → por eso la API lo hace con `service_role` después de validar todo. Esto asegura paridad entre la fila y el objeto en Storage.

## Variables de entorno necesarias en el servidor

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (o `NEXT_PUBLIC_SUPABASE_ANON_KEY`)
- `SUPABASE_SERVICE_ROLE_KEY` — **requerida** para `DELETE` de documentos. Sin ella, la API responde 503.

## Validaciones obligatorias en API

Ver `src/app/api/clients/[id]/documents/route.ts` y `src/app/api/clients/[id]/documents/[docId]/route.ts`:

- Sesión autenticada por cookie (`auth.getUser()`).
- `profiles.workspace_id` resuelto y comparado con `clients.workspace_id`.
- `clients.id` y `clients.workspace_id` confirmados.
- Para `POST` upload:
  - `file.type` **no vacío** y en allowlist.
  - Extensión del nombre del archivo en allowlist y coherente con el MIME.
  - Tamaño ≤ 50 MB.
  - Filename sanitizado.
  - Path final = `${workspace_id}/clients/${client_id}/${timestamp}-${safeName}`.
- Para `GET` signed URL y `DELETE`:
  - `document.workspace_id === resolvedWorkspaceId`.
  - `document.client_id === clientId`.
  - `document.storage_bucket === 'client-files'`.
  - `document.storage_path.startsWith(\`${workspaceId}/clients/${clientId}/\`)`.
  - `document.storage_path` no contiene `..` ni empieza por `/`.

Si alguna validación falla, la respuesta es `403`/`400` sin generar signed URL ni borrar nada.

## Verification queries

```sql
-- Bucket
select id, name, public, file_size_limit, allowed_mime_types
from storage.buckets
where id = 'client-files';

-- Debe devolver SOLO: client_files_select_workspace,
-- client_files_insert_workspace, client_files_update_workspace.
-- NO debe aparecer client_files_delete_workspace.
select policyname, cmd, roles
from pg_policies
where schemaname = 'storage' and tablename = 'objects'
  and policyname like 'client_files_%'
order by policyname;

-- Documents policies
select policyname, cmd, qual::text as using_expr, with_check::text as check_expr
from pg_policies
where schemaname = 'public' and tablename = 'documents';
```
