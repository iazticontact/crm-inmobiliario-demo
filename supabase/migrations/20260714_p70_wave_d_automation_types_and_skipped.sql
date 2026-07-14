-- P70 Wave D — catálogo completo de automatizaciones: amplía el CHECK de tipos (3 → 11 runners reales)
-- y añade el status 'skipped' a los runs (ventanas omitidas por la política de catch-up, auditables).
-- Aplicada al proyecto real el 2026-07-14 (MCP apply_migration: p70_wave_d_automation_types_and_skipped).

alter table public.assistant_automation_rules drop constraint assistant_automation_rules_type_check;
alter table public.assistant_automation_rules add constraint assistant_automation_rules_type_check
  check (type = any (array[
    'data_quality_watch','daily_executive_brief','overdue_tasks_watch',
    'morning_agenda_brief','upcoming_appointments_watch','case_deadline_watch',
    'portfolio_data_quality_watch','won_operation_reconciliation_watch','action_failure_watch',
    'stale_operations_watch','inactive_client_followup_watch'
  ]::text[]));

alter table public.assistant_automation_runs drop constraint assistant_automation_runs_status_check;
alter table public.assistant_automation_runs add constraint assistant_automation_runs_status_check
  check (status = any (array['running','success','partial','error','skipped_duplicate','skipped']::text[]));
