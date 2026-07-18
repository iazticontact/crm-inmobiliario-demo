// Smoke del prototipo: una sola llamada al planner para confirmar modelo + schema estructurado.
import { readFileSync } from 'node:fs'
function envLocal(n: string): string | undefined { try { for (const l of readFileSync('.env.local', 'utf8').split(/\r?\n/)) { const m = l.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/); if (m && m[1] === n) { let v = m[2]; if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1); return v } } } catch { /* noop */ } return undefined }
const { planTurn } = await import('@/lib/agents/planner/semantic-planner')
const apiKey = envLocal('OPENAI_API_KEY')!
const model = envLocal('OPENAI_ASSISTANT_MODEL') || 'gpt-4.1-mini'
const state = { activeModule: null, activeEntities: [], lastListedEntityType: null, offeredCapabilities: [], pendingAction: null, temporalScope: null }
// Multi-goal: explicar clientes + contar clientes → deben salir 2 goals.
const r = await planTurn('oye explícame para qué sirve el módulo de clientes y de paso dime cuántos tengo', state, { apiKey, model })
console.log(JSON.stringify(r, null, 2).slice(0, 1200))
setTimeout(() => process.exit(r.ok ? 0 : 1), 200)
