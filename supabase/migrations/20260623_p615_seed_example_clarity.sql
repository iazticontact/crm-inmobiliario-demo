-- P6.15 — Claridad del entorno de ejemplo (workspace ejemplo). Aditivo, idempotente y acotado.
-- NO toca esquema ni datos reales. Tres ajustes de showcase:
--   1) Renombrar la operación abstracta "Cartera de inversión Atlántico" por un caso inmobiliario
--      claro y reconocible.
--   2) Marcar la comisión del alquiler de ejemplo como "1 mensualidad" (commission_model=one_month):
--      el modelo de comisión de alquiler más habitual; evita el 3% sobre mensualidad (cifra absurda).
--   3) Poner una operación en estado "Reserva" para que el tablero muestre también ese estado.

-- 1) Operación de ejemplo más clara.
update public.opportunities
set title = 'Compra edificio para inversión — Ensanche'
where workspace_id = 'd0000000-0000-4000-8000-000000000001'
  and title = 'Cartera de inversion Atlantico';

-- 2) Comisión del alquiler de ejemplo = 1 mensualidad (modelo preparado para el módulo económico).
update public.opportunities o
set metadata = coalesce(o.metadata, '{}'::jsonb) || jsonb_build_object('commission_model', 'one_month')
from public.properties p
where o.property_id = p.id
  and o.workspace_id = 'd0000000-0000-4000-8000-000000000001'
  and p.operation_type = 'alquiler'
  and (o.metadata ->> 'commission_model') is null;

-- 3) Una operación en "Reserva" para enseñar ese estado (reserva de obra nueva).
update public.opportunities
set stage = 'reserved'
where workspace_id = 'd0000000-0000-4000-8000-000000000001'
  and title = 'Compra obra nueva Promocion Marina'
  and stage not in ('won', 'lost', 'reserved');
