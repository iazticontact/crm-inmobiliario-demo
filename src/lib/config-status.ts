// Server-only configuration status helper.
//
// IMPORTANT: This module is intended for server-side use (API routes, server
// components). It reads process.env, but NEVER returns or logs the values —
// only booleans + a list of MISSING variable NAMES (not values).
//
// Use this to:
//   - render honest "pending_config" states in the UI without leaking secrets
//   - drive the test/status routes
//   - feed onboarding checklists in docs
//
// If you ever need to expose this to the browser, do it via an API route that
// calls these helpers; never import this file from a client component.

export type MetaConfigStatus =
  | 'ready'
  | 'pending_app_secret'
  | 'pending_token'
  | 'pending_verify_token'
  | 'pending_webhook_secret'
  | 'misconfigured'

export type OpenAiConfigStatus = 'ready' | 'pending_openai_key' | 'disabled'

export type N8nConfigStatus = 'ready' | 'pending_config' | 'disabled'

export type SupabaseConfigStatus = 'ready' | 'pending_public_keys' | 'pending_service_role' | 'misconfigured'

export type GoogleConfigStatus = 'ready' | 'pending_client_credentials' | 'disabled'

export type ConfigSnapshot = {
  meta: {
    hasAccessToken: boolean
    hasAppSecret: boolean
    hasWebhookVerifyToken: boolean
    hasWebhookSecret: boolean
    graphVersion: string
    status: MetaConfigStatus
    missingVariables: string[]
  }
  openai: {
    hasApiKey: boolean
    model: string
    status: OpenAiConfigStatus
    missingVariables: string[]
  }
  n8n: {
    hasBaseUrl: boolean
    hasApiKey: boolean
    hasWebhookSecret: boolean
    defaultTimeoutMs: number
    status: N8nConfigStatus
    missingVariables: string[]
  }
  supabase: {
    hasPublicUrl: boolean
    hasPublicKey: boolean
    hasServiceRole: boolean
    status: SupabaseConfigStatus
    missingVariables: string[]
  }
  google: {
    hasClientId: boolean
    hasClientSecret: boolean
    hasRedirectUri: boolean
    status: GoogleConfigStatus
    missingVariables: string[]
  }
  publicAppUrl: string | null
  nodeEnv: string
}

function has(name: string): boolean {
  const value = process.env[name]
  return typeof value === 'string' && value.trim().length > 0
}

function getMetaStatus(): { status: MetaConfigStatus; missing: string[] } {
  const missing: string[] = []
  if (!has('META_WEBHOOK_VERIFY_TOKEN')) missing.push('META_WEBHOOK_VERIFY_TOKEN')
  if (!has('META_APP_SECRET')) missing.push('META_APP_SECRET')
  if (!has('META_WHATSAPP_ACCESS_TOKEN') && !has('META_ACCESS_TOKEN')) missing.push('META_WHATSAPP_ACCESS_TOKEN')
  if (!has('NOWCRM_WEBHOOK_SECRET')) missing.push('NOWCRM_WEBHOOK_SECRET')

  if (missing.length === 0) return { status: 'ready', missing }
  if (!has('META_APP_SECRET')) return { status: 'pending_app_secret', missing }
  if (!has('META_WEBHOOK_VERIFY_TOKEN')) return { status: 'pending_verify_token', missing }
  if (!has('META_WHATSAPP_ACCESS_TOKEN') && !has('META_ACCESS_TOKEN')) return { status: 'pending_token', missing }
  if (!has('NOWCRM_WEBHOOK_SECRET')) return { status: 'pending_webhook_secret', missing }
  return { status: 'misconfigured', missing }
}

function getOpenAiStatus(): { status: OpenAiConfigStatus; missing: string[] } {
  if (has('OPENAI_API_KEY')) return { status: 'ready', missing: [] }
  return { status: 'pending_openai_key', missing: ['OPENAI_API_KEY'] }
}

function getN8nStatus(): { status: N8nConfigStatus; missing: string[] } {
  const missing: string[] = []
  const hasBase = has('N8N_BASE_URL')
  const hasKey = has('N8N_API_KEY')
  if (!hasBase) missing.push('N8N_BASE_URL')
  if (!hasKey) missing.push('N8N_API_KEY')
  // N8N_WEBHOOK_SECRET is recommended but not strictly required for read-only status checks
  if (!has('N8N_WEBHOOK_SECRET')) missing.push('N8N_WEBHOOK_SECRET')
  if (hasBase && hasKey) return { status: 'ready', missing }
  return { status: 'pending_config', missing }
}

function getSupabaseStatus(): { status: SupabaseConfigStatus; missing: string[] } {
  const missing: string[] = []
  const hasUrl = has('NEXT_PUBLIC_SUPABASE_URL')
  const hasPublic = has('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY') || has('NEXT_PUBLIC_SUPABASE_ANON_KEY')
  const hasService = has('SUPABASE_SERVICE_ROLE_KEY')

  if (!hasUrl) missing.push('NEXT_PUBLIC_SUPABASE_URL')
  if (!hasPublic) missing.push('NEXT_PUBLIC_SUPABASE_ANON_KEY')
  if (!hasService) missing.push('SUPABASE_SERVICE_ROLE_KEY')

  if (!hasUrl || !hasPublic) return { status: 'misconfigured', missing }
  if (!hasService) return { status: 'pending_service_role', missing }
  if (!hasPublic) return { status: 'pending_public_keys', missing }
  return { status: 'ready', missing }
}

function getGoogleStatus(): { status: GoogleConfigStatus; missing: string[] } {
  const missing: string[] = []
  if (!has('GOOGLE_CLIENT_ID')) missing.push('GOOGLE_CLIENT_ID')
  if (!has('GOOGLE_CLIENT_SECRET')) missing.push('GOOGLE_CLIENT_SECRET')
  if (!has('GOOGLE_REDIRECT_URI')) missing.push('GOOGLE_REDIRECT_URI')
  if (missing.length === 0) return { status: 'ready', missing }
  return { status: 'pending_client_credentials', missing }
}

export function getConfigSnapshot(): ConfigSnapshot {
  const meta = getMetaStatus()
  const openai = getOpenAiStatus()
  const n8n = getN8nStatus()
  const supabase = getSupabaseStatus()
  const google = getGoogleStatus()

  const timeoutRaw = Number(process.env.N8N_DEFAULT_TIMEOUT_MS)
  const defaultTimeoutMs = Number.isFinite(timeoutRaw) && timeoutRaw > 0 ? timeoutRaw : 8000

  return {
    meta: {
      hasAccessToken: has('META_WHATSAPP_ACCESS_TOKEN') || has('META_ACCESS_TOKEN'),
      hasAppSecret: has('META_APP_SECRET'),
      hasWebhookVerifyToken: has('META_WEBHOOK_VERIFY_TOKEN'),
      hasWebhookSecret: has('NOWCRM_WEBHOOK_SECRET'),
      graphVersion: process.env.META_GRAPH_VERSION?.trim() || 'v21.0',
      status: meta.status,
      missingVariables: meta.missing,
    },
    openai: {
      hasApiKey: has('OPENAI_API_KEY'),
      model: process.env.NOWLABS_MODEL?.trim() || process.env.OPENAI_MODEL?.trim() || 'gpt-4.1-mini',
      status: openai.status,
      missingVariables: openai.missing,
    },
    n8n: {
      hasBaseUrl: has('N8N_BASE_URL'),
      hasApiKey: has('N8N_API_KEY'),
      hasWebhookSecret: has('N8N_WEBHOOK_SECRET'),
      defaultTimeoutMs,
      status: n8n.status,
      missingVariables: n8n.missing,
    },
    supabase: {
      hasPublicUrl: has('NEXT_PUBLIC_SUPABASE_URL'),
      hasPublicKey: has('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY') || has('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
      hasServiceRole: has('SUPABASE_SERVICE_ROLE_KEY'),
      status: supabase.status,
      missingVariables: supabase.missing,
    },
    google: {
      hasClientId: has('GOOGLE_CLIENT_ID'),
      hasClientSecret: has('GOOGLE_CLIENT_SECRET'),
      hasRedirectUri: has('GOOGLE_REDIRECT_URI'),
      status: google.status,
      missingVariables: google.missing,
    },
    publicAppUrl: process.env.NEXT_PUBLIC_APP_URL?.trim() || null,
    nodeEnv: process.env.NODE_ENV || 'development',
  }
}

export function getMetaReadinessRecommendation(snapshot: ConfigSnapshot): string {
  if (snapshot.meta.status === 'ready') return 'Meta WhatsApp listo en el servidor. Falta configurar Phone Number ID y WABA en Settings del workspace.'
  if (snapshot.meta.status === 'pending_verify_token') return 'Falta META_WEBHOOK_VERIFY_TOKEN. Genera un UUID y añádelo en el servidor antes de registrar el webhook en Meta.'
  if (snapshot.meta.status === 'pending_app_secret') return 'Falta META_APP_SECRET. Cópialo desde Meta Developers > App > Settings > Basic.'
  if (snapshot.meta.status === 'pending_token') return 'Falta META_WHATSAPP_ACCESS_TOKEN. Crea un System User Token en Meta Business Manager.'
  if (snapshot.meta.status === 'pending_webhook_secret') return 'Falta NOWCRM_WEBHOOK_SECRET. Genera un secreto interno para el bridge meta-webhook → inbound.'
  return 'Servidor mal configurado para WhatsApp Meta. Revisa las variables marcadas como pendientes.'
}
