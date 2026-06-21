-- P3.9B — Repair orphans + restore the EXAMPLE/showcase workspace (commercial
-- demo). EXAMPLE workspace ONLY (d0000000…). Idempotent (upsert / by id / on
-- conflict do nothing). No auth.users, no other workspaces, no PII real, no
-- truncate. The example workspace is renamed to look like a real agency.
--
-- Applied via Supabase MCP (apply_migration "p39b_repair_and_reseed_example_workspace")
-- on 2026-06-22. Restores the 3 clients deleted before P3.9A with their ORIGINAL
-- UUIDs (which reconnects the dangling assistant memory at a26d7a43…), reconnects
-- the orphan opportunity/tasks/events/case by their text, adds coherent
-- operations/tasks/activities, and removes the stale "Cliente eliminado…" feed
-- entries. Valid channels: web|whatsapp|instagram|email|crm.
do $$
declare
  ws  constant uuid := 'd0000000-0000-4000-8000-000000000001';
  c_lucia  constant uuid := 'd1000000-0000-4000-8000-000000000001';
  c_soler  constant uuid := 'd1000000-0000-4000-8000-000000000003';
  c_javier constant uuid := 'a26d7a43-9cb7-4fdb-8a8c-9f9dbd49be82';
begin
  update public.workspaces
     set name = 'Inmobiliaria Costa Azul', slug = 'inmobiliaria-costa-azul'
   where id = ws;

  insert into public.clients (id, workspace_id, name, company, email, phone, channel, status, lead_score, notes, metadata, created_at)
  values
    (c_lucia, ws, 'Lucía Herrera', null, 'lucia.herrera@example.com', '+34 600 101 201', 'whatsapp', 'active', 78,
       'Compradora de obra nueva. Visita programada del piso de Calle Mayor.',
       jsonb_build_object('client_type','comprador','city_area','Centro','preferred_area','Calle Mayor','budget','300000','source','WhatsApp','nationality','Española','preferred_language','Español'),
       now() - interval '20 days'),
    (c_soler, ws, 'Familia Soler', null, 'contacto.soler@example.com', '+34 600 103 203', 'web', 'active', 72,
       'Vendedores del piso de Calle Mayor 14. Encargo de venta firmado.',
       jsonb_build_object('client_type','vendedor','city_area','Centro','address','Calle Mayor 14','source','Portal','nationality','Española','preferred_language','Español'),
       now() - interval '25 days'),
    (c_javier, ws, 'Javier Ortega Ruiz', null, 'javier.ortega@example.com', '+34 600 109 209', 'crm', 'active', 65,
       'Inversor inmobiliario. Interesado en vivienda para alquiler.',
       jsonb_build_object('client_type','inversor','city_area','Bilbao','address','Calle Mayor 12, 3B','document_id','00000000T','source','Referido','nationality','Española','preferred_language','Español'),
       now() - interval '15 days')
  on conflict (id) do update set
    name = excluded.name, email = excluded.email, phone = excluded.phone, channel = excluded.channel,
    status = excluded.status, lead_score = excluded.lead_score, notes = excluded.notes, metadata = excluded.metadata,
    deleted_at = null;

  update public.opportunities  set client_id = c_soler  where workspace_id = ws and client_id is null and id = 'd3000000-0000-4000-8000-000000000001';
  update public.tasks          set client_id = c_lucia  where workspace_id = ws and client_id is null and id = 'd5000000-0000-4000-8000-000000000001';
  update public.tasks          set client_id = c_soler  where workspace_id = ws and client_id is null and id = 'd5000000-0000-4000-8000-000000000003';
  update public.calendar_events set client_id = c_javier where workspace_id = ws and client_id is null and id = 'cbfb969d-e2d5-40c6-95ca-e9dddd02c11a';
  update public.calendar_events set client_id = c_lucia  where workspace_id = ws and client_id is null and id = 'd6000000-0000-4000-8000-000000000001';
  update public.calendar_events set client_id = c_soler  where workspace_id = ws and client_id is null and id = 'd6000000-0000-4000-8000-000000000004';
  update public.service_cases   set client_id = c_soler  where workspace_id = ws and client_id is null and id = 'd4000000-0000-4000-8000-000000000001';

  insert into public.opportunities (id, workspace_id, client_id, title, vertical, pipeline, stage, value, probability, currency, source, created_at)
  values ('d3000000-0000-4000-8000-000000000008', ws, c_lucia, 'Compra piso Calle Mayor 14', 'real_estate', 'real_estate', 'visit_scheduled', 285000, 55, 'EUR', 'WhatsApp', now() - interval '12 days')
  on conflict (id) do nothing;

  insert into public.tasks (id, workspace_id, client_id, client_name, title, status, priority, due_date, created_at)
  values ('d5000000-0000-4000-8000-000000000011', ws, c_javier, 'Javier Ortega Ruiz', 'Preparar propuesta de inversión para Javier Ortega', 'pending', 'high', (now() + interval '2 days')::date, now() - interval '3 days')
  on conflict (id) do nothing;

  delete from public.activities where workspace_id = ws and id in (
    '566cadac-8db8-418c-afde-f31f1e585f4b',
    '4153dde5-6404-4b6f-9eb0-01187d8eece6',
    '69ffc13f-378d-474a-b06b-b7cf377252ff');

  insert into public.activities (id, workspace_id, type, description, client_id, client_name, created_at)
  values
    ('d7000000-0000-4000-8000-000000000015', ws, 'deal', 'Nuevo cliente creado: Familia Soler', c_soler, 'Familia Soler', now() - interval '25 days'),
    ('d7000000-0000-4000-8000-000000000016', ws, 'deal', 'Nuevo cliente creado: Lucía Herrera', c_lucia, 'Lucía Herrera', now() - interval '20 days'),
    ('d7000000-0000-4000-8000-000000000017', ws, 'note', 'Expediente abierto: documentación de la venta de Calle Mayor 14', c_soler, 'Familia Soler', now() - interval '6 days'),
    ('d7000000-0000-4000-8000-000000000018', ws, 'opportunity_updated', 'Operación actualizada: Compra piso Calle Mayor 14 · visita programada', c_lucia, 'Lucía Herrera', now() - interval '2 days'),
    ('d7000000-0000-4000-8000-000000000019', ws, 'note', 'Visita programada con Javier Ortega para valorar la inversión', c_javier, 'Javier Ortega Ruiz', now() - interval '1 days')
  on conflict (id) do nothing;
end $$;
