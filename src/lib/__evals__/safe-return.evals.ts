// Evals de navegación contextual segura (ADDENDUM P44). `runSafeReturnEvals()` verifica la lógica PURA de
// `safeReturnTo` (anti open-redirect: solo rutas internas relativas) y de `returnToLabel` (texto del botón).
// Sin runner en el repo; se ejecuta desde un runner temporal con tsx.

import { safeReturnTo, returnToLabel } from '@/lib/safe-return'

export function runSafeReturnEvals(): string[] {
  const fail: string[] = []
  const ok = (raw: string | null | undefined, expected: string | null, msg: string) => {
    if (safeReturnTo(raw) !== expected) fail.push(`${msg} → esperado ${JSON.stringify(expected)}, obtenido ${JSON.stringify(safeReturnTo(raw))}`)
  }

  // --- ACEPTADOS: rutas internas relativas ---
  ok('/opportunities?tab=commissions', '/opportunities?tab=commissions', 'ruta interna Comisiones')
  ok('/clients/abc-123', '/clients/abc-123', 'ruta interna ficha cliente')
  ok('/facturacion', '/facturacion', 'ruta interna Facturación')
  ok(encodeURIComponent('/clients/abc-123'), '/clients/abc-123', 'ruta interna codificada (encodeURIComponent)')
  ok('/opportunities?tab=commissions&x=1', '/opportunities?tab=commissions&x=1', 'ruta interna con varios query params')

  // --- RECHAZADOS: open redirect / URLs externas → null (fallback a /facturacion en la UI) ---
  ok('https://malicioso.com', null, 'URL externa https:// debe rechazarse')
  ok('http://malicioso.com', null, 'URL externa http:// debe rechazarse')
  ok('//malicioso.com', null, 'protocol-relative //malicioso.com debe rechazarse')
  ok('/\\malicioso.com', null, 'truco /\\ (se normaliza a //) debe rechazarse')
  ok(encodeURIComponent('https://malicioso.com'), null, 'URL externa codificada debe rechazarse')
  ok('javascript:alert(1)', null, 'esquema javascript: debe rechazarse')
  ok('/javascript:alert(1)', null, 'esquema tras la barra debe rechazarse')
  ok('relativa/sin/barra', null, 'ruta sin barra inicial debe rechazarse')
  ok('', null, 'cadena vacía → null (fallback)')
  ok(null, null, 'null → null (fallback)')
  ok(undefined, null, 'undefined → null (fallback)')
  ok('/' + 'a'.repeat(600), null, 'ruta absurdamente larga (>512) debe rechazarse')
  ok('/con\tcontrol', null, 'ruta con carácter de control debe rechazarse')

  // Decodificación inválida no debe lanzar; devuelve null.
  ok('%E0%A4%A', null, 'secuencia percent-encoding inválida → null (sin excepción)')

  // --- returnToLabel: texto del botón según origen ---
  const label = (p: string | null, expected: string, msg: string) => {
    if (returnToLabel(p) !== expected) fail.push(`${msg} → esperado ${JSON.stringify(expected)}, obtenido ${JSON.stringify(returnToLabel(p))}`)
  }
  label('/opportunities?tab=commissions', 'Volver a Comisiones', 'label Comisiones')
  label('/clients/abc-123', 'Volver al cliente', 'label cliente')
  label('/facturacion', 'Volver a Facturación', 'label Facturación')
  label(null, 'Cerrar', 'sin returnTo → Cerrar')
  label('/otra-cosa', 'Volver', 'ruta interna desconocida → Volver genérico')

  return fail
}
