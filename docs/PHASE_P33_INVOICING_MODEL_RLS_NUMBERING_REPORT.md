# FASE P33 — Facturación fase 1: modelo Supabase, RLS y numeración atómica

> **Fecha:** 2026-07-02 · Primer extra (facturación), **solo cimiento técnico**: modelo de datos, RLS,
> numeración atómica, base fiscal, tipos y servicios base. **SIN** UI, PDF, envío, Asistente-write ni n8n.
> Migraciones **additivas** verificadas contra Supabase real. Deja a P34 construir UI/PDF sin deuda técnica.

---

## 1. Diagnóstico
Base cerrada (P30/P31), RLS multi-tenant con `current_workspace_ids()`/`current_workspace_role()`/
`is_workspace_admin()`, roles en `workspace_members.role` (owner/admin/comercial/staff), trigger
`set_updated_at()`, bucket `entity-files` privado, `entity_files.entity_type` sin `invoice`. Se siguió el
estilo real del proyecto (naming snake_case, `gen_random_uuid()`, FK a `workspaces` on delete cascade).

## 2. Modelo creado (additivo)
Tres tablas nuevas: **`invoices`**, **`invoice_items`**, **`invoice_number_sequences`**. `invoices` con 28
columnas incluidas relaciones (`client_id`/`property_id`/`opportunity_id`), snapshots jsonb, totales
persistidos y `pdf_file_id` (FK nullable a `entity_files`, para el PDF futuro).

## 3. Tablas y columnas (resumen)
- **invoices:** id, workspace_id, client_id?, property_id?, opportunity_id?, series, year, number?,
  invoice_number_display?, status, issue_date, due_date?, currency, subtotal, tax_total, withholding_total,
  total, **issuer_snapshot/customer_snapshot/fiscal_snapshot jsonb**, notes, internal_notes, pdf_file_id?,
  created_by, updated_by, created_at, updated_at, deleted_at.
- **invoice_items:** id, invoice_id, workspace_id, description, quantity, unit_price, discount_rate,
  tax_rate, withholding_rate, line_subtotal, line_tax_total, line_withholding_total, line_total, sort_order,
  metadata jsonb, timestamps.
- **invoice_number_sequences:** id, workspace_id, series, year, next_number, prefix (def. `FAC-`), padding
  (def. 4), timestamps · `unique(workspace_id, series, year)`.

## 4. Constraints
FKs a workspaces/clients/properties/opportunities/entity_files. `unique(workspace_id, series, year, number)`
(los `number` NULL de los borradores no colisionan). CHECKs: `status in (…)`, `subtotal/tax_total/
withholding_total >= 0`, `quantity > 0`, `tax_rate/withholding_rate >= 0`, `discount_rate 0..100`,
`due_date >= issue_date`. Índices por workspace/status, workspace/issue_date, client, opportunity, invoice_id.

## 5. RLS (verificada, alineada al proyecto)
- **invoices:** SELECT miembros (`current_workspace_ids()`, no borradas); INSERT/UPDATE con rol
  `owner/admin/comercial`; DELETE solo `is_workspace_admin` **y** `status='draft'` (las emitidas se **anulan**
  con `cancelled`/`void`, no se borran).
- **invoice_items:** SELECT miembros; escritura con rol autorizado **y** que la factura pertenezca al mismo
  workspace (`exists`).
- **invoice_number_sequences:** SELECT miembros; escritura directa solo admin; el incremento va por la RPC.
- Sin `service_role` en frontend. Sin políticas para `anon`.

## 6. RPC de numeración atómica
`reserve_invoice_number(workspace_id, series, issue_date) → (out_number, out_year, out_series, out_display)`.
- **SECURITY DEFINER** (para el upsert atómico sobre la secuencia), con **control explícito**: exige
  `auth.uid()`, membership del workspace y rol `owner/admin/comercial` (si no → `not_authenticated`/
  `not_a_member`/`not_authorized_to_invoice`). No permite reservar para un workspace ajeno.
- **Atómica:** `insert … on conflict (workspace_id, series, year) do update set next_number = next_number+1
  returning next_number-1`. La fila se bloquea → sin duplicados en concurrencia.
- **Display:** `prefix || series || '/' || year || '/' || lpad(number, padding, '0')` → p. ej.
  `FAC-A/2026/0001`.
- **Verificado E2E** (transacción con JWT simulada, **rolled back**, sin ensuciar datos):
  serie TESTX/2026 → **1, 2, 3**; TESTX/2025 → **1** (independiente por año); serie B/2026 → **1**
  (independiente por serie); y un miembro de un workspace **no** puede reservar para otro (`not_a_member`).
  Conteos finales: invoices 0, invoice_items 0, invoice_number_sequences 0 (todo revertido).

## 7. Decisión serie/año
**Numeración por `workspace + serie + año`.** En España la numeración de facturas suele **reiniciarse por
ejercicio** dentro de cada serie; separar por año lo hace natural y evita huecos entre ejercicios. `prefix` y
`padding` se guardan por secuencia (configurables por serie).

## 8. Cálculo fiscal base (`src/lib/invoicing/calc.ts`, puro)
Por línea: base = (cantidad × precio) − descuento%; **IVA** = base × tax%; **IRPF/retención** = base ×
withholding%; total = base + IVA − retención. Factura: subtotal/IVA/retención = sumas; total = subtotal +
IVA − retención. **Redondeo a 2 decimales por línea y suma** (reproducible). `formatInvoiceCurrency` es-ES.
**Tests ejecutables** (`__evals__/invoicing.evals.ts`): 2×100 IVA21=242; descuento 10%=217.8; IRPF 15%
sobre 1000 → total 1060; redondeo 3×33.33; totales multi-línea (1685); validación de payload; estados.
Verificado (CALC_PASS).

## 9. entity_files invoice
CHECK ampliado additivamente: `entity_type ∈ {property, client, opportunity, service_case, **invoice**}`.
`invoices.pdf_file_id` FK nullable a `entity_files(id) on delete set null` → el PDF (P34) se podrá vincular
sin obligar a que un borrador lo tenga.

## 10. Servicios / types
- **`types.ts`:** `InvoiceStatus`(+labels), `InvoiceItemInput`, `InvoiceTotals`, `IssuerSnapshot/
  CustomerSnapshot/FiscalSnapshot`, `Invoice`, `InvoiceItem`, `InvoiceNumberSequence`, `InvoiceNumberReservation`.
- **`invoice-service.ts`** (SIN UI, con `SupabaseClient` bajo RLS; nunca service_role frontend):
  `validateInvoicePayload`, `reserveInvoiceNumber` (llama a la RPC), `listInvoices`, `getInvoiceById`.
- **`calc.ts`:** puro (arriba).

## 11. Tests
Evals ejecutables de cálculo/validación/estados (CALC_PASS). Numeración/RLS verificadas por SQL contra
Supabase real (transacción rolled back). RLS de lectura cross-workspace: misma familia de políticas que
`clients` (ya probada); la verificación como usuario autenticado end-to-end se hará con la UI en P34.

## 12. Validaciones
`npx tsc --noEmit` ✅ · `npm run lint -- --max-warnings=0` ✅ · `npm run build` ✅ ·
`node --check scripts/check-agent-deploy.mjs` ✅ · git limpio · sin secretos · sin temp files · sin n8n ·
sin service_role frontend · **sin UI/PDF**.

## 13. Archivos tocados
| Archivo | Cambio |
|---|---|
| `src/lib/invoicing/types.ts` | **Nuevo** — tipos de dominio de facturación |
| `src/lib/invoicing/calc.ts` | **Nuevo** — cálculo fiscal puro (IVA/IRPF/descuento/redondeo) |
| `src/lib/invoicing/invoice-service.ts` | **Nuevo** — servicios base (validación/reserva nº/lectura) |
| `src/lib/invoicing/__evals__/invoicing.evals.ts` | **Nuevo** — evals ejecutables |
| `docs/supabase/p33_invoicing_model.sql` | **Nuevo** — registro de la migración aplicada |
| `docs/PHASE_P33_INVOICING_MODEL_RLS_NUMBERING_REPORT.md` | **Nuevo** — este informe |

## 14. Migraciones
`p33_invoicing_model` + `p33_reserve_invoice_number_rpc_fix` (aplicadas a `ylhdbawrllqygfvllhdo`). Additivas.

## 15. Qué NO se implementó todavía (por diseño)
Pantalla de facturas, PDF, descarga, envío, emails, notificaciones, **n8n**, Asistente preparando facturas,
detección de acción "factura", acciones visibles nuevas. Nada de eso entra en P33.

## 16–17. Commit / Push
Commit `feat(p33): facturación fase 1 — modelo + RLS + numeración atómica + calc fiscal` → `origin/main`.

## 18. Riesgos / pendientes / rollback
- **Duplicados/numeración:** mitigado (unique + RPC atómica; verificado). **Rollback:** additivo; para revertir
  bastaría `drop` de las tres tablas + RPC (no afecta a datos base). Las tablas quedan vacías.
- **RLS:** misma familia probada; QA de usuario autenticado en P34.
- **Snapshots:** se rellenarán al emitir (P34) desde empresa/cliente reales; permiten null/"No consta".
- **Fiscalidad:** IVA/IRPF/descuento cubiertos; **sin** Verifactu/TicketBAI/firma (legal/futuro, documentado).
- **Siguiente fase — P34:** UI de facturación (emisor/cliente/líneas/impuestos/preview) + **PDF** (portar
  `pdf.ts` de auto-factor) + guardar PDF en `entity-files` (`entity_type='invoice'`) + estados + actividad,
  todo mobile ≥16px. Luego **P35** (Asistente lectura + `prepare_invoice` con confirmación + evals/E2E).

## 19. Veredicto
**P33 COMPLETADO — FACTURACIÓN BASE: MODELO, RLS Y NUMERACIÓN ATÓMICA LISTOS.** Cimiento verificado contra
Supabase real (numeración atómica correcta y segura, RLS por workspace/rol, base fiscal con IVA/IRPF/
descuentos y snapshots, cálculo puro testeado). Additivo y sin tocar la base, n8n ni el frontend visible.
Listo para que P34 construya UI + PDF encima sin deuda técnica.
