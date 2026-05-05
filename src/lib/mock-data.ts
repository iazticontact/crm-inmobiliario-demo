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

export const dashboardMetrics = [
  { label: 'Clientes activos', value: '1.284', change: 12.5, changeLabel: 'vs. mes anterior', icon: 'Users' },
  { label: 'Ingresos del mes', value: '€42.890', change: 8.2, changeLabel: 'vs. mes anterior', icon: 'DollarSign' },
  { label: 'Resueltos por IA', value: '847', change: 23.1, changeLabel: 'este mes', icon: 'Bot' },
  { label: 'Emails enviados', value: '12.450', change: -3.4, changeLabel: 'vs. mes anterior', icon: 'Mail' },
]

export const aiInsights: AIInsight[] = [
  {
    id: '1',
    type: 'opportunity',
    title: '34 leads sin contactar en 7+ días',
    description: 'Activa una secuencia de re-engagement automática para recuperar estos leads antes de que se enfríen.',
    action: 'Activar secuencia',
  },
  {
    id: '2',
    type: 'warning',
    title: '3 facturas vencidas esta semana',
    description: 'Empresa Textil SL, Consultoría Vera y Tech Startup ABC tienen pagos pendientes de cobro.',
    action: 'Ver facturas',
  },
  {
    id: '3',
    type: 'info',
    title: 'Pico de conversaciones los martes',
    description: 'El 68% de las consultas se inician entre las 10:00 y 12:00 los martes. Ajusta la disponibilidad.',
    action: 'Ver análisis',
  },
]

export const recentActivity: Activity[] = [
  { id: '1', type: 'deal', description: 'Nuevo cliente cerrado: Distribuciones Martínez SL — Plan Pro', timestamp: 'Hace 5 min', clientName: 'Distribuciones Martínez SL' },
  { id: '2', type: 'message', description: 'IA resolvió consulta de devolución para Ana Rodríguez', timestamp: 'Hace 18 min', clientName: 'Ana Rodríguez' },
  { id: '3', type: 'email', description: 'Secuencia de bienvenida enviada a 12 nuevos leads', timestamp: 'Hace 32 min' },
  { id: '4', type: 'call', description: 'Llamada de seguimiento con TechCorp — Pendiente propuesta', timestamp: 'Hace 1h', clientName: 'TechCorp' },
  { id: '5', type: 'note', description: 'IA generó resumen de reunión con Logística Express', timestamp: 'Hace 2h', clientName: 'Logística Express' },
  { id: '6', type: 'deal', description: 'Renovación completada: Farmacia Buena Salud — Plan Business', timestamp: 'Hace 3h', clientName: 'Farmacia Buena Salud' },
]

export const weeklyLeads: WeeklyLeads[] = [
  { day: 'Lun', WhatsApp: 45, Instagram: 28, Web: 32, Email: 18 },
  { day: 'Mar', WhatsApp: 62, Instagram: 35, Web: 41, Email: 22 },
  { day: 'Mié', WhatsApp: 38, Instagram: 22, Web: 29, Email: 15 },
  { day: 'Jue', WhatsApp: 71, Instagram: 48, Web: 55, Email: 31 },
  { day: 'Vie', WhatsApp: 55, Instagram: 39, Web: 47, Email: 28 },
  { day: 'Sáb', WhatsApp: 29, Instagram: 18, Web: 21, Email: 9 },
  { day: 'Dom', WhatsApp: 14, Instagram: 8, Web: 11, Email: 4 },
]

export const clients: Client[] = [
  { id: '1', name: 'Ana Rodríguez', email: 'ana.rodriguez@empresa.com', phone: '+34 612 345 678', channel: 'WhatsApp', status: 'active', leadScore: 92, lastInteraction: 'Hace 2h', company: 'Diseño Digital SL', avatar: 'AR' },
  { id: '2', name: 'Carlos Méndez', email: 'carlos@techmendez.es', phone: '+34 687 234 567', channel: 'Instagram', status: 'lead', leadScore: 74, lastInteraction: 'Ayer', company: 'TechMéndez', avatar: 'CM' },
  { id: '3', name: 'Laura García', email: 'l.garcia@logistica.com', phone: '+34 654 321 098', channel: 'Web', status: 'active', leadScore: 88, lastInteraction: 'Hace 4h', company: 'Logística Express', avatar: 'LG' },
  { id: '4', name: 'Miguel Torres', email: 'miguel.torres@distribuciones.es', phone: '+34 698 765 432', channel: 'Email', status: 'active', leadScore: 96, lastInteraction: 'Hace 1h', company: 'Distribuciones Torres', avatar: 'MT' },
  { id: '5', name: 'Sofía Ramírez', email: 'sofia@startup.io', phone: '+34 611 222 333', channel: 'WhatsApp', status: 'lead', leadScore: 61, lastInteraction: 'Hace 3 días', company: 'StartupIO', avatar: 'SR' },
  { id: '6', name: 'Pablo Fernández', email: 'pablo.fernandez@consultoria.com', phone: '+34 622 333 444', channel: 'Instagram', status: 'inactive', leadScore: 45, lastInteraction: 'Hace 2 sem', company: 'Consultoría Vera', avatar: 'PF' },
  { id: '7', name: 'Elena Moreno', email: 'elena@farmacia.com', phone: '+34 633 444 555', channel: 'Web', status: 'active', leadScore: 83, lastInteraction: 'Hace 6h', company: 'Farmacia Buena Salud', avatar: 'EM' },
  { id: '8', name: 'David López', email: 'david.lopez@textil.com', phone: '+34 644 555 666', channel: 'Email', status: 'churned', leadScore: 32, lastInteraction: 'Hace 1 mes', company: 'Empresa Textil SL', avatar: 'DL' },
  { id: '9', name: 'Isabel Castillo', email: 'icastillo@retail.es', phone: '+34 655 666 777', channel: 'WhatsApp', status: 'active', leadScore: 79, lastInteraction: 'Hace 5h', company: 'Retail Castillo', avatar: 'IC' },
  { id: '10', name: 'Javier Ruiz', email: 'j.ruiz@agencia.com', phone: '+34 666 777 888', channel: 'Web', status: 'lead', leadScore: 57, lastInteraction: 'Hace 2 días', company: 'Agencia Ruiz', avatar: 'JR' },
]

export const conversations: Conversation[] = [
  { id: '1', clientId: '1', clientName: 'Ana Rodríguez', clientAvatar: 'AR', lastMessage: 'Perfecto, entonces confirmamos la reunión para el jueves a las 10.', timestamp: 'Hace 2h', unread: true, sentiment: 'positive', channel: 'WhatsApp', intent: 'Confirmación de reunión' },
  { id: '2', clientId: '2', clientName: 'Carlos Méndez', clientAvatar: 'CM', lastMessage: '¿Podéis enviarme más información sobre el plan Business?', timestamp: 'Ayer', unread: true, sentiment: 'neutral', channel: 'Instagram', intent: 'Solicitud de información' },
  { id: '3', clientId: '3', clientName: 'Laura García', clientAvatar: 'LG', lastMessage: 'El sistema funciona genial, muy contenta con el servicio.', timestamp: 'Hace 4h', unread: false, sentiment: 'positive', channel: 'Web', intent: 'Satisfacción' },
  { id: '4', clientId: '4', clientName: 'Miguel Torres', clientAvatar: 'MT', lastMessage: 'Tengo un problema con la factura del mes pasado.', timestamp: 'Hace 1h', unread: true, sentiment: 'negative', channel: 'Email', intent: 'Reclamación' },
  { id: '5', clientId: '5', clientName: 'Sofía Ramírez', clientAvatar: 'SR', lastMessage: '¿Hacéis descuento para startups?', timestamp: 'Hace 3 días', unread: false, sentiment: 'neutral', channel: 'WhatsApp', intent: 'Consulta de precio' },
]

export const messages: Record<string, Message[]> = {
  '1': [
    { id: 'm1', conversationId: '1', content: 'Buenos días, me gustaría hablar sobre el plan Enterprise.', sender: 'client', timestamp: '10:02' },
    { id: 'm2', conversationId: '1', content: 'Buenos días Ana! Por supuesto, estaré encantado de explicarte el plan Enterprise. ¿Tienes disponibilidad esta semana?', sender: 'agent', timestamp: '10:05' },
    { id: 'm3', conversationId: '1', content: 'El jueves a las 10 me vendría bien.', sender: 'client', timestamp: '10:08' },
    { id: 'm4', conversationId: '1', content: '¡Perfecto Ana! He reservado el jueves a las 10:00. Recibirás un email de confirmación con el enlace de videoconferencia. ¿Hay algo concreto que quieras que preparemos para la reunión?', sender: 'ai', timestamp: '10:09' },
    { id: 'm5', conversationId: '1', content: 'Perfecto, entonces confirmamos la reunión para el jueves a las 10.', sender: 'client', timestamp: '10:10' },
  ],
  '2': [
    { id: 'm6', conversationId: '2', content: 'Hola! Vi vuestro post en Instagram y me interesa mucho lo que ofrecéis.', sender: 'client', timestamp: '09:30' },
    { id: 'm7', conversationId: '2', content: '¡Hola Carlos! Me alegra que hayas contactado. ¿En qué puedo ayudarte hoy?', sender: 'agent', timestamp: '09:32' },
    { id: 'm8', conversationId: '2', content: '¿Podéis enviarme más información sobre el plan Business?', sender: 'client', timestamp: '09:45' },
  ],
  '3': [
    { id: 'm9', conversationId: '3', content: 'Llevamos 3 meses usando NowCRM y ha mejorado muchísimo nuestra gestión.', sender: 'client', timestamp: '14:15' },
    { id: 'm10', conversationId: '3', content: '¡Nos alegra mucho escuchar eso, Laura! ¿Hay algo en lo que podamos mejorar aún más?', sender: 'agent', timestamp: '14:18' },
    { id: 'm11', conversationId: '3', content: 'El sistema funciona genial, muy contenta con el servicio.', sender: 'client', timestamp: '14:20' },
  ],
  '4': [
    { id: 'm12', conversationId: '4', content: 'Buenos días, tengo una incidencia con la factura de abril.', sender: 'client', timestamp: '11:00' },
    { id: 'm13', conversationId: '4', content: 'Lo siento Miguel, voy a revisar tu factura ahora mismo. ¿Puedes indicarme el número de factura?', sender: 'agent', timestamp: '11:05' },
    { id: 'm14', conversationId: '4', content: 'Tengo un problema con la factura del mes pasado.', sender: 'client', timestamp: '11:10' },
  ],
  '5': [
    { id: 'm15', conversationId: '5', content: 'Hola! Somos una startup de 5 personas, ¿tenéis algún plan especial?', sender: 'client', timestamp: '08:45' },
    { id: 'm16', conversationId: '5', content: '¡Hola Sofía! Sí, tenemos un programa especial para startups con hasta 50% de descuento el primer año.', sender: 'ai', timestamp: '08:46' },
    { id: 'm17', conversationId: '5', content: '¿Hacéis descuento para startups?', sender: 'client', timestamp: '08:50' },
  ],
}

export const automations: Automation[] = [
  { id: '1', name: 'Bienvenida a nuevos leads', description: 'Secuencia de 5 emails para nuevos leads registrados desde cualquier canal.', status: 'active', trigger: 'Nuevo lead registrado', emailsSent: 1284, openRate: 67.3, clickRate: 24.8, conversions: 142, lastRun: 'Hace 5 min' },
  { id: '2', name: 'Cobro automático', description: 'Recordatorios de pago y seguimiento de facturas pendientes por email y WhatsApp.', status: 'active', trigger: 'Factura pendiente +3 días', emailsSent: 438, openRate: 82.1, clickRate: 55.4, conversions: 387, lastRun: 'Hace 2h' },
  { id: '3', name: 'Re-engagement clientes', description: 'Campaña de reactivación para clientes sin actividad en los últimos 30 días.', status: 'paused', trigger: 'Sin actividad 30 días', emailsSent: 892, openRate: 41.2, clickRate: 12.7, conversions: 67, lastRun: 'Hace 3 días' },
]

export const automationEmails: AutomationEmail[] = [
  { id: 'e1', automationId: '1', recipient: 'nuevo.lead@empresa.com', subject: '¡Bienvenido a NowCRM! Aquí empieza todo.', sentAt: 'Hace 5 min', status: 'delivered' },
  { id: 'e2', automationId: '1', recipient: 'sofia@startup.io', subject: 'Cómo multiplicar tus ventas con IA — Guía gratis', sentAt: 'Hace 18 min', status: 'opened' },
  { id: 'e3', automationId: '2', recipient: 'david.lopez@textil.com', subject: 'Recordatorio: Tu factura #F-2026-089 está pendiente', sentAt: 'Hace 2h', status: 'clicked' },
  { id: 'e4', automationId: '2', recipient: 'pablo.fernandez@consultoria.com', subject: 'Último aviso: Factura vencida hace 7 días', sentAt: 'Hace 2h', status: 'opened' },
  { id: 'e5', automationId: '1', recipient: 'lead.nuevo@mail.com', subject: '¡Bienvenido a NowCRM! Aquí empieza todo.', sentAt: 'Hace 4h', status: 'bounced' },
  { id: 'e6', automationId: '3', recipient: 'cliente.inactivo@empresa.es', subject: 'Te echamos de menos... ¿Volvemos a hablar?', sentAt: 'Hace 3 días', status: 'opened' },
]

export const calendarEvents: CalendarEvent[] = [
  { id: 'ev1', title: 'Demo con Ana Rodríguez', date: '2026-05-05', startHour: 10, startMinute: 0, duration: 60, type: 'demo', clientName: 'Ana Rodríguez', description: 'Presentación del plan Enterprise' },
  { id: 'ev2', title: 'Llamada de seguimiento', date: '2026-05-05', startHour: 12, startMinute: 30, duration: 30, type: 'call', clientName: 'Carlos Méndez' },
  { id: 'ev3', title: 'Reunión interna equipo', date: '2026-05-06', startHour: 9, startMinute: 0, duration: 90, type: 'meeting', description: 'Review semanal de métricas' },
  { id: 'ev4', title: 'Seguimiento Laura García', date: '2026-05-06', startHour: 11, startMinute: 0, duration: 45, type: 'follow-up', clientName: 'Laura García' },
  { id: 'ev5', title: 'Demo producto nuevo', date: '2026-05-07', startHour: 15, startMinute: 0, duration: 60, type: 'demo', clientName: 'Miguel Torres' },
  { id: 'ev6', title: 'Onboarding nuevo cliente', date: '2026-05-08', startHour: 10, startMinute: 0, duration: 120, type: 'meeting', clientName: 'Distribuciones Martínez SL' },
  { id: 'ev7', title: 'Revisión propuesta', date: '2026-05-09', startHour: 11, startMinute: 30, duration: 45, type: 'call', clientName: 'TechMéndez' },
]

export const invoices: Invoice[] = [
  { id: 'F-2026-001', clientName: 'Distribuciones Martínez SL', amount: 299, status: 'paid', date: '2026-05-01', dueDate: '2026-05-15', plan: 'Pro' },
  { id: 'F-2026-002', clientName: 'TechMéndez', amount: 149, status: 'pending', date: '2026-05-02', dueDate: '2026-05-16', plan: 'Starter' },
  { id: 'F-2026-003', clientName: 'Logística Express', amount: 599, status: 'paid', date: '2026-05-01', dueDate: '2026-05-15', plan: 'Business' },
  { id: 'F-2026-004', clientName: 'Empresa Textil SL', amount: 299, status: 'overdue', date: '2026-04-01', dueDate: '2026-04-15', plan: 'Pro' },
  { id: 'F-2026-005', clientName: 'StartupIO', amount: 149, status: 'pending', date: '2026-05-03', dueDate: '2026-05-17', plan: 'Starter' },
  { id: 'F-2026-006', clientName: 'Consultoría Vera', amount: 299, status: 'overdue', date: '2026-04-05', dueDate: '2026-04-19', plan: 'Pro' },
  { id: 'F-2026-007', clientName: 'Farmacia Buena Salud', amount: 599, status: 'paid', date: '2026-05-01', dueDate: '2026-05-15', plan: 'Business' },
  { id: 'F-2026-008', clientName: 'Diseño Digital SL', amount: 999, status: 'paid', date: '2026-05-01', dueDate: '2026-05-15', plan: 'Enterprise' },
]

export const revenueByPlan: RevenueByPlan[] = [
  { plan: 'Starter', revenue: 4470, count: 30 },
  { plan: 'Pro', revenue: 14950, count: 50 },
  { plan: 'Business', revenue: 14975, count: 25 },
  { plan: 'Enterprise', revenue: 9990, count: 10 },
]
