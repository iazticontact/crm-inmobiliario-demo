// Evals del parser de factura por texto (P36A) — EJECUTABLE y determinista (puro, sin I/O ni red).
// Valida la extracción de importe, IVA (explícito / por defecto / sin IVA / IVA incluido), IRPF,
// descuento, vencimiento (días y fin de mes), serie, concepto, resolución de cliente (único / ambiguo /
// inexistente) y detección de campos faltantes. `runInvoiceParseEvals()` devuelve los fallos (vacío = OK).

import { parseInvoiceText } from '../invoice-parse'

type ClientLite = { id: string; name: string }

export function runInvoiceParseEvals(): string[] {
  const fail: string[] = []
  const ok = (c: boolean, m: string) => { if (!c) fail.push(m) }
  const dayDiff = (a: string, b: string) => Math.round((Date.parse(a) - Date.parse(b)) / 86400000)

  // Importe simple + IVA por defecto (21%)
  let r = parseInvoiceText('Factura por 300 €')
  ok(r.detected.amount === 300 && r.draft.items[0].unitPrice === 300, 'importe simple')
  ok(r.draft.items[0].taxRate === 21, 'IVA por defecto 21%')

  // Miles con separador es-ES
  r = parseInvoiceText('Comisión de venta de 1.200 € + IVA')
  ok(r.detected.amount === 1200 && r.draft.items[0].unitPrice === 1200, 'importe con miles 1.200')

  // IVA explícito
  r = parseInvoiceText('Factura por 500 € con IVA 10%')
  ok(r.draft.items[0].taxRate === 10, 'IVA explícito 10%')

  // Sin IVA
  r = parseInvoiceText('Factura por 500 € sin IVA')
  ok(r.draft.items[0].taxRate === 0, 'sin IVA → 0%')

  // IVA incluido: el importe es bruto → base = 1210 / 1.21 = 1000 + aviso
  r = parseInvoiceText('Factura por 1210 € IVA incluido')
  ok(r.draft.items[0].unitPrice === 1000, 'IVA incluido → base 1000')
  ok(r.warnings.some((w) => /iva incluido/i.test(w)), 'IVA incluido → aviso')

  // "impuestos incluidos" también retrocede la base
  r = parseInvoiceText('Factura por 1210 € impuestos incluidos')
  ok(r.draft.items[0].unitPrice === 1000, 'impuestos incluidos → base 1000')

  // IVA excluido explícito ("más IVA"): el importe es la base, no se retrocede
  r = parseInvoiceText('Factura por 1000 € más IVA 21%')
  ok(r.draft.items[0].unitPrice === 1000 && r.draft.items[0].taxRate === 21, 'más IVA → base intacta')
  ok(!r.warnings.some((w) => /iva incluido/i.test(w)), 'más IVA → sin aviso de incluido')

  // Exento de IVA
  r = parseInvoiceText('Factura por 500 € exento de IVA')
  ok(r.draft.items[0].taxRate === 0, 'exento → 0%')

  // Notas visibles
  r = parseInvoiceText('Factura por 300 €. Nota: pago por transferencia bancaria')
  ok((r.draft.notes ?? '').toLowerCase().includes('transferencia'), 'nota detectada')

  // IRPF / retención
  r = parseInvoiceText('Factura por 1000 € con IRPF 15%')
  ok(r.draft.items[0].withholdingRate === 15, 'IRPF 15%')

  // Descuento
  r = parseInvoiceText('Factura por 1000 € con descuento 10%')
  ok(r.draft.items[0].discountRate === 10, 'descuento 10%')

  // Vencimiento en N días
  r = parseInvoiceText('Factura por 300 €, vencimiento en 15 días')
  ok(r.draft.dueDate != null && dayDiff(r.draft.dueDate, r.draft.issueDate) === 15, 'vencimiento 15 días')

  // Vencimiento a final de mes
  r = parseInvoiceText('Factura por 300 €, pago a final de mes')
  ok(r.draft.dueDate != null && r.draft.dueDate > r.draft.issueDate, 'vencimiento fin de mes')

  // Serie
  r = parseInvoiceText('Factura serie B por 300 €')
  ok(r.draft.series === 'B', 'serie B')

  // Concepto
  r = parseInvoiceText('Factura por gestión inmobiliaria de 500 €')
  ok((r.detected.concept ?? '').includes('gestión'), 'concepto detectado')

  // Cliente único (resuelto contra la lista real)
  const clients: ClientLite[] = [{ id: 'c1', name: 'Inmobiliaria Costa' }, { id: 'c2', name: 'Juan Pérez' }]
  r = parseInvoiceText('Factura a Inmobiliaria Costa por 900 €', clients)
  ok(r.draft.clientId === 'c1', 'cliente único resuelto')

  // Acentos / mayúsculas: "juan perez" ~ "Juan Pérez"
  r = parseInvoiceText('factura a juan perez por 400 €', clients)
  ok(r.draft.clientId === 'c2', 'cliente con acentos/mayúsculas')

  // Coincidencia parcial por apellido (solo "Pérez")
  r = parseInvoiceText('Factura para Pérez, comisión 400 €', clients)
  ok(r.draft.clientId === 'c2', 'cliente por apellido parcial')

  // Cliente ambiguo → no se inventa: sin id, aviso y campo pendiente
  const dup: ClientLite[] = [{ id: 'a', name: 'Ana' }, { id: 'b', name: 'Ana' }]
  r = parseInvoiceText('Factura a Ana por servicios de 200 €', dup)
  ok(r.draft.clientId === null, 'cliente ambiguo → sin id')
  ok((r.detected.ambiguousClients?.length ?? 0) === 2, 'cliente ambiguo → lista de candidatos')
  ok(r.warnings.some((w) => /coinciden/i.test(w)) && r.missingFields.includes('cliente'), 'cliente ambiguo → aviso + pendiente')

  // Cliente inexistente en la lista → pista de nombre pero sin id (no se inventa)
  r = parseInvoiceText('Factura a Pepe Gómez por 100 €', clients)
  ok(r.draft.clientId === null, 'cliente inexistente → sin id')

  // Campos faltantes en texto vacío
  r = parseInvoiceText('')
  ok(r.missingFields.includes('cliente') && r.missingFields.includes('importe') && r.missingFields.includes('concepto'), 'campos faltantes')
  ok(r.confidence <= 10, 'confianza baja sin datos') // solo el IVA por defecto puntúa

  // Estructura del borrador siempre válida (una línea, EUR, serie por defecto)
  ok(r.draft.items.length === 1 && r.draft.currency === 'EUR' && r.draft.series === 'A', 'borrador base válido')

  return fail
}
