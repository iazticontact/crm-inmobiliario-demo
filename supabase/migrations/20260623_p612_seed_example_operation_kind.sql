-- P6.12 — Coherencia de datos de ejemplo para el modelo de 5 estados comerciales.
-- Aditivo, reversible y acotado al workspace de ejemplo. NO toca esquema ni datos reales.
--   1) Rellena metadata.operation_kind (Venta/Alquiler/Inversión) en las operaciones de ejemplo,
--      derivándolo del inmueble vinculado cuando existe, para que la etiqueta final
--      "Vendida / Alquilada" y el "tipo de operación" en Comisiones sean coherentes.
--   2) Marca como vendido el inmueble de una operación ya ganada que había quedado "publicado"
--      (una operación cerrada no debe dejar su inmueble en la lista de activos).

-- 1) operation_kind desde el inmueble vinculado (venta/alquiler), sin pisar valores existentes.
update public.opportunities o
set metadata = coalesce(o.metadata, '{}'::jsonb)
             || jsonb_build_object('operation_kind', p.operation_type)
from public.properties p
where o.property_id = p.id
  and o.workspace_id = 'd0000000-0000-4000-8000-000000000001'
  and (o.metadata ->> 'operation_kind') is null
  and p.operation_type in ('venta', 'alquiler');

-- 1b) Operación de inversión sin inmueble vinculado ("Cartera de inversión Atlántico").
update public.opportunities
set metadata = coalesce(metadata, '{}'::jsonb)
             || jsonb_build_object('operation_kind', 'inversion')
where workspace_id = 'd0000000-0000-4000-8000-000000000001'
  and property_id is null
  and (metadata ->> 'operation_kind') is null;

-- 2) Inmueble de una operación ya ganada que seguía "listed" → debe constar como vendido.
update public.properties p
set status = 'sold'
where p.workspace_id = 'd0000000-0000-4000-8000-000000000001'
  and p.status = 'listed'
  and exists (
    select 1 from public.opportunities o
    where o.property_id = p.id
      and o.workspace_id = p.workspace_id
      and o.stage = 'won'
  );
