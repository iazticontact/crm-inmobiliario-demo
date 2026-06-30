-- P22 — Bucket de logo de empresa (APLICADO en producción vía Supabase MCP, migración
-- `p22_company_logos_bucket`). Se registra aquí para trazabilidad/versionado.
--
-- Bucket PÚBLICO (lectura pública del logo) con límite 2 MB y MIME jpeg/png/webp (NO svg, por
-- seguridad). RLS: escritura SOLO para miembros del workspace (carpeta {workspace_id}/...), reutilizando
-- current_workspace_ids() como en `entity-files`. NO usa service_role. La URL pública se guarda en
-- `workspace_settings.metadata.company_logo_url` (sin migración de tabla). Distinto del avatar personal.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('company-logos', 'company-logos', true, 2097152, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "company_logos_select" on storage.objects;
drop policy if exists "company_logos_insert" on storage.objects;
drop policy if exists "company_logos_update" on storage.objects;
drop policy if exists "company_logos_delete" on storage.objects;

create policy "company_logos_select" on storage.objects
  for select using (bucket_id = 'company-logos');
create policy "company_logos_insert" on storage.objects
  for insert with check (bucket_id = 'company-logos' and (storage.foldername(name))[1] in (select (current_workspace_ids())::text));
create policy "company_logos_update" on storage.objects
  for update using (bucket_id = 'company-logos' and (storage.foldername(name))[1] in (select (current_workspace_ids())::text));
create policy "company_logos_delete" on storage.objects
  for delete using (bucket_id = 'company-logos' and (storage.foldername(name))[1] in (select (current_workspace_ids())::text));
