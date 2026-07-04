// Matriz de estados Comisiones ↔ Facturación (P45 · ampliada P46) — PURO. Una sola fuente de verdad para
// decidir, por operación: el BUCKET visual (grupo por estado), el CHIP, la ACCIÓN principal (siguiente paso
// lógico) y a qué FILTRO pertenece. Distingue el control INTERNO de la comisión (cobrada/pendiente) del
// estado de la FACTURA oficial (borrador/emitida/cobrada/cancelada), respeta el gating del extra Facturación
// y evita mostrar acciones contradictorias.
//
// Reglas clave:
//   - Si ya hay factura vinculada → nunca «Facturar honorarios»; se abre la existente (anti-duplicados).
//   - Comisión cobrada internamente SIN factura → acción distinta: «Crear factura del cobro» (+ ayuda).
//   - Operación abierta o sin cliente → sin CTA de factura (potencial / solo control interno).
//   - Módulo Facturación no disponible → «Requiere Facturación PRO», sin navegación.
//   - «Deshacer cobro interno» es acción SECUNDARIA (menú), nunca principal, y nunca con factura pagada.

import { billingStateFromInvoice, type BillingState } from './billing-state'

export type CommissionCtaInput = {
  closed: boolean            // operación cerrada (stage === 'won')
  commissionPaid: boolean    // cobro INTERNO registrado (commission_status === 'cobrada')
  hasInvoiceLink: boolean    // existe factura activa vinculada a la operación
  invoiceStatus?: string | null // estado de esa factura (si la hay)
  invoicingEnabled: boolean  // módulo extra Facturación PRO activo en el workspace
  hasClient: boolean         // la operación tiene cliente (imprescindible para facturar)
}

export type ChipTone = 'amber' | 'emerald' | 'indigo' | 'gray'
export type CommissionChip = { label: string; tone: ChipTone }

// Grupo/estado visual de la fila. Ordena la pantalla por prioridad de acción.
export type CommissionBucket =
  | 'pending_invoice'       // cerrada, honorarios, sin factura → falta facturar
  | 'collected_no_invoice'  // cobro interno sin factura → falta regularizar
  | 'draft'                 // borrador de factura vinculado
  | 'billed'                // factura emitida/enviada pendiente de cobro
  | 'cancelled'             // factura cancelada/anulada
  | 'collected'             // factura pagada → cobrado con factura
  | 'potential'             // operación abierta (todavía no es ingreso)

// Tipos de acción de factura que la UI debe renderizar.
export type CommissionActionKind =
  | 'none'                  // sin CTA de factura (potencial / sin cliente)
  | 'create'               // pendiente sin factura → «Facturar honorarios»
  | 'create_after_collect' // cobrada internamente sin factura → «Crear factura del cobro»
  | 'open_invoice'         // ya hay factura → abrir borrador/factura existente
  | 'requires_pro'         // Facturación no disponible → mensaje PRO, sin navegar

export type CommissionAction = {
  kind: CommissionActionKind
  label: string
  helper: string | null
  billing?: BillingState   // solo en open_invoice: para tono/estado de la factura
}

export type CommissionState = {
  bucket: CommissionBucket
  chip: CommissionChip
  action: CommissionAction
  // true cuando el estado oficial de la factura manda sobre el control interno
  // (evita mostrar «Registrar cobro» interno / «Deshacer» si ya está cobrada con factura).
  collectedByInvoice: boolean
  // true cuando la comisión está cobrada internamente y NO hay factura pagada oficial:
  // habilita la acción secundaria (menú) «Deshacer cobro interno».
  canUndoInternalCollect: boolean
}

const NONE: CommissionAction = { kind: 'none', label: '', helper: null }

export function resolveCommissionState(i: CommissionCtaInput): CommissionState {
  // 1) Con factura vinculada: manda el estado OFICIAL. Nunca «Facturar honorarios» de nuevo.
  if (i.hasInvoiceLink) {
    const bs = billingStateFromInvoice(i.invoiceStatus)
    const chip = billingChip(bs)
    const collectedByInvoice = bs === 'collected'
    const base = { chip, collectedByInvoice, canUndoInternalCollect: false }
    if (bs === 'draft') {
      return { ...base, bucket: 'draft', action: { kind: 'open_invoice', billing: bs, label: 'Abrir borrador', helper: 'Hay un borrador de factura vinculado.' } }
    }
    if (bs === 'cancelled') {
      return { ...base, bucket: 'cancelled', action: { kind: 'open_invoice', billing: bs, label: 'Abrir factura', helper: 'Factura anulada. Si procede, crea una nueva desde Facturación.' } }
    }
    if (bs === 'collected') {
      return { ...base, bucket: 'collected', action: { kind: 'open_invoice', billing: bs, label: 'Ver factura', helper: null } }
    }
    // billed / pending_invoice (emitida, enviada, vencida)
    return { ...base, bucket: 'billed', action: { kind: 'open_invoice', billing: bs, label: 'Abrir factura', helper: 'Factura emitida pendiente de cobro.' } }
  }

  // 2) Sin factura y operación abierta → potencial (todavía no es ingreso).
  if (!i.closed) {
    return { bucket: 'potential', chip: { label: 'Potencial', tone: 'gray' }, collectedByInvoice: false, canUndoInternalCollect: false, action: NONE }
  }

  // 3) Cerrada sin factura: el chip refleja el control INTERNO de la comisión.
  const paid = i.commissionPaid
  const bucket: CommissionBucket = paid ? 'collected_no_invoice' : 'pending_invoice'
  const chip: CommissionChip = paid
    ? { label: 'Cobrada sin factura', tone: 'emerald' }
    : { label: 'Pendiente de facturar', tone: 'amber' }
  const canUndoInternalCollect = paid // se puede deshacer el cobro interno (menú), no hay factura pagada

  // 3a) Sin cliente → no se puede emitir factura; solo control interno.
  if (!i.hasClient) return { bucket, chip, collectedByInvoice: false, canUndoInternalCollect, action: NONE }

  // 3b) Módulo Facturación no disponible → mensaje PRO, sin navegación rota.
  if (!i.invoicingEnabled) {
    return { bucket, chip, collectedByInvoice: false, canUndoInternalCollect, action: { kind: 'requires_pro', label: 'Requiere Facturación PRO', helper: 'Para emitir facturas necesitas el módulo Facturación.' } }
  }

  // 3c) Cobrada internamente sin factura → regularizar (texto distinto + ayuda).
  if (paid) {
    return { bucket, chip, collectedByInvoice: false, canUndoInternalCollect, action: { kind: 'create_after_collect', label: 'Crear factura del cobro', helper: 'El cobro está registrado, pero falta la factura oficial.' } }
  }

  // 3d) Pendiente sin factura → crear factura (de honorarios).
  return { bucket, chip, collectedByInvoice: false, canUndoInternalCollect, action: { kind: 'create', label: 'Crear factura', helper: 'Aún no hay factura vinculada.' } }
}

// Chip para el estado de la FACTURA (contexto comisiones: «Cobrado con factura» para distinguir del
// cobro interno sin factura).
function billingChip(bs: BillingState): CommissionChip {
  switch (bs) {
    case 'draft':     return { label: 'Borrador de factura', tone: 'gray' }
    case 'billed':    return { label: 'Facturado · pendiente de cobro', tone: 'indigo' }
    case 'collected': return { label: 'Cobrado con factura', tone: 'emerald' }
    case 'cancelled': return { label: 'Factura cancelada', tone: 'amber' }
    default:          return { label: 'Pendiente de facturar', tone: 'amber' }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Agrupación visual + filtros (P46)
// ─────────────────────────────────────────────────────────────────────────────

// Orden de prioridad de los grupos en pantalla (lo que necesita acción, primero).
export const COMMISSION_BUCKETS_ORDER: CommissionBucket[] = [
  'pending_invoice', 'collected_no_invoice', 'draft', 'billed', 'cancelled', 'collected', 'potential',
]

export const COMMISSION_BUCKET_LABEL: Record<CommissionBucket, string> = {
  pending_invoice: 'Pendiente de facturar',
  collected_no_invoice: 'Cobradas sin factura',
  draft: 'Borradores de factura',
  billed: 'Facturadas · pendiente de cobro',
  cancelled: 'Facturas canceladas',
  collected: 'Cobradas',
  potential: 'Potenciales · abiertas',
}

export type CommissionFilter = 'todo' | 'facturadas' | 'cobradas' | 'potenciales' | 'todas'

// Qué buckets muestra cada filtro. `todas` = todos. «Por hacer» (todo) = lo que necesita acción.
const FILTER_BUCKETS: Record<CommissionFilter, CommissionBucket[] | null> = {
  todas: null,
  todo: ['pending_invoice', 'collected_no_invoice', 'draft', 'billed', 'cancelled'],
  facturadas: ['draft', 'billed'],
  cobradas: ['collected'],
  potenciales: ['potential'],
}

export function bucketInFilter(bucket: CommissionBucket, filter: CommissionFilter): boolean {
  const allowed = FILTER_BUCKETS[filter]
  return allowed === null || allowed.includes(bucket)
}

// ─────────────────────────────────────────────────────────────────────────────
// Guía contextual por estado (ADDENDUM P46) — «¿qué pasa? · ¿qué falta? · ¿siguiente paso?»
// Explicación CORTA por bucket + progreso del ciclo (Honorarios → Factura → Cobro → Cerrado).
// ─────────────────────────────────────────────────────────────────────────────

export const COMMISSION_BUCKET_DESCRIPTION: Record<CommissionBucket, string> = {
  pending_invoice: 'Ya hay honorarios cerrados, pero todavía no existe factura oficial.',
  collected_no_invoice: 'Has registrado el cobro internamente, pero falta la factura oficial.',
  draft: 'Hay un borrador de factura. Ábrelo para revisarlo y emitirlo.',
  billed: 'La factura está emitida. Falta registrar el cobro en Facturación.',
  cancelled: 'La factura está anulada. Crea una nueva si todavía procede.',
  collected: 'Factura pagada. No queda ninguna acción pendiente.',
  potential: 'Operación abierta. Todavía no es un ingreso.',
}

// Paso del ciclo económico (3 pasos: facturar → cobrar → cerrado). null = fuera del ciclo.
export const COMMISSION_BUCKET_STEP: Record<CommissionBucket, string | null> = {
  pending_invoice: 'Paso 1 de 3 · falta facturar',
  collected_no_invoice: 'Paso 1 de 3 · falta la factura oficial',
  draft: 'Paso 1 de 3 · falta emitir',
  billed: 'Paso 2 de 3 · falta cobrar',
  cancelled: null,
  collected: 'Paso 3 de 3 · cerrado',
  potential: null,
}

// Una operación está cerrada económicamente SOLO cuando su factura vinculada está pagada.
export function isEconomicallyClosed(bucket: CommissionBucket): boolean {
  return bucket === 'collected'
}

// Copy de estado vacío por filtro (empty states guiados).
export const COMMISSION_EMPTY_COPY: Record<CommissionFilter, { title: string; description: string }> = {
  todo: { title: 'Todo al día', description: 'No hay comisiones pendientes de facturar ni facturas pendientes de cobro.' },
  facturadas: { title: 'Sin facturas emitidas', description: 'Todavía no hay facturas emitidas desde comisiones.' },
  cobradas: { title: 'Sin cobros aún', description: 'Cuando una factura esté pagada, la operación aparecerá aquí.' },
  potenciales: { title: 'Sin operaciones abiertas', description: 'No hay operaciones abiertas con honorarios estimados.' },
  todas: { title: 'Sin comisiones', description: 'Todavía no hay operaciones con comisiones que controlar.' },
}

// ─────────────────────────────────────────────────────────────────────────────
// Resumen / KPIs (P46) — derivado, sin sincronizaciones. El precio del inmueble NUNCA entra:
// `honorarios` ya es la comisión/honorarios de la operación.
// ─────────────────────────────────────────────────────────────────────────────

export type CommissionSummaryRow = { honorarios: number | null; bucket: CommissionBucket }

export type CommissionSummary = {
  pendingInvoice: number   // honorarios cerrados sin factura ni cobro interno
  billed: number           // facturas emitidas no pagadas
  collected: number        // facturas pagadas + cobros internos registrados
  potential: number        // honorarios estimados de operaciones abiertas
  pendingInvoiceCount: number
  billedCount: number
  collectedCount: number
  potentialCount: number
  collectedNoInvoiceCount: number
  todoCount: number        // filas que necesitan acción («Por hacer»)
}

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

export function summarizeCommissions(rows: CommissionSummaryRow[]): CommissionSummary {
  let pendingInvoice = 0, billed = 0, collected = 0, potential = 0
  let pendingInvoiceCount = 0, billedCount = 0, collectedCount = 0, potentialCount = 0, collectedNoInvoiceCount = 0, todoCount = 0
  for (const row of rows) {
    const h = typeof row.honorarios === 'number' && row.honorarios > 0 ? row.honorarios : 0
    if (bucketInFilter(row.bucket, 'todo')) todoCount++
    switch (row.bucket) {
      case 'pending_invoice': pendingInvoice += h; pendingInvoiceCount++; break
      case 'billed': billed += h; billedCount++; break
      case 'collected': collected += h; collectedCount++; break
      case 'collected_no_invoice': collected += h; collectedNoInvoiceCount++; break
      case 'potential': potential += h; potentialCount++; break
      // draft y cancelled no suman a los KPIs de cabecera (ni emitidas ni cobradas).
      default: break
    }
  }
  return {
    pendingInvoice: r2(pendingInvoice), billed: r2(billed), collected: r2(collected), potential: r2(potential),
    pendingInvoiceCount, billedCount, collectedCount, potentialCount, collectedNoInvoiceCount, todoCount,
  }
}
