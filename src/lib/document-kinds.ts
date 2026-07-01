// Tipos (kind) de documento para inmobiliaria (P36). Controlados y simples. Se guardan en
// `entity_files.metadata.kind` (la columna `category` sigue siendo image|document para el filtro).
// El PDF de factura (P34) usa kind='invoice_pdf'.

export type DocumentKind =
  | 'document' | 'contract' | 'id_document' | 'nota_simple' | 'deed' | 'receipt'
  | 'reservation' | 'mandate' | 'certificate' | 'floor_plan' | 'legal' | 'invoice_pdf' | 'other'

export const DOCUMENT_KINDS: Array<{ value: DocumentKind; label: string }> = [
  { value: 'document', label: 'Documento' },
  { value: 'contract', label: 'Contrato' },
  { value: 'id_document', label: 'DNI / NIE' },
  { value: 'nota_simple', label: 'Nota simple' },
  { value: 'deed', label: 'Escritura' },
  { value: 'receipt', label: 'Recibo / justificante' },
  { value: 'reservation', label: 'Reserva' },
  { value: 'mandate', label: 'Mandato / encargo' },
  { value: 'certificate', label: 'Certificado' },
  { value: 'floor_plan', label: 'Plano' },
  { value: 'legal', label: 'Legal' },
  { value: 'other', label: 'Otro' },
]

const LABELS: Record<string, string> = Object.fromEntries(
  [...DOCUMENT_KINDS, { value: 'invoice_pdf', label: 'Factura (PDF)' }].map((k) => [k.value, k.label]),
)

// Kinds que se pueden elegir al subir (excluye invoice_pdf, que lo pone Facturación automáticamente).
export const SELECTABLE_DOCUMENT_KINDS = DOCUMENT_KINDS

export function isValidDocumentKind(v: unknown): v is DocumentKind {
  return typeof v === 'string' && LABELS[v] !== undefined
}

export function documentKindLabel(v: unknown): string {
  return (typeof v === 'string' && LABELS[v]) || 'Documento'
}

export function normalizeDocumentKind(v: unknown): DocumentKind {
  return isValidDocumentKind(v) ? v : 'document'
}
