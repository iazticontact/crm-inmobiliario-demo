-- P7 — Relación estructural operación ↔ inmueble (antes solo en metadata.property_id).
-- Aplicada vía MCP el 2026-06-23. Idempotente.
ALTER TABLE public.opportunities ADD COLUMN IF NOT EXISTS property_id uuid;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'opportunities_property_id_fkey') THEN
    ALTER TABLE public.opportunities
      ADD CONSTRAINT opportunities_property_id_fkey
      FOREIGN KEY (property_id) REFERENCES public.properties(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS opportunities_property_id_idx ON public.opportunities(property_id);

-- Backfill genérico desde metadata.property_id (solo uuids válidos del mismo workspace).
UPDATE public.opportunities o
SET property_id = (o.metadata->>'property_id')::uuid
WHERE o.property_id IS NULL
  AND o.metadata->>'property_id' ~ '^[0-9a-fA-F-]{36}$'
  AND EXISTS (SELECT 1 FROM public.properties p
              WHERE p.id = (o.metadata->>'property_id')::uuid AND p.workspace_id = o.workspace_id);

-- Showcase only (Inmobiliaria Costa Azul): vincular operaciones a su inmueble por ids de seed.
UPDATE public.opportunities o SET property_id = m.pid
FROM (VALUES
  ('d3000000-0000-4000-8000-000000000001'::uuid,'d2000000-0000-4000-8000-000000000001'::uuid),
  ('d3000000-0000-4000-8000-000000000008'::uuid,'d2000000-0000-4000-8000-000000000001'::uuid),
  ('d3000000-0000-4000-8000-000000000004'::uuid,'d2000000-0000-4000-8000-000000000003'::uuid),
  ('d3000000-0000-4000-8000-000000000006'::uuid,'d2000000-0000-4000-8000-000000000005'::uuid),
  ('d3000000-0000-4000-8000-000000000007'::uuid,'d2000000-0000-4000-8000-000000000006'::uuid),
  ('d3000000-0000-4000-8000-000000000003'::uuid,'d2000000-0000-4000-8000-000000000002'::uuid),
  ('d3000000-0000-4000-8000-000000000002'::uuid,'d2000000-0000-4000-8000-000000000004'::uuid)
) AS m(oid, pid)
WHERE o.id = m.oid AND o.workspace_id = 'd0000000-0000-4000-8000-000000000001' AND o.property_id IS NULL;
