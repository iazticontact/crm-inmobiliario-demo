-- =====================================================================
-- P25 — Tabla workspace_settings (ajustes de empresa + logo P22)
-- =====================================================================
-- Aplicada el 2026-07-01 al proyecto ylhdbawrllqygfvllhdo vía MCP apply_migration
-- (migración: p25_create_workspace_settings).
--
-- CONTEXTO: src/lib/workspace-settings.ts y src/lib/company-logo.ts (P22)
-- consultan `public.workspace_settings`, que NO existía en esta BD (el esquema
-- vivo difiere de docs/supabase/costadelsol_schema_v1.sql). Efecto: el logo de
-- empresa y los ajustes de Empresa se veían un instante (UI optimista) pero no
-- persistían al recargar. Esta migración crea la tabla que el código ya espera.
--
-- Additivo y NO destructivo (create table if not exists + drop/create policy).
-- RLS alineada al patrón REAL de esta BD (no al del esquema canónico):
--   - lectura/escritura de miembros: workspace_id in (select current_workspace_ids())
--   - borrado: is_workspace_admin(workspace_id)
--   - trigger updated_at: public.set_updated_at() (ya existente)
-- =====================================================================

create table if not exists public.workspace_settings (
  id                  uuid primary key default gen_random_uuid(),
  workspace_id        uuid not null references public.workspaces(id) on delete cascade,
  vertical            text not null default 'general',
  business_name       text,
  default_language    text not null default 'es',
  timezone            text not null default 'Europe/Madrid',
  ai_tone             text not null default 'professional',
  auto_reply_enabled  boolean not null default false,
  metadata            jsonb not null default '{}'::jsonb,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint workspace_settings_workspace_unique unique (workspace_id)
);

alter table public.workspace_settings enable row level security;

drop trigger if exists trg_workspace_settings_updated_at on public.workspace_settings;
create trigger trg_workspace_settings_updated_at
before update on public.workspace_settings
for each row execute function public.set_updated_at();

drop policy if exists workspace_settings_select on public.workspace_settings;
create policy workspace_settings_select on public.workspace_settings
for select to authenticated
using (workspace_id in (select current_workspace_ids()));

drop policy if exists workspace_settings_insert on public.workspace_settings;
create policy workspace_settings_insert on public.workspace_settings
for insert to authenticated
with check (workspace_id in (select current_workspace_ids()));

drop policy if exists workspace_settings_update on public.workspace_settings;
create policy workspace_settings_update on public.workspace_settings
for update to authenticated
using (workspace_id in (select current_workspace_ids()))
with check (workspace_id in (select current_workspace_ids()));

drop policy if exists workspace_settings_delete on public.workspace_settings;
create policy workspace_settings_delete on public.workspace_settings
for delete to authenticated
using (is_workspace_admin(workspace_id));

grant select, insert, update, delete on public.workspace_settings to authenticated;

-- Verificación (esperado: 11 columnas, rls=true, 4 policies, 1 trigger):
-- select count(*) from information_schema.columns where table_name='workspace_settings';
