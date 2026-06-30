-- P20 — Bucket de fotos de perfil (APLICADO en producción vía Supabase MCP, migración
-- `p20_profile_avatars_bucket`). Se registra aquí para trazabilidad/versionado.
--
-- Bucket PÚBLICO (baja sensibilidad; patrón estándar de avatar público) con límite 2 MB y MIME
-- restringido a nivel de Storage. RLS: cada usuario solo gestiona SU carpeta {auth.uid()}/...; lectura
-- pública. NO usa service_role (la app sube con el cliente de navegador autenticado). La URL pública se
-- guarda en el user_metadata del propio usuario (auth.updateUser), sin migración de `profiles`.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('profile-avatars', 'profile-avatars', true, 2097152, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "profile_avatars_select" on storage.objects;
drop policy if exists "profile_avatars_insert" on storage.objects;
drop policy if exists "profile_avatars_update" on storage.objects;
drop policy if exists "profile_avatars_delete" on storage.objects;

create policy "profile_avatars_select" on storage.objects
  for select using (bucket_id = 'profile-avatars');
create policy "profile_avatars_insert" on storage.objects
  for insert with check (bucket_id = 'profile-avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "profile_avatars_update" on storage.objects
  for update using (bucket_id = 'profile-avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "profile_avatars_delete" on storage.objects
  for delete using (bucket_id = 'profile-avatars' and (storage.foldername(name))[1] = auth.uid()::text);
