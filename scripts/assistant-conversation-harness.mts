// P60 — Harness de CONVERSACIONES multi-turn contra el CONTRATO real de decisión (decideTurn), el mismo
// que usa la route antes de leer/llamar n8n. Prueba clases de fallo, no frases sueltas. Sin red/secretos.
// Uso: npx tsx --tsconfig tsconfig.json scripts/assistant-conversation-harness.mts

import { decideTurn, type TurnType } from '@/lib/agents/assistant-turn'
import { resolveModuleFromText } from '@/lib/agents/crm-module-catalog'
import { classifyIntent } from '@/lib/agents/intent'
import { parseSalesIntent } from '@/lib/sales-domain'

// Espejo del gate de tryLocalAnswer: ventas transversal se resuelve localmente en turnos de datos/ambiguo.
const SALES_TURNS: TurnType[] = ['data_read', 'data_followup', 'ambiguous']

type Turn = { say: string; expectRead: boolean; note?: string }
type Convo = { name: string; turns: Turn[] }

const convos: Convo[] = [
  { name: 'A · Onboarding / product tour', turns: [
    { say: 'Hola', expectRead: false },
    { say: 'Soy nuevo usuario', expectRead: false },
    { say: 'No sé cómo va esto', expectRead: false },
    { say: 'Hazme un resumen de todo el CRM para entenderlo empezando desde el Dashboard', expectRead: false, note: 'product tour, NO lee' },
    { say: 'No leas datos, explícame el producto', expectRead: false },
    { say: 'Ahora sí, muéstrame mis tareas', expectRead: true, note: 'sale del learning → data' },
  ]},
  { name: 'B · Resumen conceptual vs datos', turns: [
    { say: 'Hazme un resumen para entender el CRM', expectRead: false },
    { say: 'Hazme un resumen del día con mis datos', expectRead: true },
    { say: 'Qué muestra el Dashboard', expectRead: false },
    { say: 'Qué tengo pendiente hoy', expectRead: true },
    { say: 'hazme un resumen', expectRead: false, note: 'ambiguo → aclara, no lee' },
  ]},
  { name: 'C · Cartera', turns: [
    { say: 'Explícame Cartera', expectRead: false },
    { say: '¿tengo algún inmueble publicado?', expectRead: true },
    { say: 'y vendidos', expectRead: true },
    { say: 'acabo de editar, mira otra vez', expectRead: true },
  ]},
  { name: 'D · Ventas transversal', turns: [
    { say: '¿cuántos he vendido?', expectRead: true },
    { say: 'en cartera o en operaciones', expectRead: true },
  ]},
  { name: 'E · Correcciones (no leen)', turns: [
    { say: 'no te he pedido eso', expectRead: false },
    { say: 'te has liado', expectRead: false },
    { say: 'no listes datos', expectRead: false },
  ]},
]

let fails = 0
for (const c of convos) {
  console.log(`\n=== ${c.name} ===`)
  let priorModule: ReturnType<typeof resolveModuleFromText> = null
  let priorEntity: ReturnType<typeof classifyIntent>['entity'] | undefined
  let hasLastResult = false
  let priorWasSales = false
  for (const t of c.turns) {
    const d = decideTurn(t.say, { priorModule, priorEntity, hasLastResult })
    // Gate de ventas transversal (idéntico a tryLocalAnswer): decide la lectura efectiva.
    const salesCaught: boolean = SALES_TURNS.includes(d.turnType) && d.domain !== 'invoicing' && parseSalesIntent(t.say, { priorWasSales }) !== null
    const effectiveRead = d.shouldReadData || salesCaught
    const ok = effectiveRead === t.expectRead
    if (!ok) fails++
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  "${t.say}"  → ${d.turnType}${salesCaught ? '+sales' : ''} read=${effectiveRead}${d.module ? ` mod=${d.module}` : ''}${t.note ? `  (${t.note})` : ''}`)
    // Actualiza contexto como haría la route.
    const m = resolveModuleFromText(t.say); if (m) priorModule = m
    const e = classifyIntent(t.say).entity; if (e !== 'help' && e !== 'unknown') priorEntity = e
    if (effectiveRead) hasLastResult = true
    priorWasSales = salesCaught || parseSalesIntent(t.say) !== null
  }
}
console.log(fails === 0 ? '\nHARNESS: TODO PASS' : `\nHARNESS: ${fails} FALLOS`)
process.exit(fails === 0 ? 0 : 1)
