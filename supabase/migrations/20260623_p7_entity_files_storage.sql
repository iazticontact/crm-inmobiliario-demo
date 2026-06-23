-- P7 — Sistema unificado de archivos por entidad (fotos de inmueble primero; documentos después).
-- Aplicada vía MCP el 2026-06-23. Idempotente. Sin service_role: el frontend usa el cliente
-- autenticado y la RLS (tabla + storage.objects) garantiza el aislamiento por workspace.
create table if not exists public.entity_files (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  entity_type  text not null check (entity_type in ('property','client','opportunity','service_case')),
  entity_id    uuid not null,
  category     text not null default 'document' check (category in ('image','document')),
  bucket       text not null default 'entity-files',
  path         text not null unique,
  file_name    text not null,
  mime_type    text,
  size_bytes   bigint,
  is_cover     boolean not null default false,
  sort_order   integer not null default 0,
  caption      text,
  uploaded_by  uuid,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  metadata     jsonb
);
create index if not exists entity_files_entity_idx on public.entity_files(workspace_id, entity_type, entity_id);

alter table public.entity_files enable row level security;

drop policy if exists entity_files_select on public.entity_files;
create policy entity_files_select on public.entity_files for select
  using (workspace_id in (select current_workspace_ids()));

drop policy if exists entity_files_insert on public.entity_files;
create policy entity_files_insert on public.entity_files for insert
  with check (current_workspace_role(workspace_id) = any (array['owner','admin','comercial']));

drop policy if exists entity_files_update on public.entity_files;
create policy entity_files_update on public.entity_files for update
  using (current_workspace_role(workspace_id) = any (array['owner','admin','comercial']))
  with check (current_workspace_role(workspace_id) = any (array['owner','admin','comercial']));

drop policy if exists entity_files_delete on public.entity_files;
create policy entity_files_delete on public.entity_files for delete
  using (current_workspace_role(workspace_id) = any (array['owner','admin','comercial']));

-- Bucket privado (10 MB; imágenes + PDF).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('entity-files','entity-files', false, 10485760,
        array['image/jpeg','image/png','image/webp','image/gif','application/pdf'])
on conflict (id) do nothing;

-- Storage RLS — aislamiento por workspace vía primer segmento del path (workspace_id/...).
drop policy if exists entity_files_obj_select on storage.objects;
create policy entity_files_obj_select on storage.objects for select
  using (bucket_id = 'entity-files' and (storage.foldername(name))[1] in (select current_workspace_ids()::text));

drop policy if exists entity_files_obj_insert on storage.objects;
create policy entity_files_obj_insert on storage.objects for insert
  with check (bucket_id = 'entity-files' and (storage.foldername(name))[1] in (select current_workspace_ids()::text));

drop policy if exists entity_files_obj_update on storage.objects;
create policy entity_files_obj_update on storage.objects for update
  using (bucket_id = 'entity-files' and (storage.foldername(name))[1] in (select current_workspace_ids()::text));

drop policy if exists entity_files_obj_delete on storage.objects;
create policy entity_files_obj_delete on storage.objects for delete
  using (bucket_id = 'entity-files' and (storage.foldername(name))[1] in (select current_workspace_ids()::text));
