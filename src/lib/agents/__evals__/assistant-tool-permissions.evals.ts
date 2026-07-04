// Evals de la capa de PERMISOS de tools por turno (P50) — propiedades.
// shouldReadData=false ⇒ allowedTools=[]; Facturación nunca autoriza tools; data_read → tools del dominio.

import { decideTurn } from '@/lib/agents/assistant-turn'
import { allowedToolsForTurn, isToolAllowed, isForbiddenAssistantTool } from '@/lib/agents/assistant-tool-permissions'

export function runToolPermissionEvals(): string[] {
  const fail: string[] = []
  const ok = (c: boolean, m: string) => { if (!c) fail.push(m) }

  // A) Cualquier turno NO-datos ⇒ sin tools.
  const nonData = [
    'por qué me listas los clientes',   // meta
    'no me refiero a los inmuebles',    // corrección
    'esto está mal',                    // queja
    'te equivocas',                     // discrepancia
    '¿qué puedes hacer?',               // capacidad
    '¿cómo funciona la cartera?',       // cómo-funciona
    'si creo un cliente, ¿podrás verlo?', // futuro
    'hola',                             // social
    'mmm',                              // ambiguo
  ]
  for (const q of nonData) {
    const d = decideTurn(q)
    ok(!d.shouldReadData, `no-datos no lee: "${q}" (${d.turnType})`)
    ok(allowedToolsForTurn(d).length === 0, `no-datos ⇒ sin tools: "${q}" (${d.turnType}) → ${JSON.stringify(allowedToolsForTurn(d))}`)
  }

  // B) Lectura por dominio ⇒ tools del dominio.
  const readClients = decideTurn('muéstrame los clientes')
  ok(allowedToolsForTurn(readClients).includes('clients.read') && allowedToolsForTurn(readClients).includes('clients.search'), 'clientes read/search permitidos')
  ok(isToolAllowed(readClients, 'clients.read'), 'isToolAllowed clients.read en lectura clientes')
  ok(!isToolAllowed(readClients, 'properties.read'), 'no permite tools de otro dominio')

  const readProps = decideTurn('¿qué inmuebles hay en cartera?')
  ok(allowedToolsForTurn(readProps).includes('properties.read'), 'inmuebles read permitido')

  // C) Facturación nunca autoriza tools (aislada).
  const inv = decideTurn('¿cuánto he facturado este mes?')
  ok(allowedToolsForTurn(inv).length === 0, 'facturación sin tools')
  ok(!isToolAllowed(decideTurn('muéstrame las facturas'), 'invoicing.read'), 'invoicing.read nunca permitido')

  // D) Tools de facturación SIEMPRE prohibidas, pase lo que pase.
  ok(isForbiddenAssistantTool('get_invoices_summary'), 'get_invoices_summary prohibida')
  ok(isForbiddenAssistantTool('invoicing.read') && isForbiddenAssistantTool('invoicing.search'), 'invoicing.* prohibidas')
  ok(!isForbiddenAssistantTool('clients.read'), 'clients.read no está prohibida globalmente')
  // isToolAllowed rechaza una prohibida incluso si el turno fuese de datos.
  ok(!isToolAllowed(readClients, 'get_invoices_summary'), 'prohibida rechazada aun en turno de datos')

  // E) Escritura ⇒ solo write_prepare (nunca ejecutar), y no tools de lectura.
  const write = decideTurn('crea un cliente nuevo')
  const wtools = allowedToolsForTurn(write)
  ok(write.shouldWriteData && !write.shouldReadData, 'escritura no lee')
  ok(wtools.every((t) => t.endsWith('.write_prepare')), 'escritura solo write_prepare')
  ok(!wtools.includes('clients.read'), 'escritura no autoriza lectura')

  return fail
}
