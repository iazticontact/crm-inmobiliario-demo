-- P70 — GRANT mínimo para la UI agéntica: las policies RLS de SELECT ya existían para estas tablas,
-- pero faltaba el GRANT de tabla al rol authenticated, así que cualquier lectura con la sesión del
-- usuario fallaba en silencio (executeUiAction «No encuentro ese cambio», centro de findings vacío,
-- confirm textual P66 desde el navegador). Solo SELECT: todas las escrituras siguen siendo
-- server-to-server con service_role (/api/agent/action, /api/agent/automation).
-- Aplicada al proyecto real el 2026-07-14 (MCP apply_migration: p70_grant_authenticated_assistant_agentic_tables).

grant select on table public.assistant_actions to authenticated;
grant select on table public.assistant_findings to authenticated;
grant select on table public.assistant_automation_rules to authenticated;
grant select on table public.assistant_automation_runs to authenticated;
