// CRM Brain — universal read layer for NowLabs AI.
// Reads live Supabase data for any workspace. Never hardcodes client names.
// n8n is for external integrations; this layer is for internal CRM reads.

import {
  getClients,
  getAssistantConversations,
  getActivities,
  listTasks,
  getPendingInvoices,
  getOverdueInvoices,
  getUpcomingCalendarEvents,
  getPendingTasks,
  getHotLeads,
  getLatestClients,
  getTopClientsByLeadScore,
  getClientsByStatus,
  getClientsByChannel,
  getWorkspaceFullOverview,
  searchClients,
  mapSupabaseClient,
  mapSupabaseInvoice,
  mapSupabaseCalendarEvent,
  mapSupabaseTask,
} from '@/lib/supabase-queries'
import type { Client, Invoice, CalendarEvent } from '@/lib/types'

export type CRMOverview = Awaited<ReturnType<typeof getWorkspaceFullOverview>>

export type ClientFilter = {
  status?: string
  channel?: string
  minLeadScore?: number
  query?: string
  createdSince?: string
  limit?: number
}

export async function getWorkspaceCRMOverview(workspaceId: string): Promise<CRMOverview> {
  return getWorkspaceFullOverview(workspaceId)
}

export async function getClientsList(workspaceId: string, filters: ClientFilter = {}) {
  let clients: Client[]

  if (filters.status) {
    clients = await getClientsByStatus(workspaceId, filters.status)
  } else if (filters.channel) {
    clients = await getClientsByChannel(workspaceId, filters.channel)
  } else if (filters.query) {
    clients = await searchClients(workspaceId, filters.query)
  } else {
    clients = await getClients(workspaceId)
  }

  if (filters.minLeadScore !== undefined) {
    clients = clients.filter((c) => c.leadScore >= (filters.minLeadScore ?? 0))
  }

  if (filters.createdSince) {
    clients = clients.filter((c) => (c.createdAt ?? '') >= filters.createdSince!)
  }

  const limit = filters.limit ?? 50
  return clients.slice(0, limit)
}

export async function getHotLeadsList(workspaceId: string) {
  return getHotLeads(workspaceId)
}

export async function getPendingCommercialActions(workspaceId: string) {
  const [pendingInvoices, overdueInvoices, upcomingEvents, pendingTasksList, hotLeads, allClients] = await Promise.all([
    getPendingInvoices(workspaceId).catch(() => [] as Invoice[]),
    getOverdueInvoices(workspaceId).catch(() => [] as Invoice[]),
    getUpcomingCalendarEvents(workspaceId).catch(() => [] as CalendarEvent[]),
    getPendingTasks(workspaceId).catch(() => []),
    getHotLeads(workspaceId).catch(() => [] as Client[]),
    getClients(workspaceId).catch(() => [] as Client[]),
  ])

  const actions: string[] = []

  if (overdueInvoices.length) {
    const names = overdueInvoices.slice(0, 3).map((i) => `${i.clientName} (${i.amount}€)`).join(', ')
    actions.push(`${overdueInvoices.length} factura(s) vencida(s): ${names}`)
  }

  if (pendingInvoices.length) {
    actions.push(`${pendingInvoices.length} factura(s) pendiente(s) de cobro`)
  }

  if (upcomingEvents.length) {
    const next = upcomingEvents[0]
    actions.push(`Próxima cita: ${next.title} el ${next.date}${next.startHour !== undefined ? ` a las ${String(next.startHour).padStart(2, '0')}:${String(next.startMinute).padStart(2, '0')}` : ''}`)
  }

  if (pendingTasksList.length) {
    actions.push(`${pendingTasksList.length} tarea(s) pendiente(s)`)
  }

  if (hotLeads.length) {
    const top = hotLeads[0]
    actions.push(`Lead caliente destacado: ${top.name} (score ${top.leadScore})`)
  }

  const staleLeads = allClients.filter((c) => c.status === 'lead' && c.leadScore < 50)
  if (staleLeads.length) {
    actions.push(`${staleLeads.length} lead(s) sin actividad relevante — revisar o limpiar`)
  }

  return {
    actions,
    pendingInvoices,
    overdueInvoices,
    upcomingEvents: upcomingEvents.slice(0, 5),
    pendingTasks: pendingTasksList.slice(0, 5),
    hotLeads: hotLeads.slice(0, 5),
  }
}

export async function getAutomationRecommendations(workspaceId: string) {
  const [overdue, hotLeads, allClients] = await Promise.all([
    getOverdueInvoices(workspaceId).catch(() => [] as Invoice[]),
    getHotLeads(workspaceId).catch(() => [] as Client[]),
    getClients(workspaceId).catch(() => [] as Client[]),
  ])
  const inactive = allClients.filter((c) => c.status === 'inactive').length

  return [
    { title: 'Recordatorio automático de facturas vencidas', reason: overdue.length ? `Tienes ${overdue.length} factura(s) vencida(s)` : 'Prevenir impagos', suggestedAction: 'WhatsApp/email automático cuando una factura supera el vencimiento 3 días', priority: overdue.length > 0 ? 'alta' : 'media', automationSlug: 'overdue-invoice-reminder' },
    { title: 'Seguimiento de leads calientes', reason: hotLeads.length ? `${hotLeads.length} lead(s) con score ≥ 70 sin cerrar` : 'Convertir más leads', suggestedAction: 'Notificación interna + mensaje al lead cuando lleva 48h sin respuesta', priority: hotLeads.length > 0 ? 'alta' : 'media', automationSlug: 'hot-lead-followup' },
    { title: 'Bienvenida automática a nuevos clientes', reason: 'Primeras impresiones clave para retención', suggestedAction: 'WhatsApp de bienvenida + propuesta PDF cuando se crea un cliente nuevo', priority: 'media', automationSlug: 'new-client-welcome' },
    { title: 'Reactivación de clientes inactivos', reason: inactive > 0 ? `${inactive} cliente(s) inactivo(s)` : 'Recuperar clientes dormidos', suggestedAction: 'Email/WhatsApp mensual a clientes sin actividad en 60 días', priority: inactive > 3 ? 'alta' : 'baja', automationSlug: 'inactive-client-reactivation' },
    { title: 'Confirmación automática de citas', reason: 'Reducir no-shows', suggestedAction: 'WhatsApp de confirmación 24h antes de cada cita en calendario', priority: 'media', automationSlug: 'appointment-confirmation' },
    { title: 'Alerta de citas del día', reason: 'Preparar agenda diaria', suggestedAction: 'Resumen diario a las 8:00 con citas del día y clientes a contactar', priority: 'media', automationSlug: 'daily-agenda-alert' },
    { title: 'Propuesta automática a lead cualificado', reason: 'Acelerar cierre comercial', suggestedAction: 'Envío de PDF con propuesta cuando un lead supera score 80', priority: 'media', automationSlug: 'qualified-lead-proposal' },
    { title: 'Cierre de conversación sin respuesta', reason: 'Limpiar el inbox', suggestedAction: 'Marcar como resuelta una conversación sin actividad en 7 días', priority: 'baja', automationSlug: 'auto-close-conversation' },
  ]
}

// Normalised channel name for queries (handles user input variants)
export function normalizeCRMChannel(input: string): string {
  const t = input.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  if (t === 'whatsapp' || t === 'wa' || t === 'wsp') return 'whatsapp'
  if (t === 'instagram' || t === 'ig') return 'instagram'
  if (t === 'email' || t === 'mail' || t === 'correo') return 'email'
  if (t === 'web' || t === 'website') return 'web'
  if (t === 'crm' || t === 'interno') return 'crm'
  return t
}

// Build a human-readable CRM summary string
export function buildCRMOverviewText(overview: CRMOverview): string {
  const lines: string[] = [
    `Tienes ${overview.totalClients} cliente(s) en total: ${overview.activeClients} activo(s), ${overview.leads} lead(s), ${overview.inactiveClients} inactivo(s)${overview.lostClients ? ` y ${overview.lostClients} perdido(s)` : ''}.`,
  ]

  if (overview.overdueInvoices) {
    lines.push(`Hay ${overview.overdueInvoices} factura(s) vencida(s) — acción urgente.`)
  }

  if (overview.pendingInvoices) {
    lines.push(`${overview.pendingInvoices} factura(s) pendiente(s) de cobro.`)
  }

  if (overview.upcomingEvents.length) {
    const next = overview.upcomingEvents[0]
    lines.push(`Próxima cita: ${next.title} el ${next.date}.`)
  } else {
    lines.push('No hay citas próximas en el calendario.')
  }

  if (overview.pendingTasks.length) {
    lines.push(`${overview.pendingTasks.length} tarea(s) pendiente(s).`)
  }

  if (overview.topLeadScoreClients.length) {
    const top = overview.topLeadScoreClients
    lines.push(`Leads más calientes: ${top.map((c) => `${c.name} (${c.leadScore})`).join(', ')}.`)
  }

  if (overview.recentClients.length) {
    lines.push(`Nuevos esta semana: ${overview.recentClients.map((c) => c.name).join(', ')}.`)
  }

  return lines.join(' ')
}

// Build a human-readable client list
export function buildClientListText(clients: Client[], label = 'clientes'): string {
  if (!clients.length) return `No hay ${label} registrados.`
  const rows = clients.slice(0, 15).map((c, i) => {
    const parts = [`${i + 1}. ${c.name}`]
    if (c.company && c.company !== 'No consta') parts.push(`(${c.company})`)
    parts.push(`· ${c.status}`)
    if (c.leadScore) parts.push(`· score ${c.leadScore}`)
    if (c.channel) parts.push(`· ${c.channel}`)
    return parts.join(' ')
  })
  const header = `${clients.length > 15 ? `Mostrando ${Math.min(15, clients.length)} de ${clients.length}` : `${clients.length}`} ${label}:`
  return `${header}\n${rows.join('\n')}`
}

export type { Client, Invoice, CalendarEvent }

export {
  getLatestClients,
  getTopClientsByLeadScore,
  getClientsByStatus,
  getClientsByChannel,
  getOverdueInvoices,
  getPendingInvoices,
  getPendingTasks,
  getUpcomingCalendarEvents,
  listTasks,
  getActivities,
  getAssistantConversations,
  searchClients,
  mapSupabaseClient,
  mapSupabaseInvoice,
  mapSupabaseCalendarEvent,
  mapSupabaseTask,
}
