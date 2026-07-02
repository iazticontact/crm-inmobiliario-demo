-- P36E — Eliminación definitiva controlada + inclusión/exclusión del resumen financiero
-- ---------------------------------------------------------------------------
-- Aplicada en producción (ylhdbawrllqygfvllhdo) vía migración `p36e_invoices_purge_and_accounting`.
--
-- purged_at (timestamptz, null):
--   "Eliminada definitivamente de la gestión". La factura se oculta de TODOS los listados y de la Papelera,
--   pero la fila se CONSERVA para no romper la trazabilidad fiscal ni la numeración. Se usa para las
--   facturas EMITIDAS/ENVIADAS/PAGADAS/CANCELADAS (los BORRADORES sí se borran de verdad con hard delete,
--   permitido por la RLS `invoices_delete` = admin + draft).
--
-- accounting_excluded (boolean, default false):
--   Excluir/incluir la factura en el RESUMEN financiero. Reversible mientras no esté purgada; en el momento
--   de purgar se fija según la decisión del usuario ("excluir del resumen" = true, "mantener como registro
--   histórico" = false → sigue contando). Por defecto una factura cuenta (false).
--
-- No se cambian políticas RLS: SELECT ya es workspace-scoped (P36D) y la app filtra purged_at is null en los
-- listados; UPDATE (mover a papelera/restaurar/purgar/excluir) sigue en owner/admin/comercial; DELETE
-- (hard delete real) sigue en admin + draft.

alter table public.invoices
  add column if not exists purged_at timestamptz,
  add column if not exists accounting_excluded boolean not null default false;

create index if not exists invoices_purged_idx on public.invoices (workspace_id, purged_at);
