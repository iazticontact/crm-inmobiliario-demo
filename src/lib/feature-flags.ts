// Feature flags — minimalist gating layer used to hide top-level modules when
// cloning the CRM for a client that has not contracted them.
//
// Design rules:
//   - Read-only at runtime. No UI, no DB, no per-user toggles.
//   - All flags default to ENABLED. A clone has to opt OUT explicitly, so a
//     missing/empty env var never breaks the base product.
//   - Only `NEXT_PUBLIC_*` envs are read so the same value resolves on server
//     and client without a round trip.
//   - Use only to hide nav entries and disabled sections. Do NOT use to gate
//     server logic — real security comes from env-driven `pending_config`
//     (no API keys → no real outbound) and RLS, not these flags.

type FlagKey =
  | 'billing'
  | 'invoicing'
  | 'automations'
  | 'inbox'
  | 'assistant'
  | 'opportunities'
  | 'calendar'
  | 'instagram'
  | 'whatsapp'
  | 'demoData'
  | 'nowlabsInternal'

const FLAG_ENV: Record<FlagKey, string> = {
  billing:         'NEXT_PUBLIC_ENABLE_BILLING',
  invoicing:       'NEXT_PUBLIC_ENABLE_INVOICING',
  automations:     'NEXT_PUBLIC_ENABLE_AUTOMATIONS',
  inbox:           'NEXT_PUBLIC_ENABLE_INBOX',
  assistant:       'NEXT_PUBLIC_ENABLE_ASSISTANT',
  opportunities:   'NEXT_PUBLIC_ENABLE_OPPORTUNITIES',
  calendar:        'NEXT_PUBLIC_ENABLE_CALENDAR',
  instagram:       'NEXT_PUBLIC_ENABLE_INSTAGRAM',
  whatsapp:        'NEXT_PUBLIC_ENABLE_WHATSAPP',
  demoData:        'NEXT_PUBLIC_ENABLE_DEMO_DATA',
  nowlabsInternal: 'NEXT_PUBLIC_NOWLABS_INTERNAL',
}

function readFlag(envName: string, defaultEnabled: boolean): boolean {
  // Next.js inlines NEXT_PUBLIC_* at build time so the literal lookup matters.
  // We can't do `process.env[envName]` and have Next inline it, so we go through
  // an explicit switch. Adding a new flag = add an entry above + a case here.
  let raw: string | undefined
  switch (envName) {
    case 'NEXT_PUBLIC_ENABLE_BILLING':       raw = process.env.NEXT_PUBLIC_ENABLE_BILLING; break
    case 'NEXT_PUBLIC_ENABLE_INVOICING':     raw = process.env.NEXT_PUBLIC_ENABLE_INVOICING; break
    case 'NEXT_PUBLIC_ENABLE_AUTOMATIONS':   raw = process.env.NEXT_PUBLIC_ENABLE_AUTOMATIONS; break
    case 'NEXT_PUBLIC_ENABLE_INBOX':         raw = process.env.NEXT_PUBLIC_ENABLE_INBOX; break
    case 'NEXT_PUBLIC_ENABLE_ASSISTANT':     raw = process.env.NEXT_PUBLIC_ENABLE_ASSISTANT; break
    case 'NEXT_PUBLIC_ENABLE_OPPORTUNITIES': raw = process.env.NEXT_PUBLIC_ENABLE_OPPORTUNITIES; break
    case 'NEXT_PUBLIC_ENABLE_CALENDAR':      raw = process.env.NEXT_PUBLIC_ENABLE_CALENDAR; break
    case 'NEXT_PUBLIC_ENABLE_INSTAGRAM':     raw = process.env.NEXT_PUBLIC_ENABLE_INSTAGRAM; break
    case 'NEXT_PUBLIC_ENABLE_WHATSAPP':      raw = process.env.NEXT_PUBLIC_ENABLE_WHATSAPP; break
    case 'NEXT_PUBLIC_ENABLE_DEMO_DATA':     raw = process.env.NEXT_PUBLIC_ENABLE_DEMO_DATA; break
    case 'NEXT_PUBLIC_NOWLABS_INTERNAL':     raw = process.env.NEXT_PUBLIC_NOWLABS_INTERNAL; break
    default: raw = undefined
  }
  if (raw === undefined || raw === null || raw === '') return defaultEnabled
  const normalised = String(raw).trim().toLowerCase()
  if (normalised === 'false' || normalised === '0' || normalised === 'off' || normalised === 'no') return false
  if (normalised === 'true' || normalised === '1' || normalised === 'on' || normalised === 'yes') return true
  return defaultEnabled
}

// demoData and nowlabsInternal default to OFF: client clones must opt in
// explicitly. Every other flag stays default-on so a missing env var never
// silently disables a module. `nowlabsInternal` surfaces operator-only
// sections (Automatizaciones nav entry, Facturación nav entry, technical
// settings tiles, n8n editor, env checklists, etc.) for the internal team.
const FLAG_DEFAULT: Record<FlagKey, boolean> = {
  billing:         true,
  invoicing:       true,
  automations:     true,
  inbox:           true,
  assistant:       true,
  opportunities:   true,
  calendar:        true,
  instagram:       true,
  whatsapp:        true,
  demoData:        false,
  nowlabsInternal: false,
}

export function isFeatureEnabled(flag: FlagKey): boolean {
  return readFlag(FLAG_ENV[flag], FLAG_DEFAULT[flag])
}

export const featureFlags = {
  billing:         isFeatureEnabled('billing'),
  invoicing:       isFeatureEnabled('invoicing'),
  automations:     isFeatureEnabled('automations'),
  inbox:           isFeatureEnabled('inbox'),
  assistant:       isFeatureEnabled('assistant'),
  opportunities:   isFeatureEnabled('opportunities'),
  calendar:        isFeatureEnabled('calendar'),
  instagram:       isFeatureEnabled('instagram'),
  whatsapp:        isFeatureEnabled('whatsapp'),
  demoData:        isFeatureEnabled('demoData'),
  nowlabsInternal: isFeatureEnabled('nowlabsInternal'),
}

export type { FlagKey }
