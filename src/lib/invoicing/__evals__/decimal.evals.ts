// Evals de la entrada numérica de Facturación (P40) — PURAS. Cubren el comportamiento del DecimalInput:
// vaciar deja null (los cálculos usan 0), blur vacío → 0/min, escribir con coma o punto, límites, y que
// nunca se produzca NaN. `runDecimalEvals()` devuelve los fallos (vacío = OK).

import { parseDecimal, isEditingDecimal, clampNumber, formatDecimal } from '../decimal'

// Simula el commit en vivo (onChange): vacío/parcial → 0; válido → clamp.
const onChange = (raw: string, opts: { min?: number; max?: number; decimals?: boolean } = {}) => {
  const p = parseDecimal(raw)
  return p == null ? 0 : clampNumber(p, opts)
}
// Simula el blur: vacío → min/0; válido → clamp.
const onBlur = (text: string, opts: { min?: number; max?: number; decimals?: boolean } = {}) => {
  const p = parseDecimal(text)
  return p == null ? clampNumber(opts.min ?? 0, opts) : clampNumber(p, opts)
}

export function runDecimalEvals(): string[] {
  const fail: string[] = []
  const ok = (c: boolean, m: string) => { if (!c) fail.push(m) }

  // Vaciar el "0": mientras se escribe, vacío es válido y no es un número (null); el cálculo usa 0.
  ok(parseDecimal('') === null, 'vacío → null (se puede borrar)')
  ok(isEditingDecimal('') === true, 'vacío es edición válida')
  ok(onChange('') === 0, 'vacío en onChange → 0 para cálculos')

  // Blur vacío → 0 (o min)
  ok(onBlur('', { min: 0 }) === 0, 'blur vacío → 0')
  ok(onBlur('', { min: 1 }) === 1, 'blur vacío con min 1 → 1')

  // Escribir libremente
  ok(onChange('15') === 15, 'escribir 15')
  ok(parseDecimal('10,5') === 10.5, 'coma decimal 10,5')
  ok(parseDecimal('10.5') === 10.5, 'punto decimal 10.5')
  ok(isEditingDecimal('10,') === true, 'permite "10," mientras escribe')
  ok(parseDecimal('10.') === 10, '"10." → 10')

  // Entradas inválidas no rompen ni generan NaN
  ok(parseDecimal('abc') === null, 'texto no numérico → null')
  ok(!Number.isNaN(onChange('abc')), 'abc no genera NaN')
  ok(isEditingDecimal('abc') === false, 'abc no es edición válida (se ignora)')
  ok(isEditingDecimal('1.2.3') === false, 'dos separadores no válidos')

  // Límites: descuento 0–100, IVA/IRPF ≥ 0, sin negativos por defecto
  ok(clampNumber(150, { max: 100 }) === 100, 'descuento máx 100')
  ok(clampNumber(-5, { min: 0 }) === 0, 'no negativo (min 0)')
  ok(onChange('0', { min: 0 }) === 0, 'IVA/IRPF puede ser 0 (no se fuerza a 21)')
  ok(onBlur('21', { min: 0 }) === 21, 'IVA 21 se conserva')
  ok(onBlur('15', { min: 0 }) === 15, 'IRPF 15 se conserva')

  // Formato de salida
  ok(formatDecimal(0) === '0', 'formatDecimal(0) = "0"')
  ok(formatDecimal(10.5) === '10.5', 'formatDecimal(10.5)')
  ok(formatDecimal(NaN) === '0', 'formatDecimal(NaN) = "0" (sin NaN)')

  // Negativos solo si allowNegative
  ok(isEditingDecimal('-5', false) === false, 'negativo bloqueado por defecto')
  ok(isEditingDecimal('-5', true) === true, 'negativo permitido si allowNegative')

  return fail
}
