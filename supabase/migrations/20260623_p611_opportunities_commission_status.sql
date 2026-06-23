-- P6.11 — Control interno de comisiones (NO facturación fiscal). Aditivo, nullable, sin tocar
-- datos. commission_status: pendiente | cobrada (texto libre, ampliable). commission_paid_amount
-- = importe real cobrado (opcional). commission_paid_at = fecha de cobro. RLS de opportunities ya
-- cubre estas columnas (row-level). Aplicada vía MCP 2026-06-23. Rollback: DROP COLUMN de las tres.
ALTER TABLE public.opportunities
  ADD COLUMN IF NOT EXISTS commission_status text,
  ADD COLUMN IF NOT EXISTS commission_paid_amount numeric,
  ADD COLUMN IF NOT EXISTS commission_paid_at timestamptz;
