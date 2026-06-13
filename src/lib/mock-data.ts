// Mock data para el modo demo de CRM Inmobiliario Demo.
//
// Estos datos SOLO se sirven cuando `useCurrentUser().isDemo === true` (sin
// sesión Supabase real) o cuando `DEMO_MODE_KEY` está activo en localStorage.
// Las páginas consumidoras (dashboard, clients, billing, calendar, etc.)
// hacen ese gating; este archivo no se debe importar fuera de esos contextos.
//
// Todos los nombres, empresas, emails (@example.com) y teléfonos son INVENTADOS
// para demos comerciales de inmobiliaria. No representan personas ni datos
// reales y no deben copiarse a despliegues de cliente — un cliente real verá
// solo los datos de su workspace Supabase.
//
// Para ocultar la demo en un fork de cliente: `NEXT_PUBLIC_ENABLE_DEMO_DATA=false`
// — esconde el botón "Entrar en modo demo" en `/login`.
import type {
  Client,
  Conversation,
  Message,
  Automation,
  AutomationEmail,
  CalendarEvent,
  Invoice,
  AIInsight,
  Activity,
  WeeklyLeads,
  RevenueByPlan,
} from './types'
import { demoDate } from './demo/demo-dates'

export const dashboardMetrics = [
  { label: 'Clientes activos', value: '342', change: 9.4, changeLabel: 'vs. mes anterior', icon: 'Users' },
  { label: 'Ingresos del mes', value: '€58.300', change: 6.1, changeLabel: 'vs. mes anterior', icon: 'DollarSign' },
  { label: 'Leads atendidos por IA', value: '214', change: 18.7, changeLabel: 'este mes', icon: 'Bot' },
  { label: 'Emails enviados', value: '3.480', change: -2.1, changeLabel: 'vs. mes anterior', icon: 'Mail' },
]

export const aiInsights: AIInsight[] = [
  {
    id: '1',
    type: 'opportunity',
    title: '12 leads sin contactar en 7+ días',
    description: 'Activa un seguimiento automático para los interesados en obra nueva antes de que se enfríen.',
    action: 'Activar seguimiento',
  },
  {
    id: '2',
    type: 'warning',
    title: '3 visitas sin confirmar para mañana',
    description: 'Confirma con los clientes las visitas al piso de Calle Mayor 14 y al ático de Plaza España.',
    action: 'Ver visitas',
  },
  {
    id: '3',
    type: 'info',
    title: 'Más solicitudes los sábados por la mañana',
    description: 'El 64% de las solicitudes de visita entran entre las 10:00 y 13:00 los sábados. Ajusta la agenda comercial.',
    action: 'Ver análisis',
  },
]

export const recentActivity: Activity[] = [
  { id: '1', type: 'deal', description: 'Operación cerrada: venta del piso de Calle Mayor 14 — Familia Soler', timestamp: 'Hace 8 min', clientName: 'Familia Soler' },
  { id: '2', type: 'message', description: 'IA respondió una consulta de financiación a Lucía Herrera', timestamp: 'Hace 22 min', clientName: 'Lucía Herrera' },
  { id: '3', type: 'email', description: 'Ficha de la propiedad de Av. del Puerto 8 enviada a 5 interesados', timestamp: 'Hace 35 min' },
  { id: '4', type: 'call', description: 'Llamada de seguimiento con Inversiones Atlántico — pendiente segunda visita', timestamp: 'Hace 1h', clientName: 'Inversiones Atlántico SL' },
  { id: '5', type: 'note', description: 'IA generó el resumen de la visita al ático de Plaza España', timestamp: 'Hace 2h', clientName: 'Roberto Díaz' },
  { id: '6', type: 'deal', description: 'Reserva firmada: chalet en Urbanización Los Robles — Marta Vidal', timestamp: 'Hace 3h', clientName: 'Marta Vidal' },
]

export const weeklyLeads: WeeklyLeads[] = [
  { day: 'Lun', WhatsApp: 12, Instagram: 8, Web: 14, Email: 5 },
  { day: 'Mar', WhatsApp: 15, Instagram: 10, Web: 18, Email: 7 },
  { day: 'Mié', WhatsApp: 11, Instagram: 7, Web: 12, Email: 4 },
  { day: 'Jue', WhatsApp: 18, Instagram: 13, Web: 20, Email: 9 },
  { day: 'Vie', WhatsApp: 16, Instagram: 11, Web: 17, Email: 8 },
  { day: 'Sáb', WhatsApp: 22, Instagram: 16, Web: 24, Email: 6 },
  { day: 'Dom', WhatsApp: 9, Instagram: 6, Web: 8, Email: 3 },
]

export const clients: Client[] = [
  { id: '1', name: 'Lucía Herrera', email: 'lucia.herrera@example.com', phone: '+34 600 101 201', channel: 'whatsapp', status: 'active', leadScore: 90, lastInteraction: 'Hace 2h', company: 'Compradora · 3 dorm.', avatar: 'LH' },
  { id: '2', name: 'Marcos Beltrán', email: 'marcos.beltran@example.com', phone: '+34 600 102 202', channel: 'web', status: 'lead', leadScore: 72, lastInteraction: 'Ayer', company: 'Comprador · obra nueva', avatar: 'MB' },
  { id: '3', name: 'Familia Soler', email: 'contacto.soler@example.com', phone: '+34 600 103 203', channel: 'whatsapp', status: 'active', leadScore: 88, lastInteraction: 'Hace 4h', company: 'Vendedores · piso', avatar: 'FS' },
  { id: '4', name: 'Roberto Díaz', email: 'roberto.diaz@example.com', phone: '+34 600 104 204', channel: 'email', status: 'active', leadScore: 95, lastInteraction: 'Hace 1h', company: 'Inversor · ático', avatar: 'RD' },
  { id: '5', name: 'Marta Vidal', email: 'marta.vidal@example.com', phone: '+34 600 105 205', channel: 'instagram', status: 'lead', leadScore: 64, lastInteraction: 'Hace 3 días', company: 'Compradora · chalet', avatar: 'MV' },
  { id: '6', name: 'Inversiones Atlántico SL', email: 'contacto@inversiones-atlantico.example', phone: '+34 600 106 206', channel: 'web', status: 'active', leadScore: 81, lastInteraction: 'Hace 6h', company: 'Inversor · cartera', avatar: 'IA' },
  { id: '7', name: 'Pablo Ferrer', email: 'pablo.ferrer@example.com', phone: '+34 600 107 207', channel: 'whatsapp', status: 'inactive', leadScore: 40, lastInteraction: 'Hace 2 sem', company: 'Comprador · 1 dorm.', avatar: 'PF' },
  { id: '8', name: 'Carmen Lozano', email: 'carmen.lozano@example.com', phone: '+34 600 108 208', channel: 'email', status: 'active', leadScore: 77, lastInteraction: 'Hace 5h', company: 'Vendedora · adosado', avatar: 'CL' },
  { id: '9', name: 'David Iglesias', email: 'david.iglesias@example.com', phone: '+34 600 109 209', channel: 'web', status: 'lead', leadScore: 58, lastInteraction: 'Hace 2 días', company: 'Comprador · local', avatar: 'DI' },
  { id: '10', name: 'Nuria Campos', email: 'nuria.campos@example.com', phone: '+34 600 110 210', channel: 'whatsapp', status: 'churned', leadScore: 30, lastInteraction: 'Hace 1 mes', company: 'Compradora · piso', avatar: 'NC' },
]

export const conversations: Conversation[] = [
  { id: '1', clientId: '1', clientName: 'Lucía Herrera', clientAvatar: 'LH', lastMessage: 'Perfecto, confirmamos la visita al piso de Calle Mayor el jueves a las 18:00.', timestamp: 'Hace 2h', unread: true, sentiment: 'positive', channel: 'whatsapp', intent: 'Confirmación de visita' },
  { id: '2', clientId: '2', clientName: 'Marcos Beltrán', clientAvatar: 'MB', lastMessage: '¿Podéis enviarme la ficha y el precio de la promoción de obra nueva?', timestamp: 'Ayer', unread: true, sentiment: 'neutral', channel: 'web', intent: 'Solicitud de información' },
  { id: '3', clientId: '3', clientName: 'Familia Soler', clientAvatar: 'FS', lastMessage: 'Nos ha encantado cómo habéis gestionado la venta, mil gracias.', timestamp: 'Hace 4h', unread: false, sentiment: 'positive', channel: 'whatsapp', intent: 'Satisfacción' },
  { id: '4', clientId: '4', clientName: 'Roberto Díaz', clientAvatar: 'RD', lastMessage: 'La rentabilidad del ático no me cuadra, ¿lo revisamos juntos?', timestamp: 'Hace 1h', unread: true, sentiment: 'negative', channel: 'email', intent: 'Consulta de inversión' },
  { id: '5', clientId: '5', clientName: 'Marta Vidal', clientAvatar: 'MV', lastMessage: '¿El chalet admite financiación con vuestra entidad colaboradora?', timestamp: 'Hace 3 días', unread: false, sentiment: 'neutral', channel: 'instagram', intent: 'Consulta de financiación' },
]

export const messages: Record<string, Message[]> = {
  '1': [
    { id: 'm1', conversationId: '1', content: 'Buenas tardes, me gustaría ver el piso de 3 dormitorios de Calle Mayor.', sender: 'client', timestamp: '10:02' },
    { id: 'm2', conversationId: '1', content: '¡Buenas tardes Lucía! Claro, está disponible para visitas esta semana. ¿Qué día te viene mejor?', sender: 'agent', timestamp: '10:05' },
    { id: 'm3', conversationId: '1', content: 'El jueves por la tarde me iría perfecto.', sender: 'client', timestamp: '10:08' },
    { id: 'm4', conversationId: '1', content: '¡Hecho, Lucía! He reservado el jueves a las 18:00. Te enviaré la dirección exacta y un recordatorio el día antes. ¿Quieres que prepare también la información de financiación?', sender: 'ai', timestamp: '10:09' },
    { id: 'm5', conversationId: '1', content: 'Perfecto, confirmamos la visita al piso de Calle Mayor el jueves a las 18:00.', sender: 'client', timestamp: '10:10' },
  ],
  '2': [
    { id: 'm6', conversationId: '2', content: 'Hola! Vi vuestra promoción de obra nueva y me interesa mucho.', sender: 'client', timestamp: '09:30' },
    { id: 'm7', conversationId: '2', content: '¡Hola Marcos! Encantado. ¿Buscas una vivienda para vivir o como inversión?', sender: 'agent', timestamp: '09:32' },
    { id: 'm8', conversationId: '2', content: '¿Podéis enviarme la ficha y el precio de la promoción de obra nueva?', sender: 'client', timestamp: '09:45' },
  ],
  '3': [
    { id: 'm9', conversationId: '3', content: 'Llevamos meses intentando vender el piso y con vosotros se ha cerrado en tres semanas.', sender: 'client', timestamp: '14:15' },
    { id: 'm10', conversationId: '3', content: '¡Nos alegra muchísimo! Ha sido un placer acompañaros. ¿Necesitáis ayuda con la mudanza o la documentación?', sender: 'agent', timestamp: '14:18' },
    { id: 'm11', conversationId: '3', content: 'Nos ha encantado cómo habéis gestionado la venta, mil gracias.', sender: 'client', timestamp: '14:20' },
  ],
  '4': [
    { id: 'm12', conversationId: '4', content: 'Buenos días, he repasado los números del ático de Plaza España.', sender: 'client', timestamp: '11:00' },
    { id: 'm13', conversationId: '4', content: 'Buenos días Roberto, dime qué punto te genera dudas y lo revisamos al detalle.', sender: 'agent', timestamp: '11:05' },
    { id: 'm14', conversationId: '4', content: 'La rentabilidad del ático no me cuadra, ¿lo revisamos juntos?', sender: 'client', timestamp: '11:10' },
  ],
  '5': [
    { id: 'm15', conversationId: '5', content: 'Hola! Me interesa el chalet de Los Robles, ¿qué opciones de financiación hay?', sender: 'client', timestamp: '08:45' },
    { id: 'm16', conversationId: '5', content: '¡Hola Marta! Trabajamos con una entidad colaboradora que suele cubrir hasta el 80%. Te preparo una simulación.', sender: 'ai', timestamp: '08:46' },
    { id: 'm17', conversationId: '5', content: '¿El chalet admite financiación con vuestra entidad colaboradora?', sender: 'client', timestamp: '08:50' },
  ],
}

export const automations: Automation[] = [
  { id: '1', name: 'Bienvenida a nuevos leads', description: 'Secuencia automática para nuevos interesados registrados desde cualquier canal: presentación de la agencia y primeras propiedades.', status: 'active', trigger: 'Nuevo lead registrado', emailsSent: 486, openRate: 64.8, clickRate: 22.4, conversions: 58, lastRun: 'Hace 8 min' },
  { id: '2', name: 'Recordatorio de visita', description: 'Aviso al cliente 24h antes de la visita con dirección, hora y enlace de confirmación.', status: 'active', trigger: 'Visita creada en calendario', emailsSent: 212, openRate: 92.1, clickRate: 71.4, conversions: 188, lastRun: 'Hace 2h' },
  { id: '3', name: 'Reactivación de interesados', description: 'Campaña para interesados sin actividad en los últimos 30 días con nuevas propiedades que encajan.', status: 'paused', trigger: 'Sin actividad 30 días', emailsSent: 174, openRate: 38.2, clickRate: 11.7, conversions: 21, lastRun: 'Hace 3 días' },
  { id: '4', name: 'Confirmación de visita', description: 'Mensaje automático al programar una visita con el resumen de la propiedad.', status: 'active', trigger: 'Visita programada', emailsSent: 198, openRate: 90.4, clickRate: 64.2, conversions: 176, lastRun: 'Hace 1h' },
  { id: '5', name: 'Propuesta a lead caliente', description: 'Envío automático de una selección de propiedades cuando un lead supera score 80.', status: 'draft', trigger: 'Lead score ≥ 80', emailsSent: 34, openRate: 88.4, clickRate: 59.7, conversions: 19, lastRun: 'Hace 12h' },
  { id: '6', name: 'Alerta diaria de agenda', description: 'Resumen a las 08:00 con las visitas del día, leads calientes y firmas pendientes.', status: 'active', trigger: 'Cada día a las 08:00', emailsSent: 180, openRate: 94.4, clickRate: 41.1, conversions: 0, lastRun: 'Hoy 08:00' },
  { id: '7', name: 'Escalado conversación urgente', description: 'Alerta interna y cambio de prioridad cuando se detecta sentimiento negativo en una conversación activa.', status: 'active', trigger: 'Sentimiento negativo detectado', emailsSent: 24, openRate: 100.0, clickRate: 83.3, conversions: 20, lastRun: 'Hace 6h' },
  { id: '8', name: 'Aviso de nueva propiedad', description: 'Notifica a los interesados que encajan cada vez que se publica una propiedad nueva.', status: 'paused', trigger: 'Propiedad publicada', emailsSent: 156, openRate: 73.8, clickRate: 28.2, conversions: 0, lastRun: 'Hace 2 días' },
  { id: '9', name: 'Onboarding de propietario', description: 'Secuencia de bienvenida al firmar un encargo de venta: checklist de documentación y próximos pasos.', status: 'draft', trigger: 'Encargo de venta firmado', emailsSent: 0, openRate: 0, clickRate: 0, conversions: 0, lastRun: 'Pendiente' },
  { id: '10', name: 'Resumen semanal IA', description: 'Informe generado por el asistente IA cada lunes: operaciones, leads, visitas y próximas acciones prioritarias.', status: 'active', trigger: 'Cada lunes a las 09:00', emailsSent: 52, openRate: 88.5, clickRate: 34.6, conversions: 0, lastRun: 'Lunes 09:00' },
]

export const automationEmails: AutomationEmail[] = [
  { id: 'e1', automationId: '1', recipient: 'nuevo.lead@example.com', subject: 'Gracias por tu interés — así trabajamos tu búsqueda de vivienda', sentAt: 'Hace 8 min', status: 'delivered' },
  { id: 'e2', automationId: '1', recipient: 'marta.vidal@example.com', subject: 'Tu selección de propiedades de esta semana', sentAt: 'Hace 18 min', status: 'opened' },
  { id: 'e3', automationId: '2', recipient: 'roberto.diaz@example.com', subject: 'Recordatorio: visita al ático de Plaza España mañana a las 18:00', sentAt: 'Hace 2h', status: 'clicked' },
  { id: 'e4', automationId: '4', recipient: 'lucia.herrera@example.com', subject: 'Confirma tu visita al piso de Calle Mayor 14', sentAt: 'Hace 2h', status: 'opened' },
  { id: 'e5', automationId: '1', recipient: 'lead.nuevo@example.com', subject: 'Gracias por tu interés — así trabajamos tu búsqueda de vivienda', sentAt: 'Hace 4h', status: 'bounced' },
  { id: 'e6', automationId: '3', recipient: 'interesado.inactivo@example.com', subject: '¿Seguimos buscando tu próxima vivienda?', sentAt: 'Hace 3 días', status: 'opened' },
]

// Fechas relativas a hoy para que la agenda demo siempre muestre visitas
// próximas de esta semana, sin importar cuándo se abra la demo.
export const calendarEvents: CalendarEvent[] = [
  { id: 'ev1', title: 'Visita piso Calle Mayor 14', date: demoDate(1), startHour: 18, startMinute: 0, duration: 60, type: 'demo', clientName: 'Lucía Herrera', description: 'Vivienda de 3 dormitorios' },
  { id: 'ev2', title: 'Llamada de seguimiento', date: demoDate(1), startHour: 12, startMinute: 30, duration: 30, type: 'call', clientName: 'Marcos Beltrán' },
  { id: 'ev3', title: 'Reunión interna equipo comercial', date: demoDate(2), startHour: 9, startMinute: 0, duration: 90, type: 'meeting', description: 'Revisión de cartera y nuevos encargos' },
  { id: 'ev4', title: 'Seguimiento Familia Soler', date: demoDate(2), startHour: 11, startMinute: 0, duration: 45, type: 'follow-up', clientName: 'Familia Soler' },
  { id: 'ev5', title: 'Visita ático Plaza España', date: demoDate(3), startHour: 17, startMinute: 0, duration: 60, type: 'demo', clientName: 'Roberto Díaz' },
  { id: 'ev6', title: 'Firma de reserva — chalet Los Robles', date: demoDate(4), startHour: 10, startMinute: 0, duration: 90, type: 'meeting', clientName: 'Marta Vidal', description: 'Chalet en Urbanización Los Robles' },
  { id: 'ev7', title: 'Revisión de propuesta de inversión', date: demoDate(5), startHour: 11, startMinute: 30, duration: 45, type: 'call', clientName: 'Inversiones Atlántico SL' },
]

// Fechas relativas: facturas pagadas/pendientes recientes con vencimiento
// próximo; las vencidas quedan claramente en el pasado.
export const invoices: Invoice[] = [
  { id: 'F-2026-001', clientName: 'Familia Soler', amount: 3500, status: 'paid', date: demoDate(-12), dueDate: demoDate(3), plan: 'Honorarios venta' },
  { id: 'F-2026-002', clientName: 'Marcos Beltrán', amount: 150, status: 'pending', date: demoDate(-11), dueDate: demoDate(4), plan: 'Tasación' },
  { id: 'F-2026-003', clientName: 'Inversiones Atlántico SL', amount: 4200, status: 'paid', date: demoDate(-12), dueDate: demoDate(3), plan: 'Honorarios venta' },
  { id: 'F-2026-004', clientName: 'Pablo Ferrer', amount: 600, status: 'overdue', date: demoDate(-43), dueDate: demoDate(-29), plan: 'Gestión alquiler' },
  { id: 'F-2026-005', clientName: 'Marta Vidal', amount: 150, status: 'pending', date: demoDate(-10), dueDate: demoDate(5), plan: 'Tasación' },
  { id: 'F-2026-006', clientName: 'Carmen Lozano', amount: 2800, status: 'overdue', date: demoDate(-39), dueDate: demoDate(-25), plan: 'Honorarios venta' },
  { id: 'F-2026-007', clientName: 'Roberto Díaz', amount: 900, status: 'paid', date: demoDate(-12), dueDate: demoDate(3), plan: 'Asesoría' },
  { id: 'F-2026-008', clientName: 'Lucía Herrera', amount: 300, status: 'paid', date: demoDate(-12), dueDate: demoDate(3), plan: 'Gestión alquiler' },
]

export const revenueByPlan: RevenueByPlan[] = [
  { plan: 'Honorarios venta', revenue: 10500, count: 3 },
  { plan: 'Gestión alquiler', revenue: 900, count: 2 },
  { plan: 'Tasación', revenue: 300, count: 2 },
  { plan: 'Asesoría', revenue: 900, count: 1 },
]
