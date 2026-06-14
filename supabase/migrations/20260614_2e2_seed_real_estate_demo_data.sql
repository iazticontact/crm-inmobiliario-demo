-- ============================================================================
-- Fase 2E-2 - Seed demo inmobiliario (SOLO datos del workspace demo)
-- Revisado en 2E-2R: vocabulario alineado al vertical real_estate del codigo
-- (vertical-templates.ts + demo-real-estate.ts), para que el board de pipeline,
-- los estados de propiedad/expediente y las prioridades rendericen igual que la
-- demo offline.
-- ----------------------------------------------------------------------------
--   * workspace_id fijo: d0000000-0000-4000-8000-000000000001
--   * UUIDs fijos por entidad (d1..=clients, d2..=properties, d3..=opportunities,
--     d4..=service_cases, d5..=tasks, d6..=calendar_events, d7..=activities)
--   * idempotente: on conflict (id) do nothing
--   * emails @example.com, telefonos inventados. Sin datos reales.
--   * NO toca auth.users / profiles / workspace_members.
--   * assigned_to / created_by = NULL (no se incrusta ningun UUID real).
--   * Vocabulario:
--       opportunities.stage IN (new,contacted,qualified,visit_scheduled,offer,
--                               negotiation,won,lost) ; pipeline='real_estate'
--       properties.status   IN (prospecting,listed,under_contract,sold)
--       service_cases.status IN (open,documentation_pending,in_review,...)
--       priority IN (low,normal,high) ; tasks.status IN (pending,done)
--       calendar_events.type IN (call,demo,meeting,follow-up)
--
-- NO EJECUTAR contra proyectos legacy. Solo crm-inmobiliario-demo
-- (ref ylhdbawrllqygfvllhdo). Requiere 20260614_2e2_core_crm_tables.sql aplicada.
-- ============================================================================

do $$
begin
  if not exists (select 1 from public.workspaces where id = 'd0000000-0000-4000-8000-000000000001') then
    raise exception 'Workspace demo d0000000-0000-4000-8000-000000000001 no existe. Aplica 2E-1 primero.';
  end if;
end $$;

-- ---- clients (8) -----------------------------------------------------------
insert into public.clients (id, workspace_id, name, company, email, phone, channel, status, lead_score, notes) values
  ('d1000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-000000000001','Lucia Herrera','Compradora - 3 dorm.','lucia.herrera@example.com','+34 600 101 201','whatsapp','active',90,'Busca piso de 3 dormitorios en zona centro.'),
  ('d1000000-0000-4000-8000-000000000002','d0000000-0000-4000-8000-000000000001','Marcos Beltran','Comprador - obra nueva','marcos.beltran@example.com','+34 600 102 202','web','lead',72,'Interesado en promocion de obra nueva.'),
  ('d1000000-0000-4000-8000-000000000003','d0000000-0000-4000-8000-000000000001','Familia Soler','Vendedores - piso','contacto.soler@example.com','+34 600 103 203','whatsapp','active',88,'Venden piso en Calle Mayor 14.'),
  ('d1000000-0000-4000-8000-000000000004','d0000000-0000-4000-8000-000000000001','Roberto Diaz','Inversor - atico','roberto.diaz@example.com','+34 600 104 204','email','active',95,'Inversor; analiza rentabilidad del atico de Plaza Espana.'),
  ('d1000000-0000-4000-8000-000000000005','d0000000-0000-4000-8000-000000000001','Marta Vidal','Compradora - chalet','marta.vidal@example.com','+34 600 105 205','instagram','lead',64,'Interesada en chalet en Los Robles; pregunta financiacion.'),
  ('d1000000-0000-4000-8000-000000000006','d0000000-0000-4000-8000-000000000001','Inversiones Atlantico SL','Inversor - cartera','contacto@inversiones-atlantico.example','+34 600 106 206','web','active',81,'Fondo; busca cartera de activos para rentabilidad.'),
  ('d1000000-0000-4000-8000-000000000007','d0000000-0000-4000-8000-000000000001','Carmen Lozano','Vendedora - adosado','carmen.lozano@example.com','+34 600 107 207','email','active',77,'Vende adosado en Las Encinas.'),
  ('d1000000-0000-4000-8000-000000000008','d0000000-0000-4000-8000-000000000001','David Iglesias','Comprador - local','david.iglesias@example.com','+34 600 108 208','web','lead',58,'Busca local comercial en el centro para alquiler.')
on conflict (id) do nothing;

-- ---- properties (7) - status IN (prospecting,listed,under_contract,sold) ----
-- metadata espejo {rooms,baths,m2} para compatibilidad con la UI demo actual.
insert into public.properties (id, workspace_id, client_id, title, reference, property_type, operation_type, status, city, area, address, price, currency, bedrooms, bathrooms, area_m2, owner_name, notes, metadata) values
  ('d2000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000003','Piso 3 dorm. - Calle Mayor 14','REF-001','piso','venta','listed','Valencia','Centro','Calle Mayor 14, 3B',285000,'EUR',3,2,98,'Familia Soler','98 m2, 2 banos, exterior. Listo para entrar.','{"rooms":3,"baths":2,"m2":98}'),
  ('d2000000-0000-4000-8000-000000000002','d0000000-0000-4000-8000-000000000001',null,'Atico con terraza - Plaza Espana 5','REF-002','atico','venta','listed','Valencia','Plaza Espana','Plaza Espana 5, atico',420000,'EUR',2,2,110,'Particular','110 m2 + 40 m2 terraza. Alta rentabilidad para alquiler.','{"rooms":2,"baths":2,"m2":110}'),
  ('d2000000-0000-4000-8000-000000000003','d0000000-0000-4000-8000-000000000001',null,'Chalet - Urbanizacion Los Robles','REF-003','chalet','venta','under_contract','Paterna','Los Robles','Urb. Los Robles 22',560000,'EUR',5,4,320,'Promociones Roble SL','320 m2, parcela 600 m2, piscina. Reserva firmada.','{"rooms":5,"baths":4,"m2":320}'),
  ('d2000000-0000-4000-8000-000000000004','d0000000-0000-4000-8000-000000000001',null,'Obra nueva - Promocion Marina','REF-004','piso','venta','listed','Valencia','Marina','Av. Marina 100',245000,'EUR',2,2,76,'Promotora Marina SL','Promocion de obra nueva, entrega proximo ano.','{"rooms":2,"baths":2,"m2":76}'),
  ('d2000000-0000-4000-8000-000000000005','d0000000-0000-4000-8000-000000000001',null,'Local comercial - Calle Colon 30','REF-005','local','alquiler','listed','Valencia','Centro','Calle Colon 30',1200,'EUR',null,1,140,'Inversiones Atlantico SL','140 m2 a pie de calle. Renta mensual.','{"m2":140}'),
  ('d2000000-0000-4000-8000-000000000006','d0000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000007','Adosado - Las Encinas','REF-006','adosado','venta','prospecting','Torrent','Las Encinas','Calle Encina 7',390000,'EUR',4,3,210,'Carmen Lozano','Captacion reciente. Pendiente reportaje fotografico.','{"rooms":4,"baths":3,"m2":210}'),
  ('d2000000-0000-4000-8000-000000000007','d0000000-0000-4000-8000-000000000001',null,'Piso - Av. del Puerto 8','REF-007','piso','alquiler','listed','Valencia','El Grao','Av. del Puerto 8',1100,'EUR',2,1,70,'Particular','70 m2, ideal alquiler larga estancia.','{"rooms":2,"baths":1,"m2":70}')
on conflict (id) do nothing;

-- ---- opportunities (7) - pipeline 'real_estate', stages reales --------------
insert into public.opportunities (id, workspace_id, client_id, property_id, title, vertical, pipeline, stage, value, probability, currency, source, expected_close_date, notes) values
  ('d3000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000003','d2000000-0000-4000-8000-000000000001','Venta piso Calle Mayor 14','real_estate','real_estate','visit_scheduled',285000,55,'EUR','whatsapp',(current_date + 30),'Visita confirmada con interesados; vendedores motivados.'),
  ('d3000000-0000-4000-8000-000000000002','d0000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000002','d2000000-0000-4000-8000-000000000004','Compra obra nueva Promocion Marina','real_estate','real_estate','qualified',245000,40,'EUR','web',(current_date + 45),'Enviada ficha y precios; financiacion preaprobada.'),
  ('d3000000-0000-4000-8000-000000000003','d0000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000004','d2000000-0000-4000-8000-000000000002','Inversion atico Plaza Espana','real_estate','real_estate','negotiation',420000,85,'EUR','email',(current_date + 25),'Negociando precio final; revision de rentabilidad.'),
  ('d3000000-0000-4000-8000-000000000004','d0000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000005','d2000000-0000-4000-8000-000000000003','Compra chalet Los Robles','real_estate','real_estate','offer',560000,70,'EUR','instagram',(current_date + 20),'Reserva firmada; gestionando financiacion al 80%.'),
  ('d3000000-0000-4000-8000-000000000005','d0000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000006',null,'Cartera de inversion Atlantico','real_estate','real_estate','qualified',900000,40,'EUR','web',(current_date + 60),'Fondo evaluando 2-3 activos; due diligence inicial.'),
  ('d3000000-0000-4000-8000-000000000006','d0000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000008','d2000000-0000-4000-8000-000000000005','Alquiler local comercial Centro','real_estate','real_estate','contacted',14400,20,'EUR','web',(current_date + 35),'Renta anual estimada; pendiente visita.'),
  ('d3000000-0000-4000-8000-000000000007','d0000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000007','d2000000-0000-4000-8000-000000000006','Venta adosado Las Encinas','real_estate','real_estate','new',390000,10,'EUR','email',(current_date + 50),'Encargo de venta recien firmado; preparar publicacion.')
on conflict (id) do nothing;

-- ---- service_cases (5) - status/priority/case_type del vocabulario demo -----
insert into public.service_cases (id, workspace_id, client_id, opportunity_id, property_id, case_type, vertical, title, status, priority, due_date, notes) values
  ('d4000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000003','d3000000-0000-4000-8000-000000000001','d2000000-0000-4000-8000-000000000001','Venta de vivienda','real_estate','Documentacion venta Calle Mayor 14','documentation_pending','high',(current_date + 30),'Faltan nota simple y certificado energetico.'),
  ('d4000000-0000-4000-8000-000000000002','d0000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000005','d3000000-0000-4000-8000-000000000004','d2000000-0000-4000-8000-000000000003','Financiacion / hipoteca','real_estate','Gestion hipoteca chalet Los Robles','in_review','normal',(current_date + 15),'Comparando ofertas con dos entidades al 80%.'),
  ('d4000000-0000-4000-8000-000000000003','d0000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000007','d3000000-0000-4000-8000-000000000007','d2000000-0000-4000-8000-000000000006','Tasacion','real_estate','Tasacion adosado Las Encinas','open','normal',(current_date + 12),'Tasador por asignar para fijar precio.'),
  ('d4000000-0000-4000-8000-000000000004','d0000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000006','d3000000-0000-4000-8000-000000000005',null,'Inversion','real_estate','Due diligence cartera Atlantico','open','normal',(current_date + 40),'Analisis de rentabilidad y estado legal de activos.'),
  ('d4000000-0000-4000-8000-000000000005','d0000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000008','d3000000-0000-4000-8000-000000000006','d2000000-0000-4000-8000-000000000005','Alquiler','real_estate','Contrato alquiler local Centro','open','low',(current_date + 28),'Redactar contrato y condiciones del arrendamiento.')
on conflict (id) do nothing;

-- ---- tasks (10) - priority IN (low,normal,high) ; status IN (pending,done) --
insert into public.tasks (id, workspace_id, title, status, priority, due_date, client_id, client_name, property_id, opportunity_id, case_id) values
  ('d5000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-000000000001','Confirmar visita con Lucia Herrera','pending','high',(current_date + 1),'d1000000-0000-4000-8000-000000000001','Lucia Herrera','d2000000-0000-4000-8000-000000000001','d3000000-0000-4000-8000-000000000001',null),
  ('d5000000-0000-4000-8000-000000000002','d0000000-0000-4000-8000-000000000001','Enviar ficha obra nueva a Marcos','pending','normal',(current_date + 1),'d1000000-0000-4000-8000-000000000002','Marcos Beltran','d2000000-0000-4000-8000-000000000004','d3000000-0000-4000-8000-000000000002',null),
  ('d5000000-0000-4000-8000-000000000003','d0000000-0000-4000-8000-000000000001','Preparar dossier venta Calle Mayor','pending','high',(current_date + 2),'d1000000-0000-4000-8000-000000000003','Familia Soler',null,null,'d4000000-0000-4000-8000-000000000001'),
  ('d5000000-0000-4000-8000-000000000004','d0000000-0000-4000-8000-000000000001','Revisar numeros del atico con Roberto','pending','high',(current_date + 1),'d1000000-0000-4000-8000-000000000004','Roberto Diaz',null,'d3000000-0000-4000-8000-000000000003',null),
  ('d5000000-0000-4000-8000-000000000005','d0000000-0000-4000-8000-000000000001','Simulacion financiacion chalet','pending','normal',(current_date + 3),'d1000000-0000-4000-8000-000000000005','Marta Vidal',null,'d3000000-0000-4000-8000-000000000004','d4000000-0000-4000-8000-000000000002'),
  ('d5000000-0000-4000-8000-000000000006','d0000000-0000-4000-8000-000000000001','Solicitar tasacion del adosado','pending','normal',(current_date + 2),'d1000000-0000-4000-8000-000000000007','Carmen Lozano',null,null,'d4000000-0000-4000-8000-000000000003'),
  ('d5000000-0000-4000-8000-000000000007','d0000000-0000-4000-8000-000000000001','Recopilar documentacion inversion Atlantico','pending','low',(current_date + 5),'d1000000-0000-4000-8000-000000000006','Inversiones Atlantico SL',null,null,'d4000000-0000-4000-8000-000000000004'),
  ('d5000000-0000-4000-8000-000000000008','d0000000-0000-4000-8000-000000000001','Redactar contrato alquiler del local','pending','normal',(current_date + 4),'d1000000-0000-4000-8000-000000000008','David Iglesias',null,null,'d4000000-0000-4000-8000-000000000005'),
  ('d5000000-0000-4000-8000-000000000009','d0000000-0000-4000-8000-000000000001','Publicar piso Av. del Puerto en portales','pending','low',(current_date + 2),null,null,'d2000000-0000-4000-8000-000000000007',null,null),
  ('d5000000-0000-4000-8000-000000000010','d0000000-0000-4000-8000-000000000001','Cerrar reserva del chalet Los Robles','done','high',(current_date - 1),'d1000000-0000-4000-8000-000000000005','Marta Vidal',null,'d3000000-0000-4000-8000-000000000004',null)
on conflict (id) do nothing;

-- ---- calendar_events (8) - fechas relativas a hoy --------------------------
insert into public.calendar_events
  (id, workspace_id, client_id, property_id, opportunity_id, title, type, date, start_hour, start_minute, duration, start_at, end_at, client_name, location, description)
values
  ('d6000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000001','d2000000-0000-4000-8000-000000000001','d3000000-0000-4000-8000-000000000001','Visita piso Calle Mayor 14','demo',(current_date + 1),18,0,60,((current_date + 1) + time '18:00')::timestamptz,((current_date + 1) + time '19:00')::timestamptz,'Lucia Herrera','Calle Mayor 14','Vivienda de 3 dormitorios'),
  ('d6000000-0000-4000-8000-000000000002','d0000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000002',null,'d3000000-0000-4000-8000-000000000002','Llamada de seguimiento','call',(current_date + 1),12,30,30,((current_date + 1) + time '12:30')::timestamptz,((current_date + 1) + time '13:00')::timestamptz,'Marcos Beltran',null,'Seguimiento obra nueva'),
  ('d6000000-0000-4000-8000-000000000003','d0000000-0000-4000-8000-000000000001',null,null,null,'Reunion interna equipo comercial','meeting',(current_date + 2),9,0,90,((current_date + 2) + time '09:00')::timestamptz,((current_date + 2) + time '10:30')::timestamptz,null,'Oficina','Revision de cartera y nuevos encargos'),
  ('d6000000-0000-4000-8000-000000000004','d0000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000003',null,'d3000000-0000-4000-8000-000000000001','Seguimiento Familia Soler','follow-up',(current_date + 2),11,0,45,((current_date + 2) + time '11:00')::timestamptz,((current_date + 2) + time '11:45')::timestamptz,'Familia Soler',null,'Estado de la venta'),
  ('d6000000-0000-4000-8000-000000000005','d0000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000004','d2000000-0000-4000-8000-000000000002','d3000000-0000-4000-8000-000000000003','Visita atico Plaza Espana','demo',(current_date + 3),17,0,60,((current_date + 3) + time '17:00')::timestamptz,((current_date + 3) + time '18:00')::timestamptz,'Roberto Diaz','Plaza Espana 5','Revision para inversion'),
  ('d6000000-0000-4000-8000-000000000006','d0000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000005','d2000000-0000-4000-8000-000000000003','d3000000-0000-4000-8000-000000000004','Firma de reserva - chalet Los Robles','meeting',(current_date + 4),10,0,90,((current_date + 4) + time '10:00')::timestamptz,((current_date + 4) + time '11:30')::timestamptz,'Marta Vidal','Urb. Los Robles 22','Firma de reserva'),
  ('d6000000-0000-4000-8000-000000000007','d0000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000006',null,'d3000000-0000-4000-8000-000000000005','Revision de propuesta de inversion','call',(current_date + 5),11,30,45,((current_date + 5) + time '11:30')::timestamptz,((current_date + 5) + time '12:15')::timestamptz,'Inversiones Atlantico SL',null,'Propuesta de cartera'),
  ('d6000000-0000-4000-8000-000000000008','d0000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000008','d2000000-0000-4000-8000-000000000005','d3000000-0000-4000-8000-000000000006','Visita local comercial Centro','demo',(current_date + 3),16,0,45,((current_date + 3) + time '16:00')::timestamptz,((current_date + 3) + time '16:45')::timestamptz,'David Iglesias','Calle Colon 30','Local en alquiler')
on conflict (id) do nothing;

-- ---- activities (14) - timeline reciente (type del vocabulario UI) ---------
insert into public.activities (id, workspace_id, type, title, description, client_id, client_name, entity_type, entity_id, metadata, created_at) values
  ('d7000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-000000000001','message','Consulta de financiacion respondida','La IA respondio una consulta de financiacion a Lucia Herrera.','d1000000-0000-4000-8000-000000000001','Lucia Herrera','client','d1000000-0000-4000-8000-000000000001','{"source":"nowlabs_agent"}',(now() - interval '22 minutes')),
  ('d7000000-0000-4000-8000-000000000002','d0000000-0000-4000-8000-000000000001','call','Llamada de seguimiento','Seguimiento con Marcos Beltran sobre la promocion de obra nueva.','d1000000-0000-4000-8000-000000000002','Marcos Beltran','client','d1000000-0000-4000-8000-000000000002','{"source":"ui_manual"}',(now() - interval '1 hour')),
  ('d7000000-0000-4000-8000-000000000003','d0000000-0000-4000-8000-000000000001','email','Ficha enviada','Ficha del piso de Av. del Puerto 8 enviada a interesados.',null,null,'property','d2000000-0000-4000-8000-000000000007','{"source":"ui_manual"}',(now() - interval '35 minutes')),
  ('d7000000-0000-4000-8000-000000000004','d0000000-0000-4000-8000-000000000001','note','Resumen de visita','La IA genero el resumen de la visita al atico de Plaza Espana.','d1000000-0000-4000-8000-000000000004','Roberto Diaz','client','d1000000-0000-4000-8000-000000000004','{"source":"nowlabs_agent"}',(now() - interval '2 hours')),
  ('d7000000-0000-4000-8000-000000000005','d0000000-0000-4000-8000-000000000001','message','Consulta de financiacion','Marta Vidal pregunta por la financiacion del chalet.','d1000000-0000-4000-8000-000000000005','Marta Vidal','client','d1000000-0000-4000-8000-000000000005','{"source":"ui_manual"}',(now() - interval '3 hours')),
  ('d7000000-0000-4000-8000-000000000006','d0000000-0000-4000-8000-000000000001','deal','Reserva en marcha','Reserva del chalet de Los Robles en proceso de firma.','d1000000-0000-4000-8000-000000000005','Marta Vidal','opportunity','d3000000-0000-4000-8000-000000000004','{"source":"ui_manual"}',(now() - interval '4 hours')),
  ('d7000000-0000-4000-8000-000000000007','d0000000-0000-4000-8000-000000000001','call','Segunda visita pendiente','Inversiones Atlantico solicita segunda visita de cartera.','d1000000-0000-4000-8000-000000000006','Inversiones Atlantico SL','client','d1000000-0000-4000-8000-000000000006','{"source":"ui_manual"}',(now() - interval '6 hours')),
  ('d7000000-0000-4000-8000-000000000008','d0000000-0000-4000-8000-000000000001','email','Propuesta enviada','Propuesta de la promocion enviada a Marcos Beltran.','d1000000-0000-4000-8000-000000000002','Marcos Beltran','opportunity','d3000000-0000-4000-8000-000000000002','{"source":"ui_manual"}',(now() - interval '8 hours')),
  ('d7000000-0000-4000-8000-000000000009','d0000000-0000-4000-8000-000000000001','note','Captacion firmada','Encargo de venta del adosado de Las Encinas firmado con Carmen Lozano.','d1000000-0000-4000-8000-000000000007','Carmen Lozano','opportunity','d3000000-0000-4000-8000-000000000007','{"source":"ui_manual"}',(now() - interval '1 day')),
  ('d7000000-0000-4000-8000-000000000010','d0000000-0000-4000-8000-000000000001','message','Interes en local comercial','David Iglesias interesado en el local del centro para alquiler.','d1000000-0000-4000-8000-000000000008','David Iglesias','client','d1000000-0000-4000-8000-000000000008','{"source":"ui_manual"}',(now() - interval '1 day 3 hours')),
  ('d7000000-0000-4000-8000-000000000011','d0000000-0000-4000-8000-000000000001','call','Visita confirmada','Confirmada la visita de Lucia al piso de Calle Mayor.','d1000000-0000-4000-8000-000000000001','Lucia Herrera','opportunity','d3000000-0000-4000-8000-000000000001','{"source":"ui_manual"}',(now() - interval '1 day 5 hours')),
  ('d7000000-0000-4000-8000-000000000012','d0000000-0000-4000-8000-000000000001','note','Due diligence iniciada','Iniciada la due diligence de la cartera de Inversiones Atlantico.','d1000000-0000-4000-8000-000000000006','Inversiones Atlantico SL','case','d4000000-0000-4000-8000-000000000004','{"source":"ui_manual"}',(now() - interval '2 days')),
  ('d7000000-0000-4000-8000-000000000013','d0000000-0000-4000-8000-000000000001','email','Recordatorio de visita','Recordatorio de la visita al atico enviado a Roberto Diaz.','d1000000-0000-4000-8000-000000000004','Roberto Diaz','event','d6000000-0000-4000-8000-000000000005','{"source":"nowlabs_agent"}',(now() - interval '2 days 4 hours')),
  ('d7000000-0000-4000-8000-000000000014','d0000000-0000-4000-8000-000000000001','deal','Encargo de venta','Familia Soler firma el encargo de venta del piso de Calle Mayor.','d1000000-0000-4000-8000-000000000003','Familia Soler','opportunity','d3000000-0000-4000-8000-000000000001','{"source":"ui_manual"}',(now() - interval '3 days'))
on conflict (id) do nothing;

-- ============================================================================
-- FIN seed 2E-2. No toca auth.users / profiles / workspace_members / Storage.
-- ============================================================================
