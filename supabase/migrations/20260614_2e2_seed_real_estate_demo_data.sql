-- ============================================================================
-- Fase 2E-2 - Seed demo inmobiliario (SOLO datos del workspace demo)
-- ----------------------------------------------------------------------------
-- Puebla el workspace demo con datos profesionales FICTICIOS y coherentes entre
-- si (clientes <-> inmuebles <-> oportunidades <-> expedientes <-> tareas <->
-- agenda <-> actividad). Espejo del modo demo offline (mismos nombres).
--
-- Reglas:
--   * workspace_id fijo: d0000000-0000-4000-8000-000000000001
--   * UUIDs fijos por entidad (d1..=clients, d2..=properties, d3..=opportunities,
--     d4..=service_cases, d5..=tasks, d6..=calendar_events, d7..=activities)
--   * idempotente: on conflict (id) do nothing
--   * emails @example.com, telefonos inventados (+34 600 1xx 2xx). Sin datos reales.
--   * NO toca auth.users / profiles / workspace_members.
--   * assigned_to / created_by quedan NULL (no se incrusta ningun UUID real).
--   * fechas de agenda/actividad relativas a now() -> la demo siempre luce viva.
--
-- NO EJECUTAR contra proyectos legacy. Solo crm-inmobiliario-demo
-- (ref ylhdbawrllqygfvllhdo). Requiere 20260614_2e2_core_crm_tables.sql aplicada.
-- ============================================================================

-- Guarda: el workspace demo debe existir.
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

-- ---- properties (7) --------------------------------------------------------
-- client_id = propietario/vendedor cuando aplica (captaciones); resto null (cartera agencia).
insert into public.properties (id, workspace_id, client_id, title, reference, property_type, operation_type, status, city, area, address, price, currency, bedrooms, bathrooms, area_m2, owner_name) values
  ('d2000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000003','Piso Calle Mayor 14','REF-001','piso','venta','available','Valencia','Centro','Calle Mayor 14',285000,'EUR',3,2,98,'Familia Soler'),
  ('d2000000-0000-4000-8000-000000000002','d0000000-0000-4000-8000-000000000001',null,'Atico Plaza Espana','REF-002','atico','venta','available','Valencia','Plaza Espana','Plaza Espana 5',420000,'EUR',2,2,85,null),
  ('d2000000-0000-4000-8000-000000000003','d0000000-0000-4000-8000-000000000001',null,'Chalet Urbanizacion Los Robles','REF-003','chalet','venta','reserved','Paterna','Los Robles','Urb. Los Robles 22',560000,'EUR',5,4,320,null),
  ('d2000000-0000-4000-8000-000000000004','d0000000-0000-4000-8000-000000000001',null,'Obra nueva - Promocion Marina','REF-004','piso','venta','available','Valencia','Marina','Av. Marina 100',245000,'EUR',2,2,76,null),
  ('d2000000-0000-4000-8000-000000000005','d0000000-0000-4000-8000-000000000001',null,'Local comercial Centro','REF-005','local','alquiler','available','Valencia','Centro','Calle Colon 30',1200,'EUR',null,1,140,null),
  ('d2000000-0000-4000-8000-000000000006','d0000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000007','Adosado Las Encinas','REF-006','adosado','venta','available','Torrent','Las Encinas','Calle Encina 7',390000,'EUR',4,3,210,'Carmen Lozano'),
  ('d2000000-0000-4000-8000-000000000007','d0000000-0000-4000-8000-000000000001',null,'Piso Av. del Puerto 8','REF-007','piso','alquiler','available','Valencia','El Grao','Av. del Puerto 8',1100,'EUR',2,1,70,null)
on conflict (id) do nothing;

-- ---- opportunities (7) -----------------------------------------------------
-- pipeline 'ventas'; stage real estate: captacion/cualificacion/visita/propuesta/negociacion/reserva.
insert into public.opportunities (id, workspace_id, client_id, property_id, title, vertical, pipeline, stage, status, value, probability, currency, source, expected_close_date, notes) values
  ('d3000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000003','d2000000-0000-4000-8000-000000000001','Venta piso Calle Mayor 14','real_estate','ventas','visita','open',285000,60,'EUR','whatsapp',(current_date + 30),'Visita confirmada con interesados; vendedores motivados.'),
  ('d3000000-0000-4000-8000-000000000002','d0000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000002','d2000000-0000-4000-8000-000000000004','Compra obra nueva Promocion Marina','real_estate','ventas','propuesta','open',245000,40,'EUR','web',(current_date + 45),'Enviada ficha y precios de la promocion.'),
  ('d3000000-0000-4000-8000-000000000003','d0000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000004','d2000000-0000-4000-8000-000000000002','Inversion atico Plaza Espana','real_estate','ventas','negociacion','open',420000,55,'EUR','email',(current_date + 25),'Revision de rentabilidad pendiente con el cliente.'),
  ('d3000000-0000-4000-8000-000000000004','d0000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000005','d2000000-0000-4000-8000-000000000003','Compra chalet Los Robles','real_estate','ventas','reserva','open',560000,75,'EUR','instagram',(current_date + 20),'Reserva en marcha; gestionando financiacion al 80%.'),
  ('d3000000-0000-4000-8000-000000000005','d0000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000006',null,'Cartera de inversion Atlantico','real_estate','ventas','cualificacion','open',900000,30,'EUR','web',(current_date + 60),'Fondo evaluando varios activos; due diligence inicial.'),
  ('d3000000-0000-4000-8000-000000000006','d0000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000008','d2000000-0000-4000-8000-000000000005','Alquiler local comercial Centro','real_estate','ventas','visita','open',14400,35,'EUR','web',(current_date + 35),'Renta anual estimada; pendiente visita.'),
  ('d3000000-0000-4000-8000-000000000007','d0000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000007','d2000000-0000-4000-8000-000000000006','Venta adosado Las Encinas','real_estate','ventas','captacion','open',390000,50,'EUR','email',(current_date + 50),'Encargo de venta recien firmado; preparar publicacion.')
on conflict (id) do nothing;

-- ---- service_cases (5) -----------------------------------------------------
insert into public.service_cases (id, workspace_id, client_id, opportunity_id, property_id, case_type, vertical, title, status, priority, due_date, notes) values
  ('d4000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000003','d3000000-0000-4000-8000-000000000001','d2000000-0000-4000-8000-000000000001','compraventa','real_estate','Expediente venta Calle Mayor 14','en_curso','alta',(current_date + 30),'Recopilar nota simple y certificado energetico.'),
  ('d4000000-0000-4000-8000-000000000002','d0000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000005','d3000000-0000-4000-8000-000000000004','d2000000-0000-4000-8000-000000000003','financiacion','real_estate','Financiacion chalet Los Robles','en_curso','media',(current_date + 15),'Simulacion con entidad colaboradora al 80%.'),
  ('d4000000-0000-4000-8000-000000000003','d0000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000007','d3000000-0000-4000-8000-000000000007','d2000000-0000-4000-8000-000000000006','tasacion','real_estate','Tasacion adosado Las Encinas','pendiente','media',(current_date + 12),'Solicitar tasacion oficial para fijar precio.'),
  ('d4000000-0000-4000-8000-000000000004','d0000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000006','d3000000-0000-4000-8000-000000000005',null,'inversion','real_estate','Due diligence cartera Atlantico','pendiente','media',(current_date + 40),'Analisis de rentabilidad y estado legal de activos.'),
  ('d4000000-0000-4000-8000-000000000005','d0000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000008','d3000000-0000-4000-8000-000000000006','d2000000-0000-4000-8000-000000000005','alquiler','real_estate','Contrato alquiler local Centro','pendiente','baja',(current_date + 28),'Redactar contrato y condiciones del arrendamiento.')
on conflict (id) do nothing;

-- ---- tasks (10) ------------------------------------------------------------
insert into public.tasks (id, workspace_id, title, status, priority, due_date, client_id, client_name, property_id, opportunity_id, case_id) values
  ('d5000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-000000000001','Confirmar visita con Lucia Herrera','pending','alta',(current_date + 1),'d1000000-0000-4000-8000-000000000001','Lucia Herrera','d2000000-0000-4000-8000-000000000001','d3000000-0000-4000-8000-000000000001',null),
  ('d5000000-0000-4000-8000-000000000002','d0000000-0000-4000-8000-000000000001','Enviar ficha obra nueva a Marcos','pending','media',(current_date + 1),'d1000000-0000-4000-8000-000000000002','Marcos Beltran','d2000000-0000-4000-8000-000000000004','d3000000-0000-4000-8000-000000000002',null),
  ('d5000000-0000-4000-8000-000000000003','d0000000-0000-4000-8000-000000000001','Preparar dossier venta Calle Mayor','pending','alta',(current_date + 2),'d1000000-0000-4000-8000-000000000003','Familia Soler',null,null,'d4000000-0000-4000-8000-000000000001'),
  ('d5000000-0000-4000-8000-000000000004','d0000000-0000-4000-8000-000000000001','Revisar numeros del atico con Roberto','pending','alta',(current_date + 1),'d1000000-0000-4000-8000-000000000004','Roberto Diaz',null,'d3000000-0000-4000-8000-000000000003',null),
  ('d5000000-0000-4000-8000-000000000005','d0000000-0000-4000-8000-000000000001','Simulacion financiacion chalet','pending','media',(current_date + 3),'d1000000-0000-4000-8000-000000000005','Marta Vidal',null,'d3000000-0000-4000-8000-000000000004','d4000000-0000-4000-8000-000000000002'),
  ('d5000000-0000-4000-8000-000000000006','d0000000-0000-4000-8000-000000000001','Solicitar tasacion del adosado','pending','media',(current_date + 2),'d1000000-0000-4000-8000-000000000007','Carmen Lozano',null,null,'d4000000-0000-4000-8000-000000000003'),
  ('d5000000-0000-4000-8000-000000000007','d0000000-0000-4000-8000-000000000001','Recopilar documentacion inversion Atlantico','pending','baja',(current_date + 5),'d1000000-0000-4000-8000-000000000006','Inversiones Atlantico SL',null,null,'d4000000-0000-4000-8000-000000000004'),
  ('d5000000-0000-4000-8000-000000000008','d0000000-0000-4000-8000-000000000001','Redactar contrato alquiler del local','pending','media',(current_date + 4),'d1000000-0000-4000-8000-000000000008','David Iglesias',null,null,'d4000000-0000-4000-8000-000000000005'),
  ('d5000000-0000-4000-8000-000000000009','d0000000-0000-4000-8000-000000000001','Publicar piso Av. del Puerto en portales','pending','baja',(current_date + 2),null,null,'d2000000-0000-4000-8000-000000000007',null,null),
  ('d5000000-0000-4000-8000-000000000010','d0000000-0000-4000-8000-000000000001','Cerrar reserva del chalet Los Robles','done','alta',(current_date - 1),'d1000000-0000-4000-8000-000000000005','Marta Vidal',null,'d3000000-0000-4000-8000-000000000004',null)
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

-- ---- activities (14) - timeline reciente -----------------------------------
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
