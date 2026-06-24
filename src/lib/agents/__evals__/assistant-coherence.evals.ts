// Evals de coherencia del Asistente con el CRM final (P10).
//
// El repo NO tiene runner de evals (sin jest/vitest, y ejecutar el LLM real sería costoso y
// flaky). Este fichero es la FUENTE DE VERDAD de las expectativas: cada caso documenta qué tool
// debería usar el agente y qué vocabulario DEBE / NO DEBE aparecer en la respuesta visible.
// Sirve para QA manual y para enchufar un runner en el futuro sin reinventar los casos.

export type AssistantEval = {
  /** Pregunta del usuario. */
  question: string
  /** Tool(s) esperada(s). 'llm' = el router difiere y el LLM elige (se indica la tool objetivo). */
  expectedTool: string
  /** Vocabulario que DEBE aparecer en la respuesta (CRM actual). */
  mustMention: string[]
  /** Vocabulario PROHIBIDO en la respuesta visible. */
  mustNotMention: string[]
  notes?: string
}

const FORBIDDEN_GLOBAL = ['pipeline', 'expediente', 'oportunidad', 'probabilidad', 'lead score']

export const ASSISTANT_COHERENCE_EVALS: AssistantEval[] = [
  {
    question: '¿Qué inmuebles tengo activos?',
    expectedTool: 'list_properties',
    mustMention: ['inmueble', 'activo'],
    mustNotMention: [...FORBIDDEN_GLOBAL, 'propiedad del pipeline'],
    notes: 'Activos = En preparación / Publicado / Reservado. No incluir histórico (vendido/alquilado/archivado).',
  },
  {
    question: '¿Qué operaciones están en gestión?',
    expectedTool: 'list_opportunities',
    mustMention: ['operación', 'en gestión'],
    mustNotMention: FORBIDDEN_GLOBAL,
    notes: 'Estado comercial "En gestión" (etapas internas contacted/qualified/visit_scheduled/offer/negotiation).',
  },
  {
    question: '¿Qué trámites vencen?',
    expectedTool: 'list_pending_items',
    mustMention: ['trámite', 'vence'],
    mustNotMention: FORBIDDEN_GLOBAL,
    notes: 'Trámites abiertos con due_date próximo o vencido. Alternativa: list_service_cases.',
  },
  {
    question: '¿Qué citas tengo hoy?',
    expectedTool: 'upcoming_events',
    mustMention: ['cita'],
    mustNotMention: FORBIDDEN_GLOBAL,
    notes: 'Router determinista → upcoming_events ("citas de hoy").',
  },
  {
    question: '¿Qué comisiones tengo pendientes?',
    expectedTool: 'workspace_overview',
    mustMention: ['comisión', 'pendiente'],
    mustNotMention: [...FORBIDDEN_GLOBAL, 'factura', 'facturación'],
    notes: 'Comisión = control interno (prevista/pendiente/cobrada de operaciones cerradas). Nunca "facturación".',
  },
  {
    question: '¿Este inmueble está vendido o activo?',
    expectedTool: 'list_properties',
    mustMention: ['estado'],
    mustNotMention: FORBIDDEN_GLOBAL,
    notes: 'Responder por el estado del inmueble: activo (En preparación/Publicado/Reservado) o histórico (Vendido/Alquilado/Archivado).',
  },
  {
    question: 'Enséñame el resumen de Roberto Díaz',
    expectedTool: 'get_client_context',
    mustMention: ['operaciones', 'trámites', 'citas'],
    mustNotMention: FORBIDDEN_GLOBAL,
    notes: 'Ficha 360: contacto + operaciones + trámites + tareas + citas + actividad. Nunca mostrar lead score.',
  },
]
