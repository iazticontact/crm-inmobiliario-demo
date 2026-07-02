-- P36D — Papelera de facturación (soft delete visible)
-- ---------------------------------------------------------------------------
-- La vista "Papelera" necesita LEER facturas soft-deleted (deleted_at not null). La política SELECT
-- anterior (p33) las ocultaba con `deleted_at is null`. Se relaja a "workspace scoped": sigue aislada por
-- workspace (RLS), pero ahora los miembros pueden ver también las facturas en papelera para restaurarlas.
--
-- NO se tocan las políticas INSERT/UPDATE/DELETE:
--   · UPDATE (mover a papelera / restaurar): permitido a owner/admin/comercial (política p33 vigente).
--   · DELETE (eliminar definitivamente): SOLO is_workspace_admin() y SOLO status='draft' (trazabilidad
--     fiscal: las facturas emitidas/pagadas/canceladas NO se pueden borrar de la base, solo archivar en
--     papelera). Política p33 vigente, sin cambios.
--
-- Aplicada en producción (ylhdbawrllqygfvllhdo) vía migración `p36d_invoices_select_include_trashed`.

drop policy if exists invoices_select on public.invoices;
create policy invoices_select on public.invoices for select to authenticated
  using (workspace_id in (select current_workspace_ids()));
