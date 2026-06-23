-- Showcase only (Inmobiliaria Costa Azul): comisión pactada 3% en las operaciones del ejemplo
-- para demostrar "Comisión estimada". Ficticio, example-workspace-only, idempotente.
-- Aplicada vía MCP 2026-06-23.
UPDATE public.opportunities
SET commission_rate = 3
WHERE workspace_id = 'd0000000-0000-4000-8000-000000000001' AND commission_rate IS NULL;
