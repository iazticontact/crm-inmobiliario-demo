-- P8 — Calendario premium.
--   1) Ampliar el CHECK de calendar_events.type a tipos inmobiliarios (superset: no rompe los
--      valores antiguos ni lo que escribe el Agente). Añade visit/signing/valuation/other.
--   2) Refrescar el seed del workspace de EJEMPLO: reanclar eventos/tareas a la semana actual y
--      migrar el tipo legacy 'demo' -> 'visit'. Acotado al ejemplo, idempotente, sin PII.

-- 1) CHECK ampliado (aditivo). Mantiene 'demo' por compatibilidad con datos/agente existentes.
alter table public.calendar_events drop constraint if exists calendar_events_type_check;
alter table public.calendar_events add constraint calendar_events_type_check
  check (type = any (array[
    'visit','call','meeting','follow-up','signing','valuation','other','demo'
  ]::text[]));

-- 2a) Eventos de ejemplo: reanclar a la semana actual + 'demo' -> 'visit'.
with base as (
  select min(date) as mind
  from public.calendar_events
  where workspace_id = 'd0000000-0000-4000-8000-000000000001'
)
update public.calendar_events e
set
  date     = e.date + (date_trunc('week', current_date)::date - (select mind from base)),
  start_at = case when e.start_at is not null then e.start_at + make_interval(days => (date_trunc('week', current_date)::date - (select mind from base))) else e.start_at end,
  end_at   = case when e.end_at  is not null then e.end_at  + make_interval(days => (date_trunc('week', current_date)::date - (select mind from base))) else e.end_at  end,
  type     = case when e.type = 'demo' then 'visit' else e.type end,
  updated_at = now()
where e.workspace_id = 'd0000000-0000-4000-8000-000000000001'
  and (select mind from base) is not null;

-- 2b) Tareas de ejemplo: reanclar para que la más reciente venza mañana (resto hacia atrás).
update public.tasks t
set
  due_date   = t.due_date + (current_date + 1 - (select max(due_date) from public.tasks where workspace_id = 'd0000000-0000-4000-8000-000000000001' and due_date is not null)),
  updated_at = now()
where t.workspace_id = 'd0000000-0000-4000-8000-000000000001'
  and t.due_date is not null;
