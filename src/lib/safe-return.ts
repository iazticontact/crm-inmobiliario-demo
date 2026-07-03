// Navegación contextual segura (P44) — PURO. Valida un `returnTo` para volver al origen (Comisiones,
// ficha de cliente, Facturación) SIN riesgo de open-redirect: solo rutas INTERNAS relativas. Rechaza
// URLs externas, `//`, esquemas (`http:`, `javascript:`…) y caracteres de control. Fallback: null.

function hasControlChars(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c < 0x20 || c === 0x7f) return true
  }
  return false
}

export function safeReturnTo(raw: string | null | undefined): string | null {
  if (!raw) return null
  let s: string
  try { s = decodeURIComponent(raw) } catch { return null }
  s = s.trim()
  if (s.length === 0 || s.length > 512) return null
  if (!s.startsWith('/')) return null                     // debe ser ruta interna relativa
  if (s.startsWith('//')) return null                     // protocol-relative → open redirect
  if (s.startsWith('/\\')) return null                    // truco /\ (se normaliza a //)
  if (hasControlChars(s)) return null                     // caracteres de control
  if (/^\/[a-z][a-z0-9+.\-]*:/i.test(s)) return null       // esquema tras la barra (paranoia)
  return s
}

// Texto del botón según el origen.
export function returnToLabel(path: string | null | undefined): string {
  if (!path) return 'Cerrar'
  if (path.startsWith('/opportunities')) return 'Volver a Comisiones'
  if (path.startsWith('/clients/')) return 'Volver al cliente'
  if (path.startsWith('/facturacion')) return 'Volver a Facturación'
  return 'Volver'
}
