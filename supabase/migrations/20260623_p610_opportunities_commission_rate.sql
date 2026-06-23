-- P6.10 — Comisión pactada de la operación (%). Aditivo y nullable; no toca datos existentes.
-- El importe de comisión se calcula en el frontend (precio del inmueble vinculado o, en su
-- defecto, valor potencial × rate/100). NO es facturación. RLS de opportunities ya cubre la
-- columna (row-level). Aplicada vía MCP 2026-06-23. Rollback: DROP COLUMN commission_rate.
ALTER TABLE public.opportunities ADD COLUMN IF NOT EXISTS commission_rate numeric;
