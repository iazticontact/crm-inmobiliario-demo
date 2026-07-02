-- P36F — Facturación en divisa: snapshot del tipo de cambio a EUR
-- ---------------------------------------------------------------------------
-- Aplicada en producción (ylhdbawrllqygfvllhdo) vía migración `p36f_invoices_exchange_rate`.
--
-- La factura y su PDF se expresan en su divisa original (currency, ya existente). El CRM usa EUR como moneda
-- base para el resumen financiero; por eso, cuando currency != EUR se guarda un SNAPSHOT del tipo de cambio:
--   · exchange_rate_to_eur (numeric): 1 unidad de la divisa = X EUR. Para EUR = 1 (o null).
--   · exchange_rate_source (text): origen ('Manual' por defecto; o el proveedor si se configura).
--   · exchange_rate_date (date): fecha del cambio aplicado.
-- El equivalente en EUR se calcula como total * exchange_rate_to_eur (no se suman divisas distintas sin
-- convertir). Orientativo para control interno; no es un cambio fiscal oficial.

alter table public.invoices
  add column if not exists exchange_rate_to_eur numeric,
  add column if not exists exchange_rate_source text,
  add column if not exists exchange_rate_date date;
