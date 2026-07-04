// Evals GENERALES del clasificador de intención (P48) — propiedades, no frases hardcodeadas.
// Verifican equivalencia de intención (muchas formas → misma entidad), invariancia metamórfica
// (acentos/mayúsculas/plurales), enrutado local vs n8n, aislamiento de Facturación y seguimientos.

import { classifyIntent, type CrmEntity } from '@/lib/agents/intent'

export function runIntentEvals(): string[] {
  const fail: string[] = []
  const ok = (c: boolean, m: string) => { if (!c) fail.push(m) }
  const ent = (q: string) => classifyIntent(q).entity

  // A) Equivalencia de intención: distintas formas → misma entidad.
  const clientsPhrases = ['¿Qué clientes tengo?', 'lista de clientes', 'muéstrame mis clientes', 'cuántos clientes hay', 'dime los clientes registrados', 'clientes']
  for (const q of clientsPhrases) ok(ent(q) === 'clients', `clients: "${q}" → ${ent(q)}`)

  const propPhrases = ['qué inmuebles tengo', 'dime qué pisos hay en cartera', 'enséñame las casas en venta', 'qué viviendas hay disponibles', 'muéstrame la cartera', 'chalets en Getxo']
  for (const q of propPhrases) ok(ent(q) === 'properties', `properties: "${q}" → ${ent(q)}`)

  const opsPhrases = ['mis operaciones abiertas', 'cómo va el pipeline', 'qué oportunidades tengo', 'operaciones en curso']
  for (const q of opsPhrases) ok(ent(q) === 'operations', `operations: "${q}" → ${ent(q)}`)

  const calPhrases = ['próximas citas', 'qué visitas tengo esta semana', 'mi agenda', 'reuniones de hoy']
  for (const q of calPhrases) ok(ent(q) === 'calendar', `calendar: "${q}" → ${ent(q)}`)

  const taskPhrases = ['tareas pendientes', 'qué recordatorios tengo', 'mis tareas']
  for (const q of taskPhrases) ok(ent(q) === 'tasks', `tasks: "${q}" → ${ent(q)}`)

  const docPhrases = ['documentos de un cliente', 'qué archivos hay', 'ver los contratos subidos']
  for (const q of docPhrases) ok(ent(q) === 'documents', `documents: "${q}" → ${ent(q)}`)

  const casePhrases = ['trámites abiertos', 'expedientes en curso', 'qué gestiones hay']
  for (const q of casePhrases) ok(ent(q) === 'service_cases', `service_cases: "${q}" → ${ent(q)}`)

  const commPhrases = ['cuánto he comisionado', 'qué honorarios tengo pendientes', 'comisiones cobradas']
  for (const q of commPhrases) ok(ent(q) === 'commissions', `commissions: "${q}" → ${ent(q)}`)

  // B) Invariancia metamórfica: acentos/mayúsculas/plural no cambian la entidad.
  const pairs: [string, string][] = [
    ['¿Qué clientes tengo?', 'QUE CLIENTE TENGO'],
    ['muéstrame los pisos', 'muestrame el piso'],
    ['próximas citas', 'PROXIMA CITA'],
    ['operaciones abiertas', 'operacion abierta'],
  ]
  for (const [a, b] of pairs) ok(ent(a) === ent(b), `metamórfico: "${a}" (${ent(a)}) ≠ "${b}" (${ent(b)})`)

  // C) Facturación aislada.
  for (const q of ['cuánto he facturado', 'emitir una factura', 'facturas pendientes', 'el IVA de este mes']) {
    const r = classifyIntent(q)
    ok(r.entity === 'invoicing' && r.blockedReason === 'invoicing_isolated' && !r.shouldUseLocal, `invoicing bloqueado: "${q}"`)
  }

  // D) Ayuda → local (capacidades).
  for (const q of ['¿qué puedes hacer?', 'ayúdame', '¿para qué sirves?']) {
    ok(classifyIntent(q).entity === 'help' && classifyIntent(q).shouldUseLocal, `help local: "${q}"`)
  }

  // E) Escrituras → NO local (las maneja el cerebro general / fallback determinista).
  for (const q of ['crea un cliente nuevo', 'agenda una visita mañana', 'cambia la etapa de la operación', 'elimina el piso']) {
    const r = classifyIntent(q)
    ok(!r.shouldUseLocal && r.shouldUseN8n, `escritura no-local: "${q}"`)
  }

  // F) Lecturas básicas → local-first (no dependen de n8n).
  for (const q of ['qué clientes tengo', 'pisos en cartera', 'próximas citas', 'tareas pendientes']) {
    ok(classifyIntent(q).shouldUseLocal, `local-first lectura: "${q}"`)
  }

  // G) Búsqueda por nombre → action search + término extraído.
  const s = classifyIntent('busca el cliente Javier')
  ok(s.entity === 'clients' && s.action === 'search' && s.searchTerm === 'javier', `búsqueda cliente: ${JSON.stringify(s)}`)

  // H) Seguimiento contextual: hereda la entidad del tema previo.
  const fu = classifyIntent('y el de Malasaña?', { priorEntity: 'properties' })
  ok(fu.entity === 'properties' && fu.followUpType !== 'none' && fu.needsContext, `follow-up hereda properties: ${JSON.stringify(fu)}`)
  // Sin contexto previo, un follow-up corto no se resuelve a una entidad concreta con datos.
  const fuNo = classifyIntent('y el de Malasaña?')
  ok(fuNo.needsContext === false, 'follow-up sin contexto no marca needsContext con entidad previa')

  // I) Confianza: entidad clara ⇒ confianza > 0; desconocida ⇒ 0.
  ok(classifyIntent('qué clientes tengo').confidence > 0.5, 'confianza alta en intención clara')
  ok(classifyIntent('hmmm no sé xd').confidence === 0, 'confianza 0 en ruido')

  return fail
}

// Utilidad para otras suites: la entidad de un texto.
export function entityOf(q: string): CrmEntity { return classifyIntent(q).entity }
