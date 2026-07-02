// Evals del resumen financiero/fiscal (P36D) — EJECUTABLE, puro. Verifica las reglas de cálculo del mini
// dashboard: exclusión de papelera/borradores/canceladas, cobrado/pendiente/vencido, base/IVA/IRPF y el
// filtro por periodo. `runInvoiceSummaryEvals()` devuelve los fallos (vacío = OK).

import { computeInvoiceSummary, inPeriod, type SummaryInvoice } from '../invoice-summary'

const NOW = '2026-07-15'
const rows: SummaryInvoice[] = [
  { status: 'draft', issueDate: '2026-07-01', dueDate: null, subtotal: 100, taxTotal: 21, withholdingTotal: 0, total: 121, clientName: 'Ana' },
  { status: 'issued', issueDate: '2026-07-02', dueDate: '2026-07-30', subtotal: 1000, taxTotal: 210, withholdingTotal: 0, total: 1210, clientName: 'Beta SL' }, // pendiente
  { status: 'issued', issueDate: '2026-07-03', dueDate: '2026-07-10', subtotal: 500, taxTotal: 105, withholdingTotal: 0, total: 605, clientName: 'Ceta' },   // vencida
  { status: 'paid', issueDate: '2026-07-04', dueDate: '2026-07-20', subtotal: 2000, taxTotal: 420, withholdingTotal: 300, total: 2120, clientName: 'Beta SL' }, // cobrada
  { status: 'cancelled', issueDate: '2026-07-05', dueDate: null, subtotal: 999, taxTotal: 999, withholdingTotal: 0, total: 9999, clientName: 'Nula' },        // excluida
  { status: 'paid', issueDate: '2026-06-10', dueDate: null, subtotal: 100, taxTotal: 21, withholdingTotal: 0, total: 121, clientName: 'Beta SL' },            // mes anterior
  { status: 'issued', issueDate: '2026-07-06', dueDate: '2026-07-30', subtotal: 50, taxTotal: 10, withholdingTotal: 0, total: 60, clientName: 'Papelera', deletedAt: '2026-07-07' }, // en papelera
]

export function runInvoiceSummaryEvals(): string[] {
  const fail: string[] = []
  const ok = (c: boolean, m: string) => { if (!c) fail.push(m) }

  const m = computeInvoiceSummary(rows, 'month', NOW)
  ok(m.facturado === 3935, `facturado mes (=3935) got ${m.facturado}`)          // 1210+605+2120
  ok(m.cobrado === 2120, `cobrado mes (=2120) got ${m.cobrado}`)
  ok(m.pendiente === 1210, `pendiente mes (=1210) got ${m.pendiente}`)
  ok(m.vencido === 605, `vencido mes (=605) got ${m.vencido}`)
  ok(m.base === 3500, `base mes (=3500) got ${m.base}`)
  ok(m.iva === 735, `iva mes (=735) got ${m.iva}`)
  ok(m.irpf === 300, `irpf mes (=300) got ${m.irpf}`)
  ok(m.neto === 3200, `neto mes (=3200) got ${m.neto}`)
  ok(m.countIssued === 3, `nº emitidas (=3) got ${m.countIssued}`)
  ok(m.countDrafts === 1, `nº borradores (=1) got ${m.countDrafts}`)

  // Exclusiones: papelera (60) y cancelada (9999) nunca cuentan como facturado
  ok(m.facturado < 9000, 'cancelada/papelera excluidas del facturado')

  // Periodo "all" incluye el pago de junio (121) → cobrado 2241, facturado 4056
  const a = computeInvoiceSummary(rows, 'all', NOW)
  ok(a.cobrado === 2241, `cobrado all (=2241) got ${a.cobrado}`)
  ok(a.facturado === 4056, `facturado all (=4056) got ${a.facturado}`)

  // Top clientes: Beta SL lidera en "all" (2120+121)
  ok(a.topClients[0]?.name === 'Beta SL', 'top cliente = Beta SL')

  // inPeriod
  const now = new Date(NOW)
  ok(inPeriod('2026-07-01', 'month', now) === true, 'inPeriod month same')
  ok(inPeriod('2026-06-01', 'month', now) === false, 'inPeriod month other')
  ok(inPeriod('2026-06-01', 'quarter', now) === false, 'inPeriod quarter jun=Q2 vs jul=Q3 → distinto')
  ok(inPeriod('2026-08-01', 'quarter', now) === true, 'inPeriod quarter ago=Q3 = jul Q3')
  ok(inPeriod('2025-07-01', 'year', now) === false, 'inPeriod year other')

  return fail
}
