-- ============================================================================
-- Fase 2E-1 · Seed del workspace demo (SOLO datos, separado del schema)
-- ----------------------------------------------------------------------------
-- Inserta UNICAMENTE la fila del workspace demo base. Idempotente.
--
-- NO inserta en auth.users. NO crea usuarios reales. NO mete emails reales.
--
-- El usuario demo se creara a traves de Supabase Auth (signup/invite). Una vez
-- exista su auth.users.id, se vincula manualmente / via backend:
--   1) insert into public.profiles (id, workspace_id, email, full_name, role)
--        values (<auth_user_id>, '<WS_DEMO_ID>', '<email>', 'Demo Owner', 'client_admin');
--   2) insert into public.workspace_members (workspace_id, user_id, role)
--        values ('<WS_DEMO_ID>', <auth_user_id>, 'owner');
-- (paso 2 con service_role: es el bootstrap del primer owner, que las policies
--  de workspace_members no permiten al cliente por diseno).
--
-- NO EJECUTAR contra ningun proyecto legacy. Solo en el proyecto NUEVO.
-- ============================================================================

-- Id fijo y reconocible del workspace demo (UUID v4-shaped, todo hex).
-- WS_DEMO_ID = d0000000-0000-4000-8000-000000000001
insert into public.workspaces (id, name, slug, vertical, plan)
values (
  'd0000000-0000-4000-8000-000000000001',
  'Demo Inmobiliaria',
  'demo-inmobiliaria',
  'real_estate',
  'starter'
)
on conflict (id) do nothing;
