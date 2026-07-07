// Catálogo CENTRAL de módulos del CRM (P53) — PURO. Fuente de verdad para que el Asistente EXPLIQUE el
// producto (guía, onboarding, navegación, "¿qué muestra esta pantalla?") sin inventar y SIN leer datos.
// Explicar un módulo NUNCA consulta la base de datos; solo al final se ofrece consultar datos reales.

import { foldText } from '@/lib/real-estate-search'

export type CrmModuleId =
  | 'dashboard' | 'clients' | 'portfolio' | 'operations' | 'commissions' | 'invoicing'
  | 'calendar' | 'tasks' | 'cases' | 'documents' | 'settings' | 'assistant'

export type CrmModule = {
  id: CrmModuleId
  name: string
  aliases: string[]        // términos plegados (sin acentos) que refieren al módulo
  nav: string              // dónde está en la app
  purpose: string          // para qué sirve (1 frase)
  shows: string            // qué muestra / resume (1-2 frases)
  actions: string          // acciones principales del usuario
  assistantCan: string     // qué puede hacer el Asistente aquí
  limits?: string          // límites (si los hay)
  offerData: boolean       // si tiene sentido ofrecer "¿te muestro tus datos actuales?"
}

export const CRM_MODULES: Record<CrmModuleId, CrmModule> = {
  dashboard: {
    id: 'dashboard', name: 'Dashboard', nav: 'Menú lateral → Dashboard',
    aliases: ['dashboard', 'panel', 'inicio', 'resumen general', 'pagina principal', 'portada'],
    purpose: 'Es la vista ejecutiva del negocio: en un vistazo sabes cómo va todo.',
    shows: 'KPIs del día, el ciclo económico (pendiente de facturar, facturado y cobrado — siempre sobre honorarios, nunca sobre el precio del inmueble), actividad reciente y próximas citas.',
    actions: 'Revisar el estado general y saltar al módulo que necesite atención.',
    assistantCan: 'Explicarte cada métrica y, si me lo pides, consultarte los datos actuales (clientes, citas, tareas…).',
    offerData: true,
  },
  clients: {
    id: 'clients', name: 'Clientes', nav: 'Menú lateral → Clientes',
    aliases: ['clientes', 'cliente', 'contactos', 'compradores', 'vendedores', 'leads', 'ficha de cliente'],
    purpose: 'Guarda a tus contactos (compradores, vendedores, inversores) con toda su información.',
    shows: 'La ficha de cada cliente: datos de contacto, sus operaciones con estado económico, citas, tareas y documentos.',
    actions: 'Crear/editar clientes, abrir su ficha, vincular operaciones y subir documentos.',
    assistantCan: 'Listarlos, buscarlos por nombre y resumirte su situación cuando me lo pidas.',
    offerData: true,
  },
  portfolio: {
    id: 'portfolio', name: 'Cartera (Inmuebles)', nav: 'Menú lateral → Cartera → pestaña Inmuebles',
    aliases: ['cartera', 'inmuebles', 'inmueble', 'propiedades', 'pisos', 'viviendas', 'portfolio', 'stock'],
    purpose: 'Es tu inventario de inmuebles en gestión.',
    shows: 'Cada inmueble con tipo, operación (venta/alquiler), estado, precio, zona, superficie (m²), habitaciones, baños, propietario y fotos.',
    actions: 'Añadir/editar inmuebles, filtrar por zona/tipo/precio/características y archivar los cerrados.',
    assistantCan: 'Buscar en la cartera por zona, precio, tipo, m², habitaciones o baños cuando me lo pidas.',
    offerData: true,
  },
  operations: {
    id: 'operations', name: 'Operaciones', nav: 'Menú lateral → Cartera → pestaña Operaciones',
    aliases: ['operaciones', 'operacion', 'pipeline', 'oportunidades', 'ventas en curso', 'negociaciones', 'embudo'],
    purpose: 'Es tu pipeline comercial: cada compra/venta/alquiler en curso.',
    shows: 'Cada operación con su cliente, inmueble, etapa, valor y comisión pactada.',
    actions: 'Mover etapas, editar valor/probabilidad y cerrar como ganada o perdida.',
    assistantCan: 'Mostrarte las abiertas y su estado cuando me lo pidas.',
    offerData: true,
  },
  commissions: {
    id: 'commissions', name: 'Comisiones', nav: 'Menú lateral → Cartera → pestaña Comisiones',
    aliases: ['comisiones', 'comision', 'honorarios', 'mis honorarios'],
    purpose: 'Control interno de los honorarios de cada operación (qué falta por facturar y cobrar).',
    shows: 'Pestañas Por hacer / Facturadas / Cobradas / Potenciales, con el estado de cada comisión y su siguiente paso (crear factura, abrir factura, ver factura).',
    actions: 'Registrar cobros internos, crear la factura de honorarios y seguir el ciclo hasta «Cerrado».',
    assistantCan: 'Explicarte el ciclo; el detalle vive en Cartera → Comisiones.',
    limits: 'El IVA se calcula sobre los honorarios, nunca sobre el precio del inmueble.',
    offerData: false,
  },
  invoicing: {
    id: 'invoicing', name: 'Facturación', nav: 'Menú lateral → Módulos extra → Facturación (PRO)',
    aliases: ['facturacion', 'facturas', 'factura', 'iva', 'irpf', 'cobros oficiales'],
    purpose: 'Emite los documentos oficiales: factura con numeración, IVA/IRPF, PDF con tu logo y estado de cobro.',
    shows: 'Tus facturas por estado (borrador, emitida, cobrada), el resumen financiero y la papelera.',
    actions: 'Crear/emitir facturas (también desde una comisión), descargar PDF y marcar cobros.',
    assistantCan: 'Explicarte cómo funciona, pero NO leo facturas desde aquí: se gestionan en su módulo.',
    limits: 'Módulo aislado del Asistente por diseño (datos fiscales).',
    offerData: false,
  },
  calendar: {
    id: 'calendar', name: 'Calendario', nav: 'Menú lateral → Calendario',
    aliases: ['calendario', 'citas', 'cita', 'agenda', 'visitas', 'reuniones'],
    purpose: 'Reúne tus citas y visitas, con integración con Google Calendar.',
    shows: 'Las citas con fecha, hora, cliente e inmueble asociados.',
    actions: 'Crear/editar citas, vincularlas a clientes/inmuebles y sincronizar con Google.',
    assistantCan: 'Decirte tus próximas citas cuando me lo pidas.',
    offerData: true,
  },
  tasks: {
    id: 'tasks', name: 'Tareas', nav: 'Dashboard y ficha de cliente → Tareas',
    aliases: ['tareas', 'tarea', 'pendientes', 'recordatorios', 'to do'],
    purpose: 'Tus pendientes del día a día, con fecha límite y prioridad.',
    shows: 'Las tareas pendientes ordenadas por vencimiento, con su cliente asociado.',
    actions: 'Crear, completar y priorizar tareas.',
    assistantCan: 'Listarte las pendientes cuando me lo pidas.',
    offerData: true,
  },
  cases: {
    id: 'cases', name: 'Trámites', nav: 'Menú lateral → Cartera → pestaña Trámites',
    aliases: ['tramites', 'tramite', 'expedientes', 'expediente', 'gestiones', 'diligencias'],
    purpose: 'Expedientes y gestiones (nota simple, tasación, contrato…) asociados a un cliente o inmueble.',
    shows: 'Cada trámite con su estado, prioridad, vencimiento y documentos adjuntos.',
    actions: 'Crear trámites, cambiar su estado y adjuntar documentación.',
    assistantCan: 'Mostrarte los abiertos cuando me lo pidas.',
    offerData: true,
  },
  documents: {
    id: 'documents', name: 'Documentos', nav: 'Dentro de cada cliente, inmueble o trámite → Documentos',
    aliases: ['documentos', 'documento', 'archivos', 'ficheros', 'contratos subidos', 'adjuntos'],
    purpose: 'Guarda los archivos de cada cliente, inmueble o trámite en un solo sitio.',
    shows: 'La lista de archivos con nombre, tipo y fecha.',
    actions: 'Subir, descargar y organizar documentos por entidad.',
    assistantCan: 'Decirte qué documentos hay (nombre, tipo, fecha); nunca leo su contenido.',
    limits: 'Solo metadata; el contenido de los archivos no se consulta.',
    offerData: true,
  },
  settings: {
    id: 'settings', name: 'Configuración', nav: 'Menú lateral → Configuración',
    aliases: ['configuracion', 'ajustes', 'empresa', 'equipo', 'integraciones', 'preferencias'],
    purpose: 'Datos de tu empresa (para las facturas), equipo e integraciones (Google Calendar…).',
    shows: 'La configuración de la cuenta: emisor de facturas, usuarios, conexiones.',
    actions: 'Editar los datos de empresa, invitar al equipo y conectar integraciones.',
    assistantCan: 'Explicarte cada apartado; los cambios se hacen desde la propia pantalla.',
    offerData: false,
  },
  assistant: {
    id: 'assistant', name: 'Asistente IA', nav: 'Menú lateral → Asistente IA',
    aliases: ['asistente', 'copiloto', 'chat', 'ia'],
    purpose: 'Soy tu copiloto dentro del CRM: respondo dudas del producto y consulto tus datos cuando me lo pides.',
    shows: 'Este chat, con acciones rápidas para las consultas más comunes.',
    actions: 'Preguntar en lenguaje natural: explicar módulos, buscar clientes/inmuebles, ver citas o tareas.',
    assistantCan: 'Explicar el CRM y leer datos reales de tu cuenta (solo lectura, con tus permisos). No leo facturas.',
    offerData: false,
  },
}

export const ALL_MODULE_IDS = Object.keys(CRM_MODULES) as CrmModuleId[]

// ── Resolución de módulo por texto (aliases plegados; el alias MÁS LARGO gana) ───────────────────────
export function resolveModuleFromText(text: string): CrmModuleId | null {
  const n = foldText(text)
  if (!n) return null
  let best: { id: CrmModuleId; len: number } | null = null
  for (const m of Object.values(CRM_MODULES)) {
    for (const a of m.aliases) {
      if (new RegExp(`\\b${a}\\b`).test(n) && (!best || a.length > best.len)) best = { id: m.id, len: a.length }
    }
  }
  return best?.id ?? null
}

// ── Generadores de GUÍA (nunca leen datos) ────────────────────────────────────────────────────────────
export function explainModule(id: CrmModuleId): string {
  const m = CRM_MODULES[id]
  const parts = [
    `**${m.name}** (${m.nav}). ${m.purpose}`,
    `Muestra: ${m.shows}`,
    `Desde ahí puedes: ${m.actions}`,
    m.limits ? `Ten en cuenta: ${m.limits}` : null,
    m.offerData ? `¿Quieres que te muestre tus datos actuales de ${m.name.toLowerCase()}?` : m.assistantCan,
  ].filter(Boolean)
  return parts.join('\n')
}

export function navigationAnswer(id: CrmModuleId): string {
  const m = CRM_MODULES[id]
  return `${m.name} está en: ${m.nav}. ${m.purpose} ¿Quieres que te explique qué puedes hacer ahí?`
}

export function onboardingAnswer(): string {
  return [
    '¡Bienvenido! Te ubico en un minuto. Este CRM organiza tu trabajo inmobiliario en cuatro bloques:',
    '1. **Clientes** — tus contactos (compradores, vendedores) con su ficha completa.',
    '2. **Cartera** — inmuebles, operaciones en curso, trámites y comisiones.',
    '3. **Calendario y tareas** — citas, visitas y pendientes del día.',
    '4. **Facturación** (módulo PRO) — facturas oficiales con IVA y PDF.',
    'El **Dashboard** lo resume todo de un vistazo, y yo puedo explicarte cualquier pantalla o consultar tus datos cuando me lo pidas.',
    '¿Por dónde quieres empezar: clientes, cartera o agenda?',
  ].join('\n')
}

export function confusedAnswer(id: CrmModuleId | null): string {
  if (id) {
    const m = CRM_MODULES[id]
    return `Sin problema, te lo explico más simple. ${m.name}: ${m.purpose} En resumen, ${m.shows.charAt(0).toLowerCase()}${m.shows.slice(1)} ¿Qué parte te genera duda?`
  }
  return 'Sin problema. Dime qué pantalla o apartado estás viendo (Dashboard, Clientes, Cartera, Comisiones…) y te lo explico de forma sencilla, paso a paso.'
}
