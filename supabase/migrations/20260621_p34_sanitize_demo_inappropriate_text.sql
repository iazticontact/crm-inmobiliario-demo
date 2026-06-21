-- P3.4 — Sanitize junk/inappropriate test text typed into the DEMO workspace
-- (a calendar event + its activity had a non-commercial title/body and a junk
-- client name). DEMO workspace ONLY, targeted by row id so no inappropriate
-- string is reproduced in version control. UPDATE only (no deletes), idempotent
-- (re-running just re-applies the same clean values).
--
-- Already applied to the remote project via Supabase MCP (apply_migration
-- "sanitize_demo_inappropriate_text") on 2026-06-21. Verified afterwards: 0
-- inappropriate tokens remain in the demo workspace.
do $$
declare ws constant uuid := 'd0000000-0000-4000-8000-000000000001';
begin
  update public.calendar_events
     set title       = 'Visita a vivienda',
         description = 'Visita comercial programada',
         notes       = null,
         location    = null,
         client_name = null
   where id = '652ee397-81ac-4ca0-8fc1-ba5e4a4eb173' and workspace_id = ws;

  update public.activities
     set description = 'Nueva cita programada: Visita a vivienda',
         client_name = null
   where id = 'a1b6e2df-b45a-4ad8-bdf7-abcf7ea507d8' and workspace_id = ws;
end $$;
