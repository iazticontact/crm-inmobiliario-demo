-- ============================================================================
-- Fase 2E-2 - Verificacion POST-APPLY (SOLO lectura, no modifica nada)
-- ----------------------------------------------------------------------------
-- Ejecutar en el SQL Editor (o via conector) DESPUES de aplicar:
--   20260614_2e2_core_crm_tables.sql  y  20260614_2e2_seed_real_estate_demo_data.sql
-- sobre el proyecto ylhdbawrllqygfvllhdo. Ninguna sentencia escribe datos.
-- Resultados esperados anotados en cada bloque.
-- ============================================================================

-- 0) Migraciones registradas (deben incluir las dos de 2E-2) -----------------
select version, name
from supabase_migrations.schema_migrations
where name like '%2e2%'
order by version;

-- 1) Tablas CRM presentes con RLS habilitada (esperado: las 7, todas true) ----
select c.relname as table, c.relrowsecurity as rls_enabled
from pg_class c
where c.relnamespace = 'public'::regnamespace
  and c.relname in ('clients','properties','opportunities','service_cases','tasks','calendar_events','activities')
order by c.relname;

-- 2) Conteo de filas por tabla (esperado seed: clients=8, properties=7,
--    opportunities=7, service_cases=5, tasks=10, calendar_events=8, activities=14)
select 'clients' as t, count(*) from public.clients
union all select 'properties', count(*) from public.properties
union all select 'opportunities', count(*) from public.opportunities
union all select 'service_cases', count(*) from public.service_cases
union all select 'tasks', count(*) from public.tasks
union all select 'calendar_events', count(*) from public.calendar_events
union all select 'activities', count(*) from public.activities
order by t;

-- 3) Policies por tabla (esperado: clients/properties/opportunities/service_cases
--    = 5 c/u [select, insert, update_admin, update_comercial, delete];
--    tasks/calendar_events = 4 [select, insert, update, delete]; activities = 3)
select tablename, count(*) as policies, array_agg(policyname order by policyname) as names
from pg_policies
where schemaname = 'public'
  and tablename in ('clients','properties','opportunities','service_cases','tasks','calendar_events','activities')
group by tablename
order by tablename;

-- 4) Triggers (updated_at en 6 tablas; member_refs en clients/opportunities/
--    service_cases/tasks; NINGUN updated_at en activities) -------------------
select event_object_table as table, trigger_name, action_timing, string_agg(event_manipulation, ',') as events
from information_schema.triggers
where trigger_schema = 'public'
  and event_object_table in ('clients','properties','opportunities','service_cases','tasks','calendar_events','activities')
group by event_object_table, trigger_name, action_timing
order by event_object_table, trigger_name;

-- 5) Helper de integridad presente y blindado (secdef true, search_path='',
--    sin EXECUTE para anon) -------------------------------------------------
select p.proname, p.prosecdef as security_definer, p.proconfig,
       (select array_agg(a::text) from unnest(coalesce(p.proacl, acldefault('f', p.proowner))) a) as acl
from pg_proc p
where p.pronamespace = 'public'::regnamespace and p.proname = 'enforce_member_refs';

-- 6) Todas las filas seed pertenecen al workspace demo (esperado: 0 fuera) ----
select 'clients' as t, count(*) as fuera_demo from public.clients where workspace_id <> 'd0000000-0000-4000-8000-000000000001'
union all select 'properties', count(*) from public.properties where workspace_id <> 'd0000000-0000-4000-8000-000000000001'
union all select 'opportunities', count(*) from public.opportunities where workspace_id <> 'd0000000-0000-4000-8000-000000000001'
union all select 'service_cases', count(*) from public.service_cases where workspace_id <> 'd0000000-0000-4000-8000-000000000001'
union all select 'tasks', count(*) from public.tasks where workspace_id <> 'd0000000-0000-4000-8000-000000000001'
union all select 'calendar_events', count(*) from public.calendar_events where workspace_id <> 'd0000000-0000-4000-8000-000000000001'
union all select 'activities', count(*) from public.activities where workspace_id <> 'd0000000-0000-4000-8000-000000000001';

-- 7) Relaciones huerfanas (esperado: todas 0). Las FK lo impiden; doble check. -
select 'properties.client_id' as rel, count(*) as huerfanas
  from public.properties p left join public.clients c on c.id = p.client_id
  where p.client_id is not null and c.id is null
union all select 'opportunities.client_id', count(*)
  from public.opportunities o left join public.clients c on c.id = o.client_id
  where o.client_id is not null and c.id is null
union all select 'opportunities.property_id', count(*)
  from public.opportunities o left join public.properties p on p.id = o.property_id
  where o.property_id is not null and p.id is null
union all select 'service_cases.opportunity_id', count(*)
  from public.service_cases s left join public.opportunities o on o.id = s.opportunity_id
  where s.opportunity_id is not null and o.id is null
union all select 'tasks.case_id', count(*)
  from public.tasks t left join public.service_cases s on s.id = t.case_id
  where t.case_id is not null and s.id is null
union all select 'calendar_events.opportunity_id', count(*)
  from public.calendar_events e left join public.opportunities o on o.id = e.opportunity_id
  where e.opportunity_id is not null and o.id is null;

-- 8) Vocabulario del seed dentro de lo esperado (esperado: 0 filas "raras") ---
select 'opportunities.stage' as campo, count(*) as fuera_vocab
  from public.opportunities
  where stage is not null and stage not in ('new','contacted','qualified','visit_scheduled','offer','negotiation','won','lost')
union all select 'properties.status', count(*)
  from public.properties
  where status not in ('prospecting','listed','under_contract','sold')
union all select 'tasks.priority', count(*)
  from public.tasks
  where priority is not null and priority not in ('low','normal','high');

-- 9) Nucleo 2E-1 intacto (esperado: workspaces=1, auth.users=1, profiles=1,
--    workspace_members=1; owner = client_admin / owner) ---------------------
select
  (select count(*) from public.workspaces) as workspaces,
  (select count(*) from auth.users) as auth_users,
  (select count(*) from public.profiles) as profiles,
  (select count(*) from public.workspace_members) as members,
  (select p.role from public.profiles p limit 1) as profile_role,
  (select m.role from public.workspace_members m limit 1) as member_role;

-- 10) activities con entity_type/entity_id coherentes (informativo) ----------
select entity_type, count(*)
from public.activities
group by entity_type
order by entity_type;

-- ============================================================================
-- FIN verificacion. Nada de lo anterior modifica datos.
-- ============================================================================
