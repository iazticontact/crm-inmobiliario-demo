import { validateAssistantUi } from '@/lib/assistant/ui-contract'

export function runAssistantUiContractEvals(): string[] {
  const fail: string[] = []
  const ok = (condition: boolean, message: string) => { if (!condition) fail.push(message) }

  const structured = validateAssistantUi({
    kind: 'data',
    entities: [{ entityType: 'client', entityId: '11111111-1111-4111-8111-111111111111', label: 'ACME' }],
    table: {
      columns: [{ key: 'name', label: 'Cliente' }, { key: 'lines', label: 'Líneas', format: 'number' }],
      rows: [{ name: 'ACME', lines: 42 }],
      truncated: false,
    },
    followUps: [{ label: 'Ver ficha', prompt: 'Resume ACME', kind: 'suggestion' }],
    navigationTarget: { module: 'clients', entityType: 'client', entityId: '11111111-1111-4111-8111-111111111111' },
  })
  ok(structured !== null, 'acepta entidades, tabla, follow-ups y navegación estructurados')
  ok(validateAssistantUi({ kind: 'data', table: { columns: [], rows: [], truncated: 'no' } }) === null, 'rechaza tabla inválida')
  ok(validateAssistantUi({ kind: 'data', providerToken: 'nope' }) === null, 'rechaza claves token/secret')

  return fail
}
