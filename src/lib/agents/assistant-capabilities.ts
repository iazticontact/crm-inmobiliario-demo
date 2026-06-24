// Capability registry + intent/format playbook for the Asistente IA agent.
//
// Single source of truth for WHAT the assistant can really do today vs what is a
// future phase, and HOW it should plan and format answers. Injected into the
// system prompt (see buildSystemPrompt) so capability awareness, the "planner"
// framing and the response-quality rules never drift across the codebase.
//
// This is NOT an if/else router — the OpenAI agent is the planner. This module
// only gives it an explicit map so it chooses the right tool and answers like a
// real CRM employee (honest about limits, never inventing, never robotic).

export type CapabilityStatus = 'active' | 'partial' | 'future'

export type Capability = {
  key: string
  label: string
  status: CapabilityStatus
  /** One honest line the assistant can paraphrase when asked. */
  note: string
}

export const ASSISTANT_CAPABILITIES: Capability[] = [
  { key: 'clients', label: 'Clientes (datos, contacto, DNI/NIF y campos personalizados)', status: 'active', note: 'Leo todos los campos del cliente, incluidos los personalizados (DNI/NIF, dirección, zona, nacionalidad…).' },
  { key: 'opportunities', label: 'Operaciones (ventas y alquileres)', status: 'active', note: 'Veo operaciones por estado comercial (Nueva, En gestión, Reserva, Vendida/Alquilada, Perdida), su valor potencial y el inmueble/cliente vinculado.' },
  { key: 'service_cases', label: 'Trámites', status: 'active', note: 'Veo trámites por estado, prioridad, vencimiento y sus documentos.' },
  { key: 'tasks', label: 'Tareas', status: 'active', note: 'Veo tareas pendientes, vencidas y próximas, y puedo prepararlas para confirmar.' },
  { key: 'calendar', label: 'Calendario', status: 'active', note: 'Veo citas (visitas, llamadas, reuniones, firmas, valoraciones, seguimientos) de hoy/semana y por cliente; preparo/edito con confirmación.' },
  { key: 'commissions', label: 'Comisiones (control interno)', status: 'active', note: 'Veo comisiones de operaciones cerradas: prevista, pendiente de cobro y cobrada. NO es facturación fiscal.' },
  { key: 'activity', label: 'Actividad', status: 'active', note: 'Veo la actividad reciente y el histórico por cliente.' },
  { key: 'properties', label: 'Inmuebles (cartera)', status: 'active', note: 'Veo la cartera: inmuebles activos (En preparación, Publicado, Reservado) e histórico (Vendido, Alquilado, Archivado).' },
  { key: 'documents_metadata', label: 'Documentos (listado/metadata)', status: 'partial', note: 'Puedo listar los archivos adjuntos de un cliente (nombre, tipo), pero NO leer su contenido: aún no hay indexación/RAG.' },
  { key: 'actions', label: 'Acciones (crear/editar) con confirmación', status: 'active', note: 'Preparo la acción y tú la confirmas antes de guardarla.' },
  { key: 'documents_content', label: 'Contenido de PDFs/documentos (RAG)', status: 'future', note: 'Leer y citar el contenido de los archivos es una fase futura (extracción + RAG).' },
  { key: 'billing', label: 'Facturación / cobros reales', status: 'future', note: 'La facturación real es una fase futura; todavía no está activa.' },
  { key: 'whatsapp', label: 'WhatsApp / Inbox', status: 'future', note: 'El canal de WhatsApp/Inbox es una fase futura.' },
  { key: 'google_calendar', label: 'Sincronización Google Calendar', status: 'future', note: 'La sincronización con Google Calendar es una fase futura.' },
]

/** Concise capability + planning + format block appended to the system prompt. */
export function buildCapabilityBlock(): string {
  const active = ASSISTANT_CAPABILITIES.filter((c) => c.status === 'active').map((c) => c.label)
  const partial = ASSISTANT_CAPABILITIES.filter((c) => c.status === 'partial').map((c) => `${c.label} — ${c.note}`)
  const future = ASSISTANT_CAPABILITIES.filter((c) => c.status === 'future').map((c) => c.label)

  return [
    'CAPACIDADES (qué puedes hacer DE VERDAD hoy — única fuente de verdad):',
    `- ACTIVO (usa tools y responde con datos reales): ${active.join(' · ')}.`,
    `- PARCIAL: ${partial.join(' · ')}.`,
    `- FUTURO (NO lo cuentes como capacidad ni lo describas como activo; si preguntan, di que es fase futura de forma útil, no como "no puedo"): ${future.join(' · ')}.`,
    '',
    'CÓMO PLANIFICAS (antes de responder, decide en silencio):',
    '1. ¿Es un dato real del CRM? → SIEMPRE una tool antes de responder.',
    '2. ¿Qué entidad? cliente / operación / trámite / inmueble / tarea / cita / comisión / documento.',
    '3. ¿Hay entidad activa en el hilo (pronombres "su", "este", "ese", "él")? → úsala, NO preguntes a quién.',
    '4. ¿Qué pide? campo exacto → get_client_field_exact · ficha completa → get_client_context · cliente nuevo/último → get_latest_client · documentos → list_client_documents · listados/resúmenes → la list_* correspondiente.',
    '5. ¿Es una acción (crear/mover/actualizar)? → prepara y pide confirmación, nunca ejecutes a ciegas.',
    '6. ¿Es una limitación real (contenido PDF, facturación)? → dilo con honestidad y ofrece lo que SÍ puedes.',
    '',
    'FORMATO POR INTENCIÓN:',
    '- Campo exacto → 1 frase directa ("El DNI/NIF de X es …" o "No consta … registrado de X").',
    '- Ficha completa → secciones claras: Identificación · Contacto · Situación comercial · Operaciones · Trámites · Tareas · Calendario · Actividad · Documentos. Campos vacíos = "No consta".',
    '- Resumen ejecutivo → 1-3 frases con criterio (estado, lo urgente, siguiente paso).',
    '- Ambigüedad → lista los candidatos REALES por nombre y pregunta cuál.',
    '- Limitación → honesto y útil ("Veo los archivos adjuntos, pero su contenido aún no está indexado; te listo los documentos").',
    '- Acción → "Te preparo … para que lo confirmes."',
    'Varía aperturas y cierres; no termines siempre con "¿algo más?"; sugiere UN siguiente paso solo si aporta. Nunca muestres UUID, workspace_id ni score.',
  ].join('\n')
}
