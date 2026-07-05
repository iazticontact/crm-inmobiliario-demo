// Evals de blindaje del legacy (P51) — propiedades. El provider antiguo (openai/v1/local) SOLO se activa
// con ALLOW_LEGACY_ASSISTANT=true. Por defecto, cualquier valor de ASSISTANT_PROVIDER → n8n (router +
// contrato de tools). Así el legacy no puede saltarse el router ni leer invoices en staging por descuido.

import { resolveAssistantProvider } from '@/lib/agents/assistant-provider'
import { decideTurn } from '@/lib/agents/assistant-turn'
import { allowedToolsForTurn } from '@/lib/agents/assistant-tool-permissions'

export function runLegacyHardeningEvals(): string[] {
  const fail: string[] = []
  const ok = (c: boolean, m: string) => { if (!c) fail.push(m) }

  // Default seguro: sin flag, ningún provider antiguo activa legacy.
  ok(resolveAssistantProvider({}) === 'n8n', 'default → n8n')
  ok(resolveAssistantProvider({ provider: 'n8n' }) === 'n8n', 'n8n → n8n')
  for (const p of ['openai', 'v1', 'local', 'OPENAI', 'V1', 'Local']) {
    ok(resolveAssistantProvider({ provider: p }) === 'n8n', `legacy sin flag → n8n (${p})`)
    ok(resolveAssistantProvider({ provider: p, allowLegacy: 'false' }) === 'n8n', `legacy con flag false → n8n (${p})`)
  }
  // Solo con el flag explícito se activa legacy.
  ok(resolveAssistantProvider({ provider: 'openai', allowLegacy: 'true' }) === 'legacy', 'legacy con flag true')
  ok(resolveAssistantProvider({ provider: 'V1', allowLegacy: 'TRUE' }) === 'legacy', 'case-insensitive flag')
  // Un provider desconocido nunca es legacy.
  ok(resolveAssistantProvider({ provider: 'foobar', allowLegacy: 'true' }) === 'n8n', 'provider desconocido → n8n')

  // Invariante de router (defensa): ningún turno no-datos autoriza tools (ni local, ni n8n, ni legacy).
  const corpus = [
    'hola', 'gracias', '¿qué puedes hacer?', '¿cómo funciona la cartera?', 'si creo un cliente ¿podrás verlo?',
    'por qué me listas los inmuebles', 'no me refiero a los clientes', 'esto está mal', 'te equivocas', 'mmm',
  ]
  for (const q of corpus) {
    const d = decideTurn(q)
    if (!d.shouldReadData && !d.shouldWriteData) ok(allowedToolsForTurn(d).length === 0, `router: no-datos ⇒ sin tools: "${q}" (${d.turnType})`)
    ok(typeof d.turnType === 'string' && d.turnType.length > 0, `router: todo turno produce decisión: "${q}"`)
  }

  return fail
}
