-- =============================================================================
-- client-files — bucket + storage.objects policies (aplicado en costadelsol-crm)
-- =============================================================================
-- Source of truth: este fichero refleja lo aplicado por MCP el 2026-05-22.
-- Para volver a aplicar idempotentemente, ejecuta desde Supabase SQL editor.
--
-- IMPORTANTE: los usuarios NO borran objetos directamente desde Storage.
-- El borrado pasa por la API server-side `/api/clients/[id]/documents/[docId]`
-- usando SUPABASE_SERVICE_ROLE_KEY para borrar atómicamente la fila
-- `public.documents` y el objeto en `storage.objects`. Por eso aquí solo
-- definimos policies SELECT/INSERT/UPDATE para `authenticated`.
-- =============================================================================

-- Bucket (privado, 50 MB, allowlist MIME). Si el bucket ya existe, actualizamos
-- los settings para mantener los invariantes de seguridad (no quedarse en un
-- estado intermedio si alguien lo creó público o sin limit).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'client-files',
  'client-files',
  false,
  52428800,
  array[
    'application/pdf',
    'image/png',
    'image/jpeg',
    'image/webp',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain',
    'text/csv'
  ]
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Path convention: {workspace_id}/clients/{client_id}/{timestamp-filename}
-- Las policies validan que el primer segmento del path coincide con el
-- workspace_id del profile del usuario autenticado.

drop policy if exists "client_files_select_workspace" on storage.objects;
drop policy if exists "client_files_insert_workspace" on storage.objects;
drop policy if exists "client_files_update_workspace" on storage.objects;
-- DELETE directo desactivado a propósito (ver comentario superior).
-- Se elimina por si quedó de versiones previas.
drop policy if exists "client_files_delete_workspace" on storage.objects;

create policy "client_files_select_workspace"
on storage.objects for select
to authenticated
using (
  bucket_id = 'client-files'
  and exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.workspace_id::text = split_part(name, '/', 1)
  )
);

create policy "client_files_insert_workspace"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'client-files'
  and exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.workspace_id::text = split_part(name, '/', 1)
  )
);

create policy "client_files_update_workspace"
on storage.objects for update
to authenticated
using (
  bucket_id = 'client-files'
  and exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.workspace_id::text = split_part(name, '/', 1)
  )
)
with check (
  bucket_id = 'client-files'
  and exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.workspace_id::text = split_part(name, '/', 1)
  )
);

-- IMPORTANTE: no se crea policy DELETE para `authenticated` en `client-files`.
-- Storage rechazará cualquier DELETE directo desde el browser (Supabase JS
-- con cookie de usuario, REST con anon/publishable key, etc.). El service_role
-- sí puede borrar porque bypassea RLS, y solo lo usamos server-side desde
-- `/api/clients/[id]/documents/[docId]` después de validar workspace+client+path.

-- =============================================================================
-- Verification
-- =============================================================================
-- select id, name, public, file_size_limit, allowed_mime_types
-- from storage.buckets
-- where id = 'client-files';
--
-- -- Debe devolver exactamente: client_files_select_workspace,
-- -- client_files_insert_workspace, client_files_update_workspace.
-- -- NO debe aparecer client_files_delete_workspace.
-- select policyname, cmd, roles
-- from pg_policies
-- where schemaname = 'storage' and tablename = 'objects'
--   and policyname like 'client_files_%'
-- order by policyname;
