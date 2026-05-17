// POST /api/inbox/whatsapp/inbound
//
// Authenticated bridge for inbound WhatsApp messages.
//
// Two auth modes are supported:
//   - `x-nowcrm-webhook-secret` header equal to NOWCRM_WEBHOOK_SECRET — used by
//     server-side bridges (legacy n8n flows, integration tests). With this mode
//     the workspace can be resolved by phone_number_id.
//   - `Authorization: Bearer <supabase access token>` — used by the in-app
//     simulator in Settings. With this mode the caller MUST provide
//     workspaceId, and we verify they belong to that workspace.
//
// All persistence (dedupe, conversation lookup, message insert, client linking,
// activity log) is delegated to lib/whatsapp-inbound.ts so the Meta webhook
// route and this route never drift.

import { NextResponse } from 'next/server'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { processInboundWhatsAppMessage, type ProcessInboundInput } from '@/lib/whatsapp-inbound'

export const runtime = 'nodejs'

type Provider = 'meta' | 'test'
type AuthMode = 'webhook_secret' | 'user_session'
type DataRecord = Record<string, unknown>

type WhatsappInboundPayload = {
  workspaceId?: string
  provider?: string
  phone?: string
  phoneNumberId?: string
  customerName?: string
  customerEmail?: string
  message?: string
  externalConversationId?: string
  externalMessageId?: string
  timestamp?: string
  metadata?: Record<string, unknown>
}

type NormalizedInboundPayload = ProcessInboundInput & { workspaceId?: string }

function supabaseUrl() {
  return process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
}

function serviceRoleKey() {
  return process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
}

function webhookSecret() {
  return process.env.NOWCRM_WEBHOOK_SECRET?.trim()
}

function createAdminSupabaseClient() {
  const url = supabaseUrl()
  const serviceKey = serviceRoleKey()
  if (!url || !serviceKey) return null
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

function asRecord(value: unknown): DataRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as DataRecord) : {}
}

function asString(value: unknown, fallback = '') {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function jsonError(step: string, status: number, message: string, extra: Record<string, unknown> = {}) {
  return NextResponse.json(
    {
      ok: false,
      step,
      error: message,
      message,
      status,
      ...extra,
    },
    { status },
  )
}

function validateTimestamp(value?: string) {
  if (!value) return new Date().toISOString()
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed.toISOString()
}

function normalizePayload(raw: WhatsappInboundPayload): NormalizedInboundPayload | { error: string } {
  const provider = asString(raw.provider)
  if (provider !== 'meta' && provider !== 'test') {
    return { error: 'provider es requerido y debe ser meta o test.' }
  }
  const phone = asString(raw.phone)
  if (!phone) return { error: 'phone es requerido.' }

  const message = asString(raw.message)
  if (!message) return { error: 'message es requerido.' }

  const timestamp = validateTimestamp(raw.timestamp)
  if (!timestamp) return { error: 'timestamp no es valido.' }

  const metadata = asRecord(raw.metadata)
  return {
    workspaceId: asString(raw.workspaceId) || undefined,
    provider: provider as Provider,
    phone,
    phoneNumberId: asString(raw.phoneNumberId) || undefined,
    customerName: asString(raw.customerName) || undefined,
    customerEmail: asString(raw.customerEmail).toLowerCase() || undefined,
    message,
    externalConversationId: asString(raw.externalConversationId) || undefined,
    externalMessageId: asString(raw.externalMessageId) || undefined,
    timestamp,
    metadata,
  }
}

function readAuthMode(request: Request): { authMode: AuthMode; token?: string } | null {
  const expectedSecret = webhookSecret()
  const providedSecret = request.headers.get('x-nowcrm-webhook-secret')?.trim()
  if (expectedSecret && providedSecret && providedSecret === expectedSecret) {
    return { authMode: 'webhook_secret' }
  }

  const authorization = request.headers.get('authorization') ?? ''
  const match = authorization.match(/^Bearer\s+(.+)$/i)
  if (match?.[1]?.trim()) {
    return { authMode: 'user_session', token: match[1].trim() }
  }

  return null
}

async function validateUserToken(admin: SupabaseClient, token: string) {
  const { data, error } = await admin.auth.getUser(token)
  if (error || !data.user) throw error ?? new Error('Token invalido o expirado.')
  return data.user
}

async function authorizeWorkspace(
  admin: SupabaseClient,
  workspaceId: string,
  user: { id: string; email?: string | null },
) {
  const { data, error } = await admin.from('profiles').select('*').eq('workspace_id', workspaceId).limit(100)
  if (error) throw error
  const email = user.email?.toLowerCase() ?? ''
  const rows = (data as DataRecord[] | null) ?? []
  return rows.some(
    (row) =>
      asString(row.id) === user.id ||
      asString(row.user_id) === user.id ||
      (email && asString(row.email).toLowerCase() === email),
  )
}

export async function POST(request: Request) {
  let rawBody: WhatsappInboundPayload
  try {
    rawBody = (await request.json()) as WhatsappInboundPayload
  } catch {
    return jsonError('parse_payload', 400, 'Payload JSON invalido.')
  }

  const normalized = normalizePayload(rawBody)
  if ('error' in normalized) {
    return jsonError('validate_payload', 400, normalized.error)
  }

  const admin = createAdminSupabaseClient()
  if (!admin) {
    return jsonError('server_config', 500, 'Supabase service role no esta configurado en el backend.')
  }

  const auth = readAuthMode(request)
  if (!auth) {
    return jsonError(
      'authorize_request',
      401,
      'No autorizado. Usa x-nowcrm-webhook-secret o Authorization Bearer.',
    )
  }

  if (auth.authMode === 'user_session') {
    if (!normalized.workspaceId) {
      return jsonError('validate_payload', 400, 'workspaceId es requerido con Authorization Bearer.')
    }
    let user: { id: string; email?: string | null }
    try {
      user = await validateUserToken(admin, auth.token ?? '')
    } catch {
      return jsonError('validate_user_token', 401, 'Token de usuario invalido o expirado.')
    }
    try {
      const allowed = await authorizeWorkspace(admin, normalized.workspaceId, user)
      if (!allowed) {
        return jsonError('authorize_workspace', 403, 'El usuario no pertenece a este workspace.')
      }
    } catch {
      return jsonError('authorize_workspace', 403, 'No se pudo validar la pertenencia al workspace.')
    }
  }

  // Persist through the shared helper. The helper handles workspace resolution
  // when missing (webhook_secret mode), dedupe by externalMessageId, conversation
  // upsert, message insert, phone→client linking, and activity log.
  const result = await processInboundWhatsAppMessage(admin, normalized)

  if (!result.ok) {
    if (result.step === 'resolve_workspace') {
      return jsonError(result.step, 400, result.error, { code: result.code, details: result.details })
    }
    return jsonError(result.step, 500, result.error, { code: result.code, details: result.details })
  }

  return NextResponse.json({
    ok: true,
    workspaceId: result.workspaceId,
    conversationId: result.conversationId,
    messageId: result.messageId,
    deduped: result.deduped,
    clientLinked: result.clientLinked,
    mode: 'stored_only',
    autoReply: false,
    authMode: auth.authMode,
    provider: normalized.provider,
    phone: normalized.phone,
  })
}
