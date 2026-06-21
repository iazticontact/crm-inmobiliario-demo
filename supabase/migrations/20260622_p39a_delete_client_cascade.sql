-- P3.9A — Safe, atomic, workspace-scoped client delete with relational cleanup.
--
-- Applied to the remote project via Supabase MCP (apply_migration
-- "p39a_delete_client_cascade") on 2026-06-22.
--
-- SECURITY DEFINER (to remove related rows in one transaction) but GATED by an
-- explicit is_workspace_admin() check on the CALLER (auth.uid()): it can only
-- delete data inside the workspace the client belongs to, and only for an admin
-- of that workspace. Never touches auth.users/workspaces/profiles/members or any
-- other workspace. Properties are KEPT (an asset is not a "client trace") and
-- only unlinked. Returns the client name + the counts it removed.
create or replace function public.delete_client_cascade(p_client_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ws     uuid;
  v_name   text;
  v_counts jsonb;
begin
  select workspace_id, name into v_ws, v_name from public.clients where id = p_client_id;
  if v_ws is null then
    raise exception 'client_not_found' using errcode = 'P0002';
  end if;
  if not public.is_workspace_admin(v_ws) then
    raise exception 'not_workspace_admin' using errcode = '42501';
  end if;

  v_counts := jsonb_build_object(
    'opportunities',       (select count(*) from public.opportunities       where workspace_id = v_ws and client_id = p_client_id),
    'service_cases',       (select count(*) from public.service_cases       where workspace_id = v_ws and client_id = p_client_id),
    'tasks',               (select count(*) from public.tasks               where workspace_id = v_ws and client_id = p_client_id),
    'calendar_events',     (select count(*) from public.calendar_events     where workspace_id = v_ws and client_id = p_client_id),
    'activities',          (select count(*) from public.activities          where workspace_id = v_ws and client_id = p_client_id),
    'assistant_memories',  (select count(*) from public.assistant_agent_memory where workspace_id = v_ws and entity_id = p_client_id),
    'properties_unlinked', (select count(*) from public.properties          where workspace_id = v_ws and client_id = p_client_id)
  );

  delete from public.assistant_agent_memory where workspace_id = v_ws and entity_id  = p_client_id;
  delete from public.activities             where workspace_id = v_ws and client_id  = p_client_id;
  delete from public.tasks                  where workspace_id = v_ws and client_id  = p_client_id;
  delete from public.calendar_events        where workspace_id = v_ws and client_id  = p_client_id;
  delete from public.service_cases          where workspace_id = v_ws and client_id  = p_client_id;
  delete from public.opportunities          where workspace_id = v_ws and client_id  = p_client_id;
  update public.properties set client_id = null where workspace_id = v_ws and client_id = p_client_id;
  delete from public.clients where id = p_client_id and workspace_id = v_ws;

  return jsonb_build_object('client', v_name, 'workspace_id', v_ws, 'removed', v_counts);
end;
$$;

revoke all on function public.delete_client_cascade(uuid) from public;
revoke all on function public.delete_client_cascade(uuid) from anon;
grant execute on function public.delete_client_cascade(uuid) to authenticated;
