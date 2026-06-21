-- P3.1 — Sanitize the only DEMO client that still carried real PII (the test
-- record the workspace owner had entered as a contact). DEMO workspace ONLY.
--
-- Already applied to the remote project via Supabase MCP (apply_migration
-- "sanitize_demo_workspace_pii") on 2026-06-21. Kept here for version control
-- and reproducibility. IDEMPOTENT and NON-DESTRUCTIVE (UPDATEs only; no deletes,
-- no auth/structure changes).
--
-- The original (real) values are NOT reproduced in this file on purpose, to
-- avoid committing real PII to version control: the old name is read DYNAMICALLY
-- from the live row at runtime, never hard-coded. Rollback, if ever needed:
-- restore the affected client (id a26d7a43-9cb7-4fdb-8a8c-9f9dbd49be82) from a
-- database backup.

do $$
declare
  ws       constant uuid := 'd0000000-0000-4000-8000-000000000001';
  cid      constant uuid := 'a26d7a43-9cb7-4fdb-8a8c-9f9dbd49be82';
  new_name constant text := 'Javier Ortega Ruiz';
  old_name text;
begin
  -- Read the current name dynamically (guard + lets us rename denormalised
  -- copies without hard-coding the real name). On an already-sanitized DB this
  -- is simply 'Javier Ortega Ruiz', so the whole block is a no-op (idempotent).
  select name into old_name from public.clients where id = cid and workspace_id = ws;
  if old_name is null then
    raise notice 'demo client not found in demo workspace; nothing to do';
    return;
  end if;

  update public.clients
     set name  = new_name,
         email = 'javier.ortega@example.com',
         phone = '+34 600 109 209',
         metadata = coalesce(metadata, '{}'::jsonb)
                    || jsonb_build_object('address', 'Calle Mayor 12, 3B',
                                          'document_id', '00000000T')
   where id = cid and workspace_id = ws;

  -- activities only carry a denormalised client_name (client_id is null), so we
  -- match by the dynamically read old_name.
  update public.activities
     set client_name = new_name,
         description = replace(coalesce(description, ''), old_name, new_name)
   where workspace_id = ws and client_name = old_name;

  update public.calendar_events
     set client_name = new_name
   where workspace_id = ws and client_id = cid;

  update public.assistant_agent_memory
     set label = new_name
   where workspace_id = ws and entity_id = cid;
end $$;
