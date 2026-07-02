// Evals del resumen financiero/fiscal (P36E) — EJECUTABLE, puro. Verifica las reglas de cálculo del mini
// dashboard: cuenta por `accountingExcluded` (NO por papelera), exclusión de borradores/canceladas, filtro
// por periodo, cobrado/pendiente/vencido, base/IVA/IRPF y el recuento de excluidas. También comprueba que
// una factura purgada "retenida" sigue contando y una purgada "excluida" no.

import { computeInvoiceSummary, inPeriod, type SummaryInvoice } from '../invoice-summary'

const NOW = '2026-07-15'
const rows: SummaryInvoice[] = [
  { status: 'draft', issueDate: '2026-07-01', dueDate: null, subtotal: 100, taxTotal: 21, withholdingTotal: 0, total: 121, clientName: 'Ana' },                          // no cuenta
  { status: 'issued', issueDate: '2026-07-02', dueDate: '2026-07-30', subtotal: 1000, taxTotal: 210, withholdingTotal: 0, total: 1210, clientName: 'Beta SL' },          // pendiente
  { status: 'issued', issueDate: '2026-07-03', dueDate: '2026-07-10', subtotal: 500, taxTotal: 105, withholdingTotal: 0, total: 605, clientName: 'Ceta' },               // vencida
  { status: 'paid', issueDate: '2026-07-04', dueDate: '2026-07-20', subtotal: 2000, taxTotal: 420, withholdingTotal: 300, total: 2120, clientName: 'Beta SL' },          // cobrada
  { status: 'cancelled', issueDate: '2026-07-05', dueDate: null, subtotal: 999, taxTotal: 999, withholdingTotal: 0, total: 9999, clientName: 'Nula' },                   // no facturado
  { status: 'paid', issueDate: '2026-06-10', dueDate: null, subtotal: 100, taxTotal: 21, withholdingTotal: 0, total: 121, clientName: 'Beta SL' },                       // mes anterior
  { status: 'issued', issueDate: '2026-07-06', dueDate: '2026-07-30', subtotal: 50, taxTotal: 10, withholdingTotal: 0, total: 60, clientName: 'Papel', deletedAt: '2026-07-07' }, // en papelera pero NO excluida → cuenta
  { status: 'issued', issueDate: '2026-07-08', dueDate: '2026-07-30', subtotal: 500, taxTotal: 105, withholdingTotal: 0, total: 605, clientName: 'Excl', accountingExcluded: true }, // excluida → no cuenta
]

export function runInvoiceSummaryEvals(): string[] {
  const fail: string[] = []
  const ok = (c: boolean, m: string) => { if (!c) fail.push(m) }

  const m = computeInvoiceSummary(rows, 'month', NOW)
  ok(m.facturado === 3995, `facturado mes (=3995) got ${m.facturado}`)   // 1210+605+2120+60 (papelera incluida)
  ok(m.cobrado === 2120, `cobrado mes (=2120) got ${m.cobrado}`)
  ok(m.pendiente === 1270, `pendiente mes (=1270) got ${m.pendiente}`)   // 1210 + 60 (papelera)
  ok(m.vencido === 605, `vencido mes (=605) got ${m.vencido}`)
  ok(m.base === 3550, `base mes (=3550) got ${m.base}`)
  ok(m.iva === 745, `iva mes (=745) got ${m.iva}`)
  ok(m.irpf === 300, `irpf mes (=300) got ${m.irpf}`)
  ok(m.neto === 3250, `neto mes (=3250) got ${m.neto}`)                  // 3550 − 300
  ok(m.countIssued === 4, `nº emitidas (=4) got ${m.countIssued}`)
  ok(m.countDrafts === 1, `nº borradores (=1) got ${m.countDrafts}`)    // el draft en papelera no existe aquí
  ok(m.excludedCount === 1, `excluidas (=1) got ${m.excludedCount}`)
  ok(m.facturado < 9000, 'cancelada/excluida no cuentan como facturado')

  const a = computeInvoiceSummary(rows, 'all', NOW)
  ok(a.cobrado === 2241, `cobrado all (=2241) got ${a.cobrado}`)         // + junio 121
  ok(a.topClients[0]?.name === 'Beta SL', 'top cliente = Beta SL')

  // Purgada RETENIDA cuenta; purgada EXCLUIDA no
  const purge = computeInvoiceSummary([
    { status: 'paid', issueDate: '2026-07-01', dueDate: null, subtotal: 100, taxTotal: 21, withholdingTotal: 0, total: 121, clientName: 'R', purgedAt: '2026-07-05', accountingExcluded: false },
    { status: 'paid', issueDate: '2026-07-01', dueDate: null, subtotal: 100, taxTotal: 21, withholdingTotal: 0, total: 121, clientName: 'E', purgedAt: '2026-07-05', accountingExcluded: true },
  ], 'month', NOW)
  ok(purge.facturado === 121, `purgada retenida cuenta / excluida no (=121) got ${purge.facturado}`)

  // inPeriod
  const now = new Date(NOW)
  ok(inPeriod('2026-07-01', 'month', now) === true, 'inPeriod month same')
  ok(inPeriod('2026-06-01', 'month', now) === false, 'inPeriod month other')
  ok(inPeriod('2026-06-01', 'quarter', now) === false, 'inPeriod quarter jun=Q2 vs jul=Q3')
  ok(inPeriod('2026-08-01', 'quarter', now) === true, 'inPeriod quarter ago=Q3 = jul')
  ok(inPeriod('2025-07-01', 'year', now) === false, 'inPeriod year other')

  return fail
}
