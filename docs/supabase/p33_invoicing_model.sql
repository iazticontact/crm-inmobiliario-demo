-- =====================================================================
-- P33 — Facturación fase 1: modelo, RLS y numeración atómica (ADDITIVO)
-- =====================================================================
-- Aplicado el 2026-07-02 al proyecto ylhdbawrllqygfvllhdo vía MCP apply_migration
-- (migraciones: p33_invoicing_model, p33_reserve_invoice_number_rpc_fix).
--
-- No destructivo. Numeración por workspace + serie + AÑO (en España la serie suele
-- reiniciarse por ejercicio). RLS con los helpers reales del proyecto
-- (current_workspace_ids / current_workspace_role / is_workspace_admin). SIN UI/PDF.

-- 1) Secuencias de numeración -------------------------------------------------
create table if not exists public.invoice_number_sequences (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  series text not null default 'A',
  year integer not null,
  next_number integer not null default 1 check (next_number >= 1),
  prefix text not null default 'FAC-',
  padding integer not null default 4 check (padding between 1 and 10),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint invoice_number_sequences_unique unique (workspace_id, series, year)
);

-- 2) Facturas -----------------------------------------------------------------
create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  client_id uuid references public.clients(id) on delete set null,
  property_id uuid references public.properties(id) on delete set null,
  opportunity_id uuid references public.opportunities(id) on delete set null,
  series text not null default 'A',
  year integer not null default extract(year from (now() at time zone 'Europe/Madrid'))::int,
  number integer,
  invoice_number_display text,
  status text not null default 'draft'
    check (status in ('draft','issued','sent','paid','overdue','cancelled','void')),
  issue_date date not null default (now() at time zone 'Europe/Madrid')::date,
  due_date date,
  currency text not null default 'EUR',
  subtotal numeric(14,2) not null default 0 check (subtotal >= 0),
  tax_total numeric(14,2) not null default 0 check (tax_total >= 0),
  withholding_total numeric(14,2) not null default 0 check (withholding_total >= 0),
  total numeric(14,2) not null default 0,
  issuer_snapshot jsonb not null default '{}'::jsonb,
  customer_snapshot jsonb not null default '{}'::jsonb,
  fiscal_snapshot jsonb not null default '{}'::jsonb,
  notes text,
  internal_notes text,
  pdf_file_id uuid references public.entity_files(id) on delete set null,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint invoices_number_unique unique (workspace_id, series, year, number),
  constraint invoices_due_after_issue check (due_date is null or due_date >= issue_date)
);
create index if not exists invoices_ws_status_idx on public.invoices (workspace_id, status);
create index if not exists invoices_ws_issue_idx on public.invoices (workspace_id, issue_date desc);
create index if not exists invoices_client_idx on public.invoices (client_id);
create index if not exists invoices_opportunity_idx on public.invoices (opportunity_id);

-- 3) Líneas -------------------------------------------------------------------
create table if not exists public.invoice_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  description text not null default '',
  quantity numeric(14,3) not null default 1 check (quantity > 0),
  unit_price numeric(14,2) not null default 0,
  discount_rate numeric(6,3) not null default 0 check (discount_rate >= 0 and discount_rate <= 100),
  tax_rate numeric(6,3) not null default 21 check (tax_rate >= 0),
  withholding_rate numeric(6,3) not null default 0 check (withholding_rate >= 0),
  line_subtotal numeric(14,2) not null default 0,
  line_tax_total numeric(14,2) not null default 0,
  line_withholding_total numeric(14,2) not null default 0,
  line_total numeric(14,2) not null default 0,
  sort_order integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists invoice_items_invoice_idx on public.invoice_items (invoice_id);

-- 4) Triggers updated_at (set_updated_at existente) ---------------------------
create trigger trg_invoice_number_sequences_updated_at before update on public.invoice_number_sequences
  for each row execute function public.set_updated_at();
create trigger trg_invoices_updated_at before update on public.invoices
  for each row execute function public.set_updated_at();
create trigger trg_invoice_items_updated_at before update on public.invoice_items
  for each row execute function public.set_updated_at();

-- 5) RLS ----------------------------------------------------------------------
alter table public.invoice_number_sequences enable row level security;
alter table public.invoices enable row level security;
alter table public.invoice_items enable row level security;

create policy inv_seq_select on public.invoice_number_sequences for select to authenticated
  using (workspace_id in (select current_workspace_ids()));
create policy inv_seq_admin_write on public.invoice_number_sequences for all to authenticated
  using (is_workspace_admin(workspace_id)) with check (is_workspace_admin(workspace_id));

create policy invoices_select on public.invoices for select to authenticated
  using (workspace_id in (select current_workspace_ids()) and deleted_at is null);
create policy invoices_insert on public.invoices for insert to authenticated
  with check (workspace_id in (select current_workspace_ids())
    and current_workspace_role(workspace_id) = any (array['owner','admin','comercial']));
create policy invoices_update on public.invoices for update to authenticated
  using (workspace_id in (select current_workspace_ids())
    and current_workspace_role(workspace_id) = any (array['owner','admin','comercial']))
  with check (workspace_id in (select current_workspace_ids()));
-- delete: solo admin y solo borradores; las emitidas se ANULAN (cancelled/void).
create policy invoices_delete on public.invoices for delete to authenticated
  using (is_workspace_admin(workspace_id) and status = 'draft');

create policy invoice_items_select on public.invoice_items for select to authenticated
  using (workspace_id in (select current_workspace_ids()));
create policy invoice_items_write on public.invoice_items for all to authenticated
  using (workspace_id in (select current_workspace_ids())
    and current_workspace_role(workspace_id) = any (array['owner','admin','comercial']))
  with check (workspace_id in (select current_workspace_ids())
    and current_workspace_role(workspace_id) = any (array['owner','admin','comercial'])
    and exists (select 1 from public.invoices i where i.id = invoice_id and i.workspace_id in (select current_workspace_ids())));

grant select, insert, update, delete on public.invoices to authenticated;
grant select, insert, update, delete on public.invoice_items to authenticated;
grant select, insert, update, delete on public.invoice_number_sequences to authenticated;

-- 6) entity_files.entity_type += 'invoice' (para PDFs de factura futuros) ------
alter table public.entity_files drop constraint if exists entity_files_entity_type_check;
alter table public.entity_files add constraint entity_files_entity_type_check
  check (entity_type = any (array['property','client','opportunity','service_case','invoice']));

-- 7) RPC de numeración ATÓMICA (workspace + serie + año) ----------------------
-- SECURITY DEFINER para el upsert atómico sobre la secuencia; con control explícito de membership + rol.
create or replace function public.reserve_invoice_number(
  p_workspace_id uuid,
  p_series text default 'A',
  p_issue_date date default (now() at time zone 'Europe/Madrid')::date
)
returns table (out_number integer, out_year integer, out_series text, out_display text)
language plpgsql security definer set search_path = public
as $$
declare
  v_year integer := extract(year from coalesce(p_issue_date, (now() at time zone 'Europe/Madrid')::date))::int;
  v_series text := coalesce(nullif(trim(p_series), ''), 'A');
  v_role text; v_reserved integer; v_prefix text; v_padding integer;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  select role into v_role from public.workspace_members
    where workspace_id = p_workspace_id and user_id = auth.uid();
  if v_role is null then raise exception 'not_a_member'; end if;
  if v_role not in ('owner','admin','comercial') then raise exception 'not_authorized_to_invoice'; end if;

  insert into public.invoice_number_sequences as s (workspace_id, series, year, next_number)
    values (p_workspace_id, v_series, v_year, 2)
  on conflict (workspace_id, series, year)
    do update set next_number = s.next_number + 1, updated_at = now()
  returning s.next_number - 1, s.prefix, s.padding into v_reserved, v_prefix, v_padding;

  return query select v_reserved, v_year, v_series,
    v_prefix || v_series || '/' || v_year::text || '/' || lpad(v_reserved::text, coalesce(v_padding, 4), '0');
end;
$$;
revoke all on function public.reserve_invoice_number(uuid, text, date) from public, anon;
grant execute on function public.reserve_invoice_number(uuid, text, date) to authenticated;
