// Inbox channel + source classification — single source of truth for the lanes
// the Inbox UI renders and the badges every part of the product shows.
//
// Channel lanes (real customer-facing surfaces):
//   - whatsapp
//   - instagram
//   - web
//   - email
//
// Special lanes:
//   - crm_internal → Asistente IA / Copilot conversations that should never
//     be confused with a real customer thread.
//   - unknown → defensive fallback.
//
// SourceType says how "real" the row is, regardless of channel:
//   - real       → the upstream provider wrote a verifiable marker
//                  (e.g. metadata.source='meta_cloud_api' or a wamid)
//   - simulated  → produced by the local simulator / test helper
//   - imported   → backfilled from a third party (placeholder for future)
//   - pending    → row exists but no signal of authenticity yet
//   - internal   → CRM/Assistant internal notes
//
// The classifier is conservative: a row only becomes `real` when the provider
// explicitly said so. Anything else collapses to `simulated`/`pending`/`internal`
// so a fresh workspace never sees fake "real" WhatsApp/Instagram traffic.

import type { ReactNode } from 'react'

export type ChannelType =
  | 'whatsapp'
  | 'instagram'
  | 'web'
  | 'email'
  | 'crm_internal'
  | 'unknown'

export type SourceType =
  | 'real'
  | 'simulated'
  | 'imported'
  | 'pending'
  | 'internal'

export type ConversationClassification = {
  channelType: ChannelType
  sourceType: SourceType
}

export type MessageOrigin =
  | 'channel_inbound_real'   // customer message from a real upstream channel
  | 'channel_inbound_demo'   // customer message from simulator/test
  | 'channel_outbound'       // operator/AI message written from /inbox
  | 'system_note'            // CRM/Assistant note — never a chat bubble
  | 'unknown'

type MetaLike = Record<string, unknown> | null | undefined

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function hasNonEmpty(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0
}

function inferChannelType(channel: string, meta: Record<string, unknown>): ChannelType {
  const ch = readString(channel).toLowerCase()
  const source = readString(meta.source).toLowerCase()
  const provider = readString(meta.provider).toLowerCase()
  const mode = readString(meta.assistant_mode).toLowerCase()

  // CRM/Copilot first — it can use channel='crm' or web+copilot mode.
  if (ch === 'crm') return 'crm_internal'
  if (mode === 'copilot' || source === 'crm' || source.startsWith('assistant_')) return 'crm_internal'

  if (ch === 'whatsapp' || provider === 'meta' || source === 'meta_cloud_api') return 'whatsapp'
  if (ch === 'instagram' || provider === 'instagram' || source === 'instagram_messaging_api') return 'instagram'
  if (ch === 'email' || ch === 'gmail' || provider === 'gmail') return 'email'
  if (ch === 'web' || ch === 'test') return ch === 'test' ? 'web' : 'web'
  return 'unknown'
}

function inferSourceType(channelType: ChannelType, meta: Record<string, unknown>): SourceType {
  if (channelType === 'crm_internal') return 'internal'

  const source = readString(meta.source).toLowerCase()
  const provider = readString(meta.provider).toLowerCase()
  const isTest = meta.test === true
  const hasExternalId = hasNonEmpty(meta.lastExternalMessageId) || hasNonEmpty(meta.externalMessageId)

  // Real markers per channel.
  if (channelType === 'whatsapp' && (source === 'meta_cloud_api' || provider === 'meta')) return 'real'
  if (channelType === 'instagram' && (source === 'instagram_messaging_api' || provider === 'instagram')) return 'real'
  if (channelType === 'email' && (source === 'gmail_api' || provider === 'gmail')) return 'real'

  // Simulator / test markers.
  if (source === 'demo' || source === 'simulated' || source === 'settings_simulator' || source === 'whatsapp_inbound_test' || isTest) {
    return 'simulated'
  }

  // Imported (future: CSV/legacy migration) — placeholder.
  if (source === 'imported') return 'imported'

  // Real signal hidden in lastExternalMessageId? Treat as real only if also has
  // a recognized provider. Otherwise this is a legacy row → pending.
  if (channelType === 'whatsapp' && hasExternalId && provider === 'meta') return 'real'

  return 'pending'
}

export function classifyConversation(
  channel: string | null | undefined,
  metadata: MetaLike,
): ConversationClassification {
  const meta = metadata && typeof metadata === 'object' ? metadata as Record<string, unknown> : {}
  const channelType = inferChannelType(channel ?? '', meta)
  const sourceType = inferSourceType(channelType, meta)
  return { channelType, sourceType }
}

// Backwards-compat wrapper kept around the previous helper signature so existing
// imports continue to work. New code should use `classifyConversation`.
export type ConversationSource =
  | 'whatsapp_real'
  | 'whatsapp_demo'
  | 'crm_internal'
  | 'web'
  | 'unknown'

export function classifyConversationSource(
  channel: string | null | undefined,
  metadata: MetaLike,
): ConversationSource {
  const { channelType, sourceType } = classifyConversation(channel, metadata)
  if (channelType === 'crm_internal') return 'crm_internal'
  if (channelType === 'whatsapp' && sourceType === 'real') return 'whatsapp_real'
  if (channelType === 'whatsapp') return 'whatsapp_demo'
  if (channelType === 'web') return 'web'
  return 'unknown'
}

export function classifyMessageOrigin(
  metadata: MetaLike,
  sender: string | null | undefined,
): MessageOrigin {
  const m = metadata && typeof metadata === 'object' ? metadata as Record<string, unknown> : {}
  const s = readString(sender).toLowerCase()
  const source = readString(m.source).toLowerCase()
  const provider = readString(m.provider).toLowerCase()
  const mode = readString(m.mode).toLowerCase()
  const direction = readString(m.direction).toLowerCase()

  if (source.startsWith('assistant_') || source === 'crm' || s === 'system') return 'system_note'

  if (s === 'client' || direction === 'inbound') {
    if (source === 'meta_cloud_api' || source === 'instagram_messaging_api' || provider === 'meta' || provider === 'instagram' || provider === 'gmail') {
      return 'channel_inbound_real'
    }
    if (source === 'demo' || source === 'simulated' || source === 'settings_simulator' || m.test === true) {
      return 'channel_inbound_demo'
    }
    return 'channel_inbound_real'
  }

  if (s === 'agent' || s === 'ai' || mode === 'send' || mode === 'draft' || direction === 'outbound') return 'channel_outbound'

  return 'unknown'
}

// -----------------------------------------------------------------------------
// Channel descriptors — used by Inbox tabs, badges, and channel pickers.
// -----------------------------------------------------------------------------

export type ChannelDescriptor = {
  key: ChannelType
  label: string
  shortLabel: string
  /** Tailwind classes for the colored chip / pill. */
  tone: string
  /** Default human-readable fallback when there is no client_name nor phone. */
  fallbackContactLabel: string
  /** Whether the CRM has any code path that can produce a real message here. */
  productionReady: boolean
}

export const CHANNEL_DESCRIPTORS: Record<ChannelType, ChannelDescriptor> = {
  whatsapp: {
    key: 'whatsapp',
    label: 'WhatsApp',
    shortLabel: 'WhatsApp',
    tone: 'bg-emerald-50 text-emerald-700 border-emerald-100',
    fallbackContactLabel: 'Contacto de WhatsApp',
    productionReady: true,
  },
  instagram: {
    key: 'instagram',
    label: 'Instagram',
    shortLabel: 'Instagram',
    tone: 'bg-pink-50 text-pink-700 border-pink-100',
    fallbackContactLabel: 'Contacto de Instagram',
    productionReady: false,
  },
  web: {
    key: 'web',
    label: 'Web / Chat',
    shortLabel: 'Web',
    tone: 'bg-sky-50 text-sky-700 border-sky-100',
    fallbackContactLabel: 'Visitante web',
    productionReady: false,
  },
  email: {
    key: 'email',
    label: 'Email',
    shortLabel: 'Email',
    tone: 'bg-indigo-50 text-indigo-700 border-indigo-100',
    fallbackContactLabel: 'Contacto de email',
    productionReady: false,
  },
  crm_internal: {
    key: 'crm_internal',
    label: 'Interno',
    shortLabel: 'Interno',
    tone: 'bg-slate-50 text-slate-600 border-slate-100',
    fallbackContactLabel: 'Consulta interna',
    productionReady: true,
  },
  unknown: {
    key: 'unknown',
    label: 'Otro',
    shortLabel: 'Otro',
    tone: 'bg-gray-50 text-gray-500 border-gray-100',
    fallbackContactLabel: 'Contacto sin vincular',
    productionReady: false,
  },
}

export const SOURCE_PILL: Record<SourceType, { label: string; tone: string }> = {
  real:      { label: 'Real',       tone: 'bg-emerald-50 text-emerald-700 border-emerald-100' },
  simulated: { label: 'Simulado',   tone: 'bg-amber-50 text-amber-700 border-amber-100' },
  imported:  { label: 'Importado',  tone: 'bg-sky-50 text-sky-700 border-sky-100' },
  pending:   { label: 'Sin marcar', tone: 'bg-slate-50 text-slate-500 border-slate-100' },
  internal:  { label: 'Interno',    tone: 'bg-violet-50 text-violet-700 border-violet-100' },
}

// Backwards-compat: legacy callers still want SOURCE_BADGE keyed by the old
// ConversationSource enum. Map it onto the new descriptors.
export const SOURCE_BADGE: Record<ConversationSource, { label: string; tone: string }> = {
  whatsapp_real: CHANNEL_DESCRIPTORS.whatsapp,
  whatsapp_demo: { label: 'Simulado', tone: SOURCE_PILL.simulated.tone },
  crm_internal:  CHANNEL_DESCRIPTORS.crm_internal,
  web:           CHANNEL_DESCRIPTORS.web,
  unknown:       CHANNEL_DESCRIPTORS.unknown,
}

// -----------------------------------------------------------------------------
// Display name resolver — replaces the old hard-coded "Sin cliente".
// -----------------------------------------------------------------------------

export type ConversationDisplay = {
  /** The string that should be the visual title of the conversation. */
  title: string
  /** Optional supporting line under the title (phone, hint, etc). */
  subtitle: string | null
  /** True when there is no real client_id linked. UI should show a soft pill. */
  unlinked: boolean
}

export function getConversationDisplay(opts: {
  clientName?: string | null
  clientId?: string | null
  phoneFromMetadata?: string | null
  channelType: ChannelType
}): ConversationDisplay {
  const name = readString(opts.clientName)
  const phone = readString(opts.phoneFromMetadata)
  const linked = Boolean(opts.clientId)
  const descriptor = CHANNEL_DESCRIPTORS[opts.channelType]

  if (name) {
    return {
      title: name,
      subtitle: !linked && phone ? phone : null,
      unlinked: !linked,
    }
  }
  if (phone) {
    return { title: phone, subtitle: 'Pendiente de asociar a cliente', unlinked: true }
  }
  return {
    title: descriptor.fallbackContactLabel,
    subtitle: 'Pendiente de asociar a cliente',
    unlinked: true,
  }
}

// -----------------------------------------------------------------------------
// Tabs — primary lane filter for /inbox.
//
// CRM internal (Asistente IA / Copilot) does NOT appear here on purpose.
// Internal conversations live in /assistant and the dashboard timeline. The
// Inbox is the operator's channel for **external customer traffic only**.
// -----------------------------------------------------------------------------

// Vista cliente del Inbox = SOLO WhatsApp. Mantenemos `'all'` y `'whatsapp'`
// como tabs visibles, pero ambos significan WhatsApp — `all` es alias UI para
// "todas las conversaciones de WhatsApp", no para "todos los canales".
// Los tipos de canal heredados (instagram/web/email) siguen existiendo en el
// modelo de clasificación por compatibilidad, pero no son tab visible.
export type InboxTab = 'all' | 'whatsapp'

export type InboxTabDescriptor = {
  key: InboxTab
  label: string
  description: string
  /** When true, this tab points at a channel the CRM cannot deliver real
   *  messages to yet. The UI renders the tab but with a "próxima" hint. */
  future?: boolean
}

export const INBOX_TABS: InboxTabDescriptor[] = [
  { key: 'all',       label: 'Todas',     description: 'Todas las conversaciones de WhatsApp.' },
  { key: 'whatsapp',  label: 'WhatsApp',  description: 'Mensajes desde WhatsApp Business.' },
]

/** ¿Pertenece esta conversación clasificada al tab pedido? La vista del
 *  Inbox es WhatsApp-only: tanto `all` como `whatsapp` solo aceptan
 *  conversaciones de canal WhatsApp. CRM internal y resto de canales
 *  quedan ocultos del Inbox del cliente. */
export function tabMatches(tab: InboxTab, c: ConversationClassification): boolean {
  if (c.channelType !== 'whatsapp') return false
  if (tab === 'all') return true
  return c.channelType === (tab as ChannelType)
}

// Decorative-only icon getter (Inbox imports lucide icons directly to avoid a
// hard dependency from this lib on the icon set). This is left as a no-op
// helper to keep call sites tidy in case we centralize icons later.
export function channelIconColor(channel: ChannelType): string {
  return CHANNEL_DESCRIPTORS[channel].tone
}

// Type-only export for consumers that want to render their own icon mapping.
// Not used directly here, but documented for completeness.
export type _NodeOnly = ReactNode
