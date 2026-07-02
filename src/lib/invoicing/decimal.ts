// Helpers PUROS para entrada de números en Facturación (P40). Permiten escribir con libertad (vacío
// temporal, coma o punto decimal) y normalizar al confirmar. Sin dependencias ni I/O → testeables.

// Texto que el usuario está escribiendo → número, o null si aún no es un número válido (vacío, "-", ".", ",").
export function parseDecimal(raw: string): number | null {
  const t = (raw ?? '').trim().replace(',', '.')
  if (t === '' || t === '-' || t === '.' || t === '-.') return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

// ¿Es un texto parcial válido mientras se escribe? (dígitos, un separador decimal, signo negativo opcional)
export function isEditingDecimal(raw: string, allowNegative = false): boolean {
  return new RegExp(allowNegative ? '^-?\\d*[.,]?\\d*$' : '^\\d*[.,]?\\d*$').test(raw ?? '')
}

export function clampNumber(n: number, opts: { min?: number; max?: number; decimals?: boolean } = {}): number {
  let v = Number.isFinite(n) ? n : 0
  if (typeof opts.min === 'number' && v < opts.min) v = opts.min
  if (typeof opts.max === 'number' && v > opts.max) v = opts.max
  if (opts.decimals === false) v = Math.trunc(v)
  return v
}

// Número → texto para mostrar (sin ceros ni notación rara). 0 → "0".
export function formatDecimal(n: number): string {
  return Number.isFinite(n) ? String(n) : '0'
}
