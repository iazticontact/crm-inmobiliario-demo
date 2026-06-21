-- P3.8 — Clean the DEMO activity feed: remove a throwaway test client's
-- create/delete activities (test noise typed during testing) and rephrase one
-- techy activity line into natural Spanish. DEMO workspace only, targeted by row
-- id (no junk name reproduced here), idempotent (delete = no-op on re-run; update
-- re-applies the same value). No auth.users, no other workspaces.
--
-- Already applied to the remote project via Supabase MCP (apply_migration
-- "sanitize_demo_activity_feed_p38") on 2026-06-21.
do $$
declare ws constant uuid := 'd0000000-0000-4000-8000-000000000001';
begin
  delete from public.activities
   where workspace_id = ws
     and id in ('3fe9c78b-2889-42d1-bc92-bfa21d4db6c3',
                '0c71792e-c080-43f7-882b-33e017e624e9');

  update public.activities
     set description = 'Operación en negociación · 390.000 €'
   where workspace_id = ws
     and id = '8081e830-f04c-4231-a9b8-96335506b8cc';
end $$;
