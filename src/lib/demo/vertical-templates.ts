// Vertical Pack v1 — static catalog used by /opportunities, dashboard cards,
// docs and (later) the NowLabs agent. Not a database seed: it never gets
// inserted automatically. Workspaces remain empty until the operator creates
// rows from the UI or the agent.
//
// Why static and not seeded:
//   - The catalog must travel with the code so every workspace sees the same
//     reference data instantly, with no migration step.
//   - Seeding would risk overwriting workspace customizations.
//   - We want to surface "what's possible" to the operator without polluting
//     their pipelines with fake opportunities/cases/properties.

export type VerticalKey =
  | 'real_estate'
  | 'immigration'
  | 'professional_services'
  | 'general'

export type VerticalDescriptor = {
  key: VerticalKey
  label: string
  shortLabel: string
  tagline: string
  /** Tailwind classes for the colored pill/card. */
  tone: string
  examples: string[]
}

export const VERTICALS: Record<VerticalKey, VerticalDescriptor> = {
  real_estate: {
    key: 'real_estate',
    label: 'Inmobiliaria',
    shortLabel: 'Inmobiliaria',
    tagline: 'Captaciones, visitas, ofertas y administración de propiedades.',
    tone: 'bg-sky-50 text-sky-700 border-sky-100',
    examples: [
      'Captación de piso en Málaga',
      'Lead de comprador para chalet en Marbella',
      'Visita agendada con propietario',
      'Propuesta a inversor',
    ],
  },
  immigration: {
    key: 'immigration',
    label: 'Extranjería',
    shortLabel: 'Extranjería',
    tagline: 'Trámites, documentación, citas y seguimiento de expedientes.',
    tone: 'bg-violet-50 text-violet-700 border-violet-100',
    examples: [
      'Renovación NIE',
      'Arraigo social',
      'Reagrupación familiar',
      'Solicitud TIE estudiante',
    ],
  },
  professional_services: {
    key: 'professional_services',
    label: 'Servicios',
    shortLabel: 'Servicios',
    tagline: 'Asesorías, consultoras y servicios profesionales.',
    tone: 'bg-emerald-50 text-emerald-700 border-emerald-100',
    examples: [
      'Plan fiscal anual',
      'Constitución de SL',
      'Auditoría laboral',
    ],
  },
  general: {
    key: 'general',
    label: 'General',
    shortLabel: 'General',
    tagline: 'Pipeline genérico cuando no aplica un vertical concreto.',
    tone: 'bg-slate-50 text-slate-600 border-slate-100',
    examples: [
      'Lead inbound',
      'Propuesta general',
      'Reactivar cliente',
    ],
  },
}

// -----------------------------------------------------------------------------
// Pipeline stages
// -----------------------------------------------------------------------------

export type PipelineStage = {
  id: string
  label: string
  description: string
  /** Suggested deal-stage probability for forecast (0-100). */
  defaultProbability: number
  tone: string
}

export const REAL_ESTATE_PIPELINE: PipelineStage[] = [
  { id: 'new',             label: 'Nuevo lead',          description: 'Entró por WhatsApp, web o portal.',          defaultProbability: 10, tone: 'bg-gray-50 text-gray-700 border-gray-100' },
  { id: 'contacted',       label: 'Contactado',          description: 'Primer contacto realizado.',                  defaultProbability: 20, tone: 'bg-sky-50 text-sky-700 border-sky-100' },
  { id: 'qualified',       label: 'Cualificado',         description: 'Presupuesto, necesidad y plazo confirmados.', defaultProbability: 40, tone: 'bg-indigo-50 text-indigo-700 border-indigo-100' },
  { id: 'visit_scheduled', label: 'Visita agendada',     description: 'Cita con cliente o propietario.',             defaultProbability: 55, tone: 'bg-violet-50 text-violet-700 border-violet-100' },
  { id: 'offer',           label: 'Oferta/propuesta',    description: 'Propuesta enviada o reserva firmada.',        defaultProbability: 70, tone: 'bg-amber-50 text-amber-700 border-amber-100' },
  { id: 'negotiation',     label: 'Negociación',         description: 'Cierre en curso.',                            defaultProbability: 85, tone: 'bg-orange-50 text-orange-700 border-orange-100' },
  { id: 'won',             label: 'Cerrado ganado',      description: 'Operación cerrada con éxito.',                defaultProbability: 100, tone: 'bg-emerald-50 text-emerald-700 border-emerald-100' },
  { id: 'lost',            label: 'Cerrado perdido',     description: 'No avanza o eligió otra opción.',             defaultProbability: 0,  tone: 'bg-rose-50 text-rose-700 border-rose-100' },
]

export const IMMIGRATION_PIPELINE: PipelineStage[] = [
  { id: 'consultation', label: 'Consulta recibida',     description: 'El cliente pidió información o cita inicial.',   defaultProbability: 15, tone: 'bg-gray-50 text-gray-700 border-gray-100' },
  { id: 'documentation', label: 'Documentación pendiente', description: 'Esperando documentos del cliente.',          defaultProbability: 30, tone: 'bg-amber-50 text-amber-700 border-amber-100' },
  { id: 'in_review',    label: 'En revisión',            description: 'Equipo revisando expediente.',                  defaultProbability: 50, tone: 'bg-sky-50 text-sky-700 border-sky-100' },
  { id: 'submitted',    label: 'Presentado',             description: 'Expediente presentado en administración.',      defaultProbability: 80, tone: 'bg-violet-50 text-violet-700 border-violet-100' },
  { id: 'in_follow_up', label: 'En seguimiento',         description: 'Esperando respuesta de la administración.',     defaultProbability: 85, tone: 'bg-indigo-50 text-indigo-700 border-indigo-100' },
  { id: 'resolved',     label: 'Resuelto',               description: 'Resolución favorable recibida.',                defaultProbability: 100, tone: 'bg-emerald-50 text-emerald-700 border-emerald-100' },
  { id: 'closed',       label: 'Cerrado',                description: 'Expediente cerrado.',                           defaultProbability: 0,  tone: 'bg-slate-50 text-slate-600 border-slate-100' },
]

export const GENERAL_PIPELINE: PipelineStage[] = [
  { id: 'new',         label: 'Nuevo',          description: 'Sin contactar.',                       defaultProbability: 10, tone: 'bg-gray-50 text-gray-700 border-gray-100' },
  { id: 'contacted',   label: 'Contactado',     description: 'Primer contacto realizado.',           defaultProbability: 25, tone: 'bg-sky-50 text-sky-700 border-sky-100' },
  { id: 'qualified',   label: 'Cualificado',    description: 'Encaje validado.',                     defaultProbability: 45, tone: 'bg-indigo-50 text-indigo-700 border-indigo-100' },
  { id: 'proposal',    label: 'Propuesta',      description: 'Propuesta enviada.',                   defaultProbability: 70, tone: 'bg-amber-50 text-amber-700 border-amber-100' },
  { id: 'won',         label: 'Ganado',         description: 'Cerrado con éxito.',                   defaultProbability: 100, tone: 'bg-emerald-50 text-emerald-700 border-emerald-100' },
  { id: 'lost',        label: 'Perdido',        description: 'Cerrado sin éxito.',                   defaultProbability: 0,  tone: 'bg-rose-50 text-rose-700 border-rose-100' },
]

export function getPipelineForVertical(vertical: VerticalKey): PipelineStage[] {
  if (vertical === 'real_estate') return REAL_ESTATE_PIPELINE
  if (vertical === 'immigration') return IMMIGRATION_PIPELINE
  return GENERAL_PIPELINE
}

// -----------------------------------------------------------------------------
// Service case types — primarily for immigration and professional services
// -----------------------------------------------------------------------------

export type CaseType = {
  id: string
  vertical: VerticalKey
  label: string
  description: string
  documentChecklist: string[]
  defaultSLA: string
}

export const CASE_TYPES: CaseType[] = [
  {
    id: 'nie_renewal',
    vertical: 'immigration',
    label: 'Renovación NIE',
    description: 'Renovación de Número de Identidad de Extranjero.',
    documentChecklist: ['DNI/Pasaporte', 'Empadronamiento', 'TIE/NIE anterior', 'Contrato laboral o medios económicos', 'Tasa modelo 790-012'],
    defaultSLA: '30 días',
  },
  {
    id: 'arraigo_social',
    vertical: 'immigration',
    label: 'Arraigo social',
    description: 'Autorización de residencia por arraigo social.',
    documentChecklist: ['Pasaporte', 'Certificado de empadronamiento histórico (3 años)', 'Contrato laboral firmado', 'Antecedentes penales legalizados', 'Informe de arraigo (CCAA)', 'Tasa 790-052'],
    defaultSLA: '90 días',
  },
  {
    id: 'family_reunification',
    vertical: 'immigration',
    label: 'Reagrupación familiar',
    description: 'Reagrupación de familiares directos.',
    documentChecklist: ['Pasaporte solicitante y reagrupados', 'Libro de familia traducido', 'Vivienda adecuada', 'Medios económicos', 'Seguro médico'],
    defaultSLA: '60 días',
  },
  {
    id: 'student_residence',
    vertical: 'immigration',
    label: 'Residencia estudiante',
    description: 'Autorización de estancia por estudios.',
    documentChecklist: ['Pasaporte', 'Carta de admisión', 'Medios económicos', 'Seguro médico', 'Antecedentes penales'],
    defaultSLA: '30 días',
  },
  {
    id: 'asesoria_fiscal',
    vertical: 'professional_services',
    label: 'Asesoría fiscal',
    description: 'Servicio recurrente de gestión fiscal.',
    documentChecklist: ['Modelos AEAT del último ejercicio', 'Plan de cuentas', 'Facturación emitida y recibida'],
    defaultSLA: 'Mensual',
  },
]

// -----------------------------------------------------------------------------
// Proposal / message templates (used by NowLabs and the Inbox composer)
// -----------------------------------------------------------------------------

export type MessageTemplate = {
  id: string
  vertical: VerticalKey
  channel: 'whatsapp' | 'instagram' | 'email' | 'any'
  category: 'first_contact' | 'follow_up' | 'documentation' | 'proposal' | 'reminder' | 'closing'
  title: string
  body: string
}

export const MESSAGE_TEMPLATES: MessageTemplate[] = [
  // ── Inmobiliaria ──────────────────────────────────────────────────────────
  {
    id: 're.first.buyer',
    vertical: 'real_estate',
    channel: 'whatsapp',
    category: 'first_contact',
    title: 'Primer contacto — comprador',
    body: 'Hola {{nombre}}, soy {{agente}} de {{empresa}}. Gracias por interesarte por {{propiedad}}. ¿Cuándo te vendría bien hablar 5 min para que te enseñe opciones que encajen con tu presupuesto y zona?',
  },
  {
    id: 're.first.seller',
    vertical: 'real_estate',
    channel: 'whatsapp',
    category: 'first_contact',
    title: 'Primer contacto — propietario',
    body: 'Hola {{nombre}}, soy {{agente}}. Vi que quieres vender tu inmueble en {{zona}}. Podemos hacer una valoración gratuita esta semana y te muestro qué precio podríamos sacar y cómo trabajamos. ¿Te encaja {{dia_propuesto}}?',
  },
  {
    id: 're.visit.schedule',
    vertical: 'real_estate',
    channel: 'whatsapp',
    category: 'reminder',
    title: 'Agendar visita',
    body: 'Hola {{nombre}}, te confirmo la visita a {{propiedad}} el {{fecha}} a las {{hora}}. La dirección es {{direccion}}. Si necesitas cambiarla, dímelo y la movemos sin problema.',
  },
  {
    id: 're.post.visit',
    vertical: 'real_estate',
    channel: 'whatsapp',
    category: 'follow_up',
    title: 'Post visita',
    body: 'Hola {{nombre}}, ¿qué tal te quedó la visita a {{propiedad}}? Si te encaja, podemos preparar oferta hoy mismo. Si no, te enseño 2 opciones más parecidas.',
  },
  {
    id: 're.cold.followup',
    vertical: 'real_estate',
    channel: 'whatsapp',
    category: 'follow_up',
    title: 'Seguimiento lead frío',
    body: 'Hola {{nombre}}, hace unos días me preguntabas por inmuebles en {{zona}}. ¿Sigue interesándote? Acaba de entrar {{propiedad_nueva}} que encaja con lo que buscabas.',
  },
  // ── Extranjería ──────────────────────────────────────────────────────────
  {
    id: 'im.first.consultation',
    vertical: 'immigration',
    channel: 'whatsapp',
    category: 'first_contact',
    title: 'Primera consulta extranjería',
    body: 'Hola {{nombre}}, gracias por contactarnos. Para ayudarte con {{tramite}} necesito hacerte 3 preguntas rápidas: 1) ¿Estás dentro o fuera de España ahora? 2) ¿Cuánto tiempo llevas viviendo aquí? 3) ¿Tienes trabajo o contrato firmado? Con eso te digo en 24h qué camino tomamos.',
  },
  {
    id: 'im.documentation.request',
    vertical: 'immigration',
    channel: 'whatsapp',
    category: 'documentation',
    title: 'Solicitud de documentación',
    body: 'Hola {{nombre}}, para avanzar con tu {{tramite}} necesito que me mandes: {{checklist}}. Ideal antes de {{fecha_limite}}. Si te falta algo, dímelo y lo gestionamos juntos.',
  },
  {
    id: 'im.case.status',
    vertical: 'immigration',
    channel: 'whatsapp',
    category: 'follow_up',
    title: 'Estado del expediente',
    body: 'Hola {{nombre}}, te actualizo: tu {{tramite}} está {{estado}}. La administración nos suele tardar {{plazo}}. Te aviso en cuanto haya respuesta o tengamos que aportar algo extra.',
  },
  {
    id: 'im.cita.recordatorio',
    vertical: 'immigration',
    channel: 'whatsapp',
    category: 'reminder',
    title: 'Recordatorio de cita',
    body: 'Hola {{nombre}}, recuerda tu cita el {{fecha}} a las {{hora}} en {{lugar}}. Lleva: {{documentacion}}. Si tienes cualquier duda, dímelo antes.',
  },
  {
    id: 'im.proposal',
    vertical: 'immigration',
    channel: 'email',
    category: 'proposal',
    title: 'Propuesta de servicio extranjería',
    body: 'Buenos días {{nombre}},\n\nTras revisar tu caso, te propongo gestionar tu {{tramite}} bajo las siguientes condiciones:\n\n- Honorarios: {{importe}} (incluye gestión completa hasta resolución).\n- Tasas oficiales aparte: {{tasas}}.\n- Plazo estimado: {{plazo}}.\n\nIncluye: revisión de documentación, presentación, seguimiento administrativo y aviso de resolución.\n\nSi te encaja, respóndeme con un OK y te paso el contrato.\n\nUn saludo,\n{{agente}}',
  },
  // ── General ──────────────────────────────────────────────────────────────
  {
    id: 'gen.proposal',
    vertical: 'general',
    channel: 'email',
    category: 'proposal',
    title: 'Propuesta comercial',
    body: 'Hola {{nombre}},\n\nAdjunto la propuesta para {{servicio}} con un total de {{importe}}. Si te encaja, podemos cerrarlo esta semana.\n\nUn saludo,\n{{agente}}',
  },
  {
    id: 'gen.invoice.reminder',
    vertical: 'general',
    channel: 'email',
    category: 'reminder',
    title: 'Recordatorio factura vencida',
    body: 'Hola {{nombre}}, te recuerdo que la factura {{numero}} por {{importe}} vence el {{fecha_vencimiento}}. Si ya la has pagado, ignora este mensaje. Si no, ¿quieres que te mande de nuevo el enlace de pago?',
  },
]

// -----------------------------------------------------------------------------
// Automation catalog — what NowCRM will eventually trigger via n8n
// -----------------------------------------------------------------------------

export type AutomationTemplate = {
  id: string
  slug: string
  name: string
  vertical: VerticalKey | 'any'
  channel: 'whatsapp' | 'instagram' | 'email' | 'internal' | 'any'
  description: string
  triggerEvent: string
  requires: Array<'n8n' | 'whatsapp' | 'instagram' | 'email' | 'openai'>
  status: 'prepared' | 'requires_config' | 'beta'
}

export const AUTOMATION_TEMPLATES: AutomationTemplate[] = [
  {
    id: 'auto.wa.lead.inbound',
    slug: 'whatsapp-lead-inbound',
    name: 'WhatsApp lead inbound → crear oportunidad',
    vertical: 'any',
    channel: 'whatsapp',
    description: 'Cuando entra un mensaje WhatsApp nuevo de un número no vinculado, crea oportunidad en estado "Nuevo lead" y avisa al operador.',
    triggerEvent: 'whatsapp_message',
    requires: ['n8n', 'whatsapp'],
    status: 'prepared',
  },
  {
    id: 'auto.ig.dm.lead',
    slug: 'instagram-dm-lead',
    name: 'Instagram DM → crear oportunidad',
    vertical: 'any',
    channel: 'instagram',
    description: 'Mensajes directos en Instagram crean oportunidad y se asignan al operador on-duty.',
    triggerEvent: 'instagram_dm',
    requires: ['n8n', 'instagram'],
    status: 'prepared',
  },
  {
    id: 'auto.lead.cold.48h',
    slug: 'cold-lead-48h-followup',
    name: 'Lead frío 48h → follow-up',
    vertical: 'any',
    channel: 'whatsapp',
    description: 'Si un lead no recibe contacto en 48h, NowLabs prepara un follow-up con la plantilla adecuada.',
    triggerEvent: 'lead_cold_48h',
    requires: ['n8n', 'whatsapp', 'openai'],
    status: 'prepared',
  },
  {
    id: 'auto.visit.reminder',
    slug: 'visit-reminder',
    name: 'Cita inmobiliaria → recordatorio',
    vertical: 'real_estate',
    channel: 'whatsapp',
    description: 'Recordatorio automático 24h y 1h antes de una visita a propiedad.',
    triggerEvent: 'calendar_event_created',
    requires: ['n8n', 'whatsapp'],
    status: 'prepared',
  },
  {
    id: 'auto.case.docs.pending',
    slug: 'case-docs-pending',
    name: 'Expediente sin documentación → pedir documentos',
    vertical: 'immigration',
    channel: 'whatsapp',
    description: 'Si un expediente lleva 3 días en estado "Documentación pendiente", manda la lista de documentos al cliente.',
    triggerEvent: 'case_documentation_pending',
    requires: ['n8n', 'whatsapp'],
    status: 'prepared',
  },
  {
    id: 'auto.proposal.followup',
    slug: 'proposal-followup',
    name: 'Propuesta enviada → seguimiento 48h',
    vertical: 'any',
    channel: 'whatsapp',
    description: 'Tras enviar una propuesta, recordatorio amable a las 48h si no hay respuesta.',
    triggerEvent: 'proposal_sent',
    requires: ['n8n', 'whatsapp'],
    status: 'prepared',
  },
  {
    id: 'auto.invoice.overdue',
    slug: 'invoice-overdue-reminder',
    name: 'Factura vencida → recordatorio',
    vertical: 'any',
    channel: 'email',
    description: 'Recordatorio automático cuando una factura supera su fecha de vencimiento.',
    triggerEvent: 'invoice_overdue',
    requires: ['n8n', 'email'],
    status: 'prepared',
  },
  {
    id: 'auto.daily.summary',
    slug: 'daily-summary',
    name: 'Resumen diario → operador',
    vertical: 'any',
    channel: 'internal',
    description: 'Cada mañana NowLabs prepara un resumen con leads nuevos, expedientes activos y cobros pendientes.',
    triggerEvent: 'daily_summary',
    requires: ['n8n', 'openai'],
    status: 'prepared',
  },
  {
    id: 'auto.property.captured',
    slug: 'property-captured',
    name: 'Nueva captación → checklist',
    vertical: 'real_estate',
    channel: 'internal',
    description: 'Al crear una propiedad nueva, NowLabs genera el checklist de documentación del propietario.',
    triggerEvent: 'property_created',
    requires: ['n8n', 'openai'],
    status: 'prepared',
  },
  {
    id: 'auto.post.visit',
    slug: 'post-visit-followup',
    name: 'Visita inmobiliaria → post-visita',
    vertical: 'real_estate',
    channel: 'whatsapp',
    description: 'Mensaje de seguimiento al visitante 2h después de la visita.',
    triggerEvent: 'visit_completed',
    requires: ['n8n', 'whatsapp'],
    status: 'prepared',
  },
]

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

export function getMessageTemplatesForVertical(vertical: VerticalKey): MessageTemplate[] {
  if (vertical === 'general') return MESSAGE_TEMPLATES.filter((t) => t.vertical === 'general')
  return MESSAGE_TEMPLATES.filter((t) => t.vertical === vertical || t.vertical === 'general')
}

export function getAutomationTemplatesForVertical(vertical: VerticalKey): AutomationTemplate[] {
  return AUTOMATION_TEMPLATES.filter((a) => a.vertical === vertical || a.vertical === 'any')
}
