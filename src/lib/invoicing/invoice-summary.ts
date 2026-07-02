// Resumen financiero/fiscal de Facturación (P36D) — PURO, determinista, sin I/O. Alimenta el mini
// dashboard del módulo. Es ORIENTATIVO para gestión interna: NO es una declaración fiscal oficial.
//
// Reglas de cálculo (documentadas):
//   · Se excluyen SIEMPRE las facturas en papelera (deletedAt != null).
//   · Borradores (draft) NO cuentan como facturado.
//   · Canceladas/anuladas (cancelled/void) NO cuentan como facturado activo.
//   · "Facturado" = Σ total de facturas emitidas/enviadas/pagadas (no borrador, no cancelada) del periodo.
//   · "Cobrado"   = Σ total de facturas pagadas del periodo.
//   · "Pendiente" = Σ total de emitidas/enviadas NO pagadas y NO vencidas del periodo.
//   · "Vencido"   = Σ total de emitidas/enviadas con vencimiento < hoy (no pagadas/canceladas) del periodo.
//   · "Base imponible" = Σ subtotal del set facturado.  · "IVA repercutido" = Σ IVA.  · "IRPF" = Σ retención.
//   · "Neto orientativo" = base − IRPF (lo que ingresas antes de liquidar el IVA). Orientativo.

export type SummaryPeriod = 'month' | 'quarter' | 'year' | 'all'

export type SummaryInvoice = {
  status: string
  issueDate: string
  dueDate: string | null
  subtotal: number
  taxTotal: number
  withholdingTotal: number
  total: number
  clientName: string
  deletedAt?: string | null
}

export type InvoiceSummary = {
  facturado: number
  cobrado: number
  pendiente: number
  vencido: number
  base: number
  iva: number
  irpf: number
  neto: number
  countIssued: number
  countDrafts: number
  currency: string
  collect: { paid: number; pending: number; overdue: number }   // para el gráfico cobrado/pendiente/vencido
  byStatus: { key: string; label: string; total: number; count: number }[]
  monthly: { ym: string; label: string; total: number }[]
  topClients: { name: string; total: number }[]
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100
const isBilled = (s: string) => s === 'issued' || s === 'sent' || s === 'paid'
const isPending = (s: string) => s === 'issued' || s === 'sent'

function quarter(m: number): number { return Math.floor(m / 3) }

export function inPeriod(issueDate: string, period: SummaryPeriod, now: Date): boolean {
  if (period === 'all') return true
  const d = new Date(issueDate)
  if (Number.isNaN(d.getTime())) return false
  if (d.getFullYear() !== now.getFullYear()) return false
  if (period === 'year') return true
  if (period === 'month') return d.getMonth() === now.getMonth()
  if (period === 'quarter') return quarter(d.getMonth()) === quarter(now.getMonth())
  return true
}

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

export function computeInvoiceSummary(rows: SummaryInvoice[], period: SummaryPeriod, nowIso?: string): InvoiceSummary {
  const now = nowIso ? new Date(nowIso) : new Date()
  const today = now.toISOString().slice(0, 10)
  const active = rows.filter((r) => !r.deletedAt)
  const scope = active.filter((r) => inPeriod(r.issueDate, period, now))

  const overdue = (r: SummaryInvoice) => isPending(r.status) && !!r.dueDate && r.dueDate < today

  const billed = scope.filter((r) => isBilled(r.status))
  const sum = (arr: SummaryInvoice[], f: (r: SummaryInvoice) => number) => round2(arr.reduce((a, r) => a + f(r), 0))

  const facturado = sum(billed, (r) => r.total)
  const cobrado = sum(billed.filter((r) => r.status === 'paid'), (r) => r.total)
  const pendiente = sum(scope.filter((r) => isPending(r.status) && !overdue(r)), (r) => r.total)
  const vencido = sum(scope.filter(overdue), (r) => r.total)
  const base = sum(billed, (r) => r.subtotal)
  const iva = sum(billed, (r) => r.taxTotal)
  const irpf = sum(billed, (r) => r.withholdingTotal)

  // Distribución cobrado/pendiente/vencido (para gráfico)
  const collect = { paid: cobrado, pending: pendiente, overdue: vencido }

  // Facturación por estado (del periodo, sin papelera)
  const statusDefs: { key: string; label: string; match: (r: SummaryInvoice) => boolean }[] = [
    { key: 'draft', label: 'Borradores', match: (r) => r.status === 'draft' },
    { key: 'pending', label: 'Pendientes', match: (r) => isPending(r.status) && !overdue(r) },
    { key: 'overdue', label: 'Vencidas', match: overdue },
    { key: 'paid', label: 'Cobradas', match: (r) => r.status === 'paid' },
    { key: 'cancelled', label: 'Canceladas', match: (r) => r.status === 'cancelled' || r.status === 'void' },
  ]
  const byStatus = statusDefs.map((d) => {
    const items = scope.filter(d.match)
    return { key: d.key, label: d.label, total: sum(items, (r) => r.total), count: items.length }
  }).filter((s) => s.count > 0)

  // Evolución mensual (últimos 6 meses hasta hoy, sobre TODO lo facturado, no solo el periodo)
  const monthly: { ym: string; label: string; total: number }[] = []
  const billedAll = active.filter((r) => isBilled(r.status))
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    const total = sum(billedAll.filter((r) => r.issueDate.slice(0, 7) === ym), (r) => r.total)
    monthly.push({ ym, label: MONTHS[d.getMonth()], total })
  }

  // Top clientes por facturación del periodo
  const byClient = new Map<string, number>()
  for (const r of billed) byClient.set(r.clientName, round2((byClient.get(r.clientName) ?? 0) + r.total))
  const topClients = [...byClient.entries()].map(([name, total]) => ({ name, total })).sort((a, b) => b.total - a.total).slice(0, 5)

  return {
    facturado, cobrado, pendiente, vencido, base, iva, irpf, neto: round2(base - irpf),
    countIssued: billed.length,
    countDrafts: scope.filter((r) => r.status === 'draft').length,
    currency: 'EUR',
    collect, byStatus, monthly, topClients,
  }
}
