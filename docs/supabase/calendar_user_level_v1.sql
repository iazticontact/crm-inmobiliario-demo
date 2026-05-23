-- =============================================================================
-- calendar_user_level_v1.sql — Migración revisable (NO aplicar todavía).
-- =============================================================================
-- Objetivo:
--   Convertir public.google_calendar_connections a modelo user-level real.
--   Cada miembro del workspace conecta SU propio Google Calendar y los
--   tokens viven en una fila independiente por usuario.
--
-- Decisión de producto (Opción B, recomendada):
--   Las conexiones legacy (workspace-level, sin user_id atribuido) NO se
--   migran automáticamente. Las archivamos (status='disconnected',
--   refresh_token_enc=null, sync_enabled=false) y forzamos a cada usuario
--   a reconectar individualmente. Esto evita atribuirle a Patricia un
--   refresh_token que en realidad firmó Fran, o viceversa.
--
-- Diseño idempotente:
--   - Detección dinámica del nombre del constraint UNIQUE legacy
--     (no lo asumimos por nombre: lo buscamos en pg_constraint).
--   - Cada paso usa IF NOT EXISTS / IF EXISTS / EXCEPTION blocks donde
--     conviene, para que el script pueda re-ejecutarse sin romper.
--   - Ningún paso es destructivo silenciosamente. La limpieza de filas
--     legacy es explícita y documentada.
--   - NO añadimos referencias a auth.users(id); usamos profiles(id) por
--     coherencia con el resto del schema y con la cascada que ya existe
--     (auth.users → profiles.id ON DELETE CASCADE en costadelsol_schema_v1.sql).
--
-- Aplicar con el rol postgres (Supabase SQL Editor) para que la vista
-- recreada herede el owner correcto y los grants funcionen.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1) Añadir columna user_id (nullable durante la transición).
-- -----------------------------------------------------------------------------
alter table public.google_calendar_connections
  add column if not exists user_id uuid references public.profiles(id) on delete cascade;

comment on column public.google_calendar_connections.user_id is
  'Owner of this Google Calendar connection. NOT NULL once the user-level migration completes.';


-- -----------------------------------------------------------------------------
-- 2) Archivar filas legacy (user_id IS NULL).
--
--   Recomendado (Opción B): borrar refresh_token_enc y marcar disconnected.
--   Los miembros del workspace tendrán que reconectar individualmente.
--
--   La fila se conserva por auditoría (mismo workspace_id que tenía); el
--   paso 4 unique(workspace_id, user_id) permite coexistencia porque
--   NULL no participa en uniqueness en Postgres.
--
--   Si tu equipo quiere intentar Opción A (atribuir la fila legacy al
--   primer admin del workspace) sustituye este bloque por el commented-out
--   update de más abajo. NO usar A si no estás absolutamente seguro de
--   quién firmó el refresh_token.
-- -----------------------------------------------------------------------------
update public.google_calendar_connections
set
  status            = 'disconnected',
  refresh_token_enc = null,
  sync_enabled      = false,
  last_sync_at      = null,
  updated_at        = now()
where user_id is null
  and (refresh_token_enc is not null or status = 'connected');

-- Opción A (NO recomendado — comentado):
--   update public.google_calendar_connections gc
--   set user_id = (
--     select p.id from public.profiles p
--     where p.workspace_id = gc.workspace_id
--       and p.role in ('client_admin', 'nowlabs_admin')
--     order by p.created_at asc
--     limit 1
--   )
--   where user_id is null;


-- -----------------------------------------------------------------------------
-- 3) Borrar la(s) constraint(s) UNIQUE legacy sobre solo (workspace_id).
--
--   Detección dinámica: cualquier constraint UNIQUE/PK de la tabla cuyas
--   columnas sean exactamente {workspace_id} se elimina. No asumimos el
--   nombre (la v1 base lo llama google_calendar_connections_workspace_unique,
--   pero proyectos derivados podrían usar otro).
-- -----------------------------------------------------------------------------
do $$
declare
  rec record;
begin
  for rec in
    select c.conname
    from pg_constraint c
    where c.conrelid = 'public.google_calendar_connections'::regclass
      and c.contype in ('u', 'p')
      and (
        select array_agg(att.attname::text order by att.attname)
        from unnest(c.conkey) k
        join pg_attribute att on att.attrelid = c.conrelid and att.attnum = k
      ) = array['workspace_id']
  loop
    execute format('alter table public.google_calendar_connections drop constraint %I', rec.conname);
    raise notice 'Dropped legacy unique constraint: %', rec.conname;
  end loop;
end$$;


-- -----------------------------------------------------------------------------
-- 4) Crear el nuevo UNIQUE (workspace_id, user_id) si no existe ya.
-- -----------------------------------------------------------------------------
do $$
declare
  has_target_constraint boolean;
begin
  select exists (
    select 1
    from pg_constraint c
    where c.conrelid = 'public.google_calendar_connections'::regclass
      and c.contype = 'u'
      and (
        select array_agg(att.attname::text order by att.attname)
        from unnest(c.conkey) k
        join pg_attribute att on att.attrelid = c.conrelid and att.attnum = k
      ) = array['user_id', 'workspace_id']
  ) into has_target_constraint;

  if not has_target_constraint then
    alter table public.google_calendar_connections
      add constraint google_calendar_connections_workspace_user_unique
      unique (workspace_id, user_id);
  end if;
end$$;


-- -----------------------------------------------------------------------------
-- 5) (Opcional, posterior) Forzar NOT NULL.
--
--   ANTES de descomentar esto, verifica con la query #4 de la sección
--   "verification queries" que no quedan filas con user_id NULL. Si
--   quedan, primero hay que borrarlas o re-atribuirlas explícitamente —
--   en Opción B suelen ser cero porque las filas legacy ya están
--   archivadas pero su user_id sigue NULL (las dejamos así para auditoría).
--
--   Recomendación: dejar user_id nullable hasta que cada usuario que
--   necesita conectarse haya hecho OAuth. La nueva UNIQUE ya impide
--   colisiones con NULL (Postgres trata NULL como distinto).
--
--   Cuando quieras forzar:
--     alter table public.google_calendar_connections
--       alter column user_id set not null;
-- -----------------------------------------------------------------------------


-- -----------------------------------------------------------------------------
-- 6) Índices.
-- -----------------------------------------------------------------------------
create index if not exists idx_gcc_user_id
  on public.google_calendar_connections (user_id);
create index if not exists idx_gcc_workspace_user
  on public.google_calendar_connections (workspace_id, user_id);


-- -----------------------------------------------------------------------------
-- 7) Vista pública segura vw_google_calendar_status — proyección sin tokens,
--    scoped por usuario.
--
--   Reglas:
--     - El propietario (user_id = auth.uid()) ve su fila.
--     - workspace_admin del mismo workspace ve las filas del equipo (sin tokens).
--     - nowlabs_admin ve todas (cross-workspace).
--
--   Excluye refresh_token_enc, webhook_channel_id, webhook_resource_id e
--   incremental_sync_tokens — los mismos invariantes que la v1 base.
-- -----------------------------------------------------------------------------
drop view if exists public.vw_google_calendar_status;
create or replace view public.vw_google_calendar_status
with (security_invoker = false) as
select
  c.id,
  c.workspace_id,
  c.user_id,
  c.status,
  c.calendar_id,
  c.default_calendar_id,
  c.selected_calendar_ids,
  c.calendar_metadata,
  c.sync_enabled,
  c.last_sync_at,
  c.token_expiry,
  (c.refresh_token_enc is not null and length(c.refresh_token_enc) > 0) as has_refresh_token,
  c.webhook_expires_at,
  c.created_at,
  c.updated_at
from public.google_calendar_connections c
where
  c.user_id = auth.uid()
  or (
    c.workspace_id = public.current_workspace_id()
    and public.is_workspace_admin()
  )
  or public.is_nowlabs_admin();

comment on view public.vw_google_calendar_status is
  'Safe projection of google_calendar_connections. Excludes refresh_token_enc, webhook_channel_id, webhook_resource_id, incremental_sync_tokens. Owner sees own row; workspace_admin sees team; nowlabs_admin sees all.';

revoke all on public.vw_google_calendar_status from public;
revoke all on public.vw_google_calendar_status from anon;
grant select on public.vw_google_calendar_status to authenticated;


-- -----------------------------------------------------------------------------
-- 8) RLS sobre la base table: sin cambios — sigue admin-only desde
--    authenticated (la v1 base ya la deja así). El servidor escribe vía
--    service_role; los miembros leen la vista.
-- -----------------------------------------------------------------------------


-- =============================================================================
-- Verification queries (ejecutar manualmente en Supabase SQL Editor)
-- =============================================================================
--
-- 1) Confirmar que existe la columna user_id:
--   select column_name, data_type, is_nullable
--   from information_schema.columns
--   where table_schema = 'public'
--     and table_name = 'google_calendar_connections'
--     and column_name = 'user_id';
--
-- 2) Confirmar constraints (debe aparecer workspace_user_unique y NO un unique solo por workspace_id):
--   select tc.constraint_name, tc.constraint_type, kcu.column_name
--   from information_schema.table_constraints tc
--   left join information_schema.key_column_usage kcu
--     on tc.constraint_name = kcu.constraint_name
--    and tc.table_schema = kcu.table_schema
--   where tc.table_schema = 'public'
--     and tc.table_name = 'google_calendar_connections'
--   order by tc.constraint_name, kcu.ordinal_position;
--
-- 3) Confirmar índices:
--   select indexname, indexdef
--   from pg_indexes
--   where schemaname = 'public' and tablename = 'google_calendar_connections';
--
-- 4) Filas legacy:
--   select count(*) as legacy_null_user_id
--   from public.google_calendar_connections
--   where user_id is null;
--
-- 5) Duplicados potenciales (debe devolver 0 filas):
--   select workspace_id, user_id, count(*)
--   from public.google_calendar_connections
--   group by workspace_id, user_id
--   having count(*) > 1;
--
-- 6) Shape de la vista (debe incluir user_id; NO refresh_token_enc):
--   select column_name, data_type
--   from information_schema.columns
--   where table_schema = 'public'
--     and table_name = 'vw_google_calendar_status'
--   order by ordinal_position;
--
-- 7) Sanity: un authenticated solo ve su fila:
--   set local role authenticated;
--   select user_id, status, has_refresh_token
--   from public.vw_google_calendar_status
--   where workspace_id = '<workspace-id>';
--
-- 8) Grants base:
--   select grantee, privilege_type
--   from information_schema.role_table_grants
--   where table_schema='public' and table_name='google_calendar_connections';
