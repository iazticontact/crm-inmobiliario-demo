// Resolución del cerebro del Asistente (P51) — PURA. Blinda el legacy V1: el provider antiguo
// (openai/v1/local) SOLO se activa si `ALLOW_LEGACY_ASSISTANT=true` (no puesto por defecto). Así
// `ASSISTANT_PROVIDER` no puede reactivar una ruta insegura en staging/producción por descuido: el default
// es siempre el cerebro n8n (que pasa por el router y el contrato de tools).

export type AssistantBrain = 'n8n' | 'legacy'

export function resolveAssistantProvider(env: {
  provider?: string | null
  allowLegacy?: string | null
}): AssistantBrain {
  const provider = (env.provider ?? 'n8n').trim().toLowerCase()
  const wantsLegacy = provider === 'openai' || provider === 'v1' || provider === 'local'
  const legacyAllowed = (env.allowLegacy ?? '').trim().toLowerCase() === 'true'
  return wantsLegacy && legacyAllowed ? 'legacy' : 'n8n'
}
