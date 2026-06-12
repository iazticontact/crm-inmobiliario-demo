// Server-side Vertical Pack helpers — used by the Asistente IA agent and any
// future server-side route that needs to read/write opportunities, service
// cases or properties **with an explicit Supabase client** (SSR or service
// role). Mirrors src/lib/vertical-queries.ts but accepts the client as an
// argument so it works in API routes where there is no browser supabase
// singleton.
//
// Every helper is workspace-scoped: callers pass the workspaceId resolved
// from the auth session, and RLS validates membership at the Supabase layer.

import type { SupabaseClient } from '@supabase/supabase-js'

import type {
  OpportunityRow,
  ServiceCaseRow,
  PropertyRow,
} from '@/lib/vertical-queries'

// -----------------------------------------------------------------------------
// Reads
// -----------------------------------------------------------------------------

export async function listOpportunitiesServer(
  supabase: SupabaseClient,
  workspaceId: string,
  opts?: { vertical?: string; stage?: string; limit?: number },
) {
  if (!workspaceId) return [] as OpportunityRow[]
  let q = supabase
    .from('opportunities')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('updated_at', { ascending: false })
    .limit(opts?.limit ?? 50)
  if (opts?.vertical) q = q.eq('vertical', opts.vertical)
  if (opts?.stage) q = q.eq('stage', opts.stage)
  const { data, error } = await q
  if (error) {
    console.warn('[vertical-server:listOpportunities]', error.message.slice(0, 120))
    return [] as OpportunityRow[]
  }
  return (data ?? []) as OpportunityRow[]
}

export async function listServiceCasesServer(
  supabase: SupabaseClient,
  workspaceId: string,
  opts?: { vertical?: string; status?: string; limit?: number },
) {
  if (!workspaceId) return [] as ServiceCaseRow[]
  let q = supabase
    .from('service_cases')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('updated_at', { ascending: false })
    .limit(opts?.limit ?? 50)
  if (opts?.vertical) q = q.eq('vertical', opts.vertical)
  if (opts?.status) q = q.eq('status', opts.status)
  const { data, error } = await q
  if (error) {
    console.warn('[vertical-server:listServiceCases]', error.message.slice(0, 120))
    return [] as ServiceCaseRow[]
  }
  return (data ?? []) as ServiceCaseRow[]
}

export async function listPropertiesServer(
  supabase: SupabaseClient,
  workspaceId: string,
  opts?: { status?: string; city?: string; limit?: number },
) {
  if (!workspaceId) return [] as PropertyRow[]
  let q = supabase
    .from('properties')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('updated_at', { ascending: false })
    .limit(opts?.limit ?? 50)
  if (opts?.status) q = q.eq('status', opts.status)
  if (opts?.city) q = q.ilike('city', `%${opts.city}%`)
  const { data, error } = await q
  if (error) {
    console.warn('[vertical-server:listProperties]', error.message.slice(0, 120))
    return [] as PropertyRow[]
  }
  return (data ?? []) as PropertyRow[]
}

// -----------------------------------------------------------------------------
// Writes — used after the agent confirms intent with the user in chat.
//
// All write helpers:
//   - Trim and validate the title.
//   - Default vertical='general', sensible defaults per entity.
//   - Pass metadata through unchanged (never overwrites server-set fields).
//   - Append a small activity log row so the dashboard timeline shows what
//     the Asistente IA did (and a human reviewer can audit it).
//
// They return the inserted row or null on failure. They never throw.
// -----------------------------------------------------------------------------

type WriteContext = {
  supabase: SupabaseClient
  workspaceId: string
  /** Optional: agent description ("creada desde el Asistente IA") to attribute the action. */
  origin?: string
}

async function logActivityBestEffort(
  ctx: WriteContext,
  input: { type: string; title: string; description?: string; clientId?: string | null; clientName?: string | null; metadata?: Record<string, unknown> },
) {
  // Best effort — the activity log must NEVER block the main write. If the
  // schema rejects optional columns we silently degrade. (No retry loop.)
  try {
    await ctx.supabase.from('activities').insert({
      workspace_id: ctx.workspaceId,
      type: input.type,
      title: input.title,
      description: input.description ?? null,
      client_id: input.clientId ?? null,
      client_name: input.clientName ?? null,
      metadata: { source: ctx.origin ?? 'nowlabs_agent', ...(input.metadata ?? {}) },
    })
  } catch (err) {
    console.warn('[vertical-server:logActivity]', err instanceof Error ? err.message.slice(0, 120) : String(err))
  }
}

export type CreateOpportunityInput = {
  title: string
  vertical?: string
  pipeline?: string
  stage?: string
  clientId?: string | null
  clientName?: string | null
  value?: number | null
  probability?: number | null
  source?: string | null
  expectedCloseDate?: string | null
  notes?: string | null
  metadata?: Record<string, unknown>
}

export async function createOpportunityServer(ctx: WriteContext, input: CreateOpportunityInput): Promise<OpportunityRow | null> {
  const title = (input.title ?? '').trim()
  if (!ctx.workspaceId || !title) return null
  const { data, error } = await ctx.supabase
    .from('opportunities')
    .insert({
      workspace_id: ctx.workspaceId,
      client_id: input.clientId ?? null,
      title,
      vertical: input.vertical ?? 'general',
      pipeline: input.pipeline ?? 'default',
      stage: input.stage ?? 'new',
      value: input.value ?? null,
      probability: input.probability ?? null,
      source: input.source ?? null,
      expected_close_date: input.expectedCloseDate ?? null,
      notes: input.notes ?? null,
      metadata: input.metadata ?? {},
    })
    .select('*')
    .single()
  if (error) {
    console.warn('[vertical-server:createOpportunity]', error.message.slice(0, 120))
    return null
  }
  const row = data as OpportunityRow
  await logActivityBestEffort(ctx, {
    type: 'opportunity_created',
    title: `Oportunidad creada: ${row.title}`,
    description: `Vertical ${row.vertical} · stage ${row.stage}${row.value ? ` · ${row.value}€` : ''}`,
    clientId: row.client_id,
    clientName: input.clientName ?? null,
    metadata: { opportunity_id: row.id, vertical: row.vertical, stage: row.stage },
  })
  return row
}

export async function updateOpportunityStageServer(
  ctx: WriteContext,
  id: string,
  stage: string,
): Promise<OpportunityRow | null> {
  if (!ctx.workspaceId || !id || !stage) return null
  const { data, error } = await ctx.supabase
    .from('opportunities')
    .update({ stage, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('workspace_id', ctx.workspaceId)
    .select('*')
    .single()
  if (error) {
    console.warn('[vertical-server:updateOpportunityStage]', error.message.slice(0, 120))
    return null
  }
  const row = data as OpportunityRow
  await logActivityBestEffort(ctx, {
    type: 'opportunity_stage_updated',
    title: `Oportunidad → ${stage}`,
    description: `"${row.title}" pasa a etapa ${stage}.`,
    clientId: row.client_id,
    metadata: { opportunity_id: row.id, stage },
  })
  return row
}

export type CreateServiceCaseInput = {
  title: string
  caseType: string
  vertical?: string
  status?: string
  priority?: string
  clientId?: string | null
  clientName?: string | null
  opportunityId?: string | null
  dueDate?: string | null
  notes?: string | null
  metadata?: Record<string, unknown>
}

export async function createServiceCaseServer(ctx: WriteContext, input: CreateServiceCaseInput): Promise<ServiceCaseRow | null> {
  const title = (input.title ?? '').trim()
  if (!ctx.workspaceId || !title || !input.caseType) return null
  const { data, error } = await ctx.supabase
    .from('service_cases')
    .insert({
      workspace_id: ctx.workspaceId,
      client_id: input.clientId ?? null,
      opportunity_id: input.opportunityId ?? null,
      title,
      case_type: input.caseType,
      vertical: input.vertical ?? 'general',
      status: input.status ?? 'open',
      priority: input.priority ?? 'normal',
      due_date: input.dueDate ?? null,
      notes: input.notes ?? null,
      metadata: input.metadata ?? {},
    })
    .select('*')
    .single()
  if (error) {
    console.warn('[vertical-server:createServiceCase]', error.message.slice(0, 120))
    return null
  }
  const row = data as ServiceCaseRow
  await logActivityBestEffort(ctx, {
    type: 'service_case_created',
    title: `Expediente abierto: ${row.title}`,
    description: `${row.case_type} · estado ${row.status}${row.due_date ? ` · vence ${row.due_date}` : ''}`,
    clientId: row.client_id,
    clientName: input.clientName ?? null,
    metadata: { case_id: row.id, case_type: row.case_type },
  })
  return row
}

export async function updateServiceCaseStatusServer(
  ctx: WriteContext,
  id: string,
  status: string,
): Promise<ServiceCaseRow | null> {
  if (!ctx.workspaceId || !id || !status) return null
  const { data, error } = await ctx.supabase
    .from('service_cases')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('workspace_id', ctx.workspaceId)
    .select('*')
    .single()
  if (error) {
    console.warn('[vertical-server:updateServiceCaseStatus]', error.message.slice(0, 120))
    return null
  }
  const row = data as ServiceCaseRow
  await logActivityBestEffort(ctx, {
    type: 'service_case_status_updated',
    title: `Expediente → ${status}`,
    description: `"${row.title}" pasa a ${status}.`,
    clientId: row.client_id,
    metadata: { case_id: row.id, status },
  })
  return row
}

export type CreatePropertyInput = {
  title: string
  propertyType?: string
  operationType?: string
  status?: string
  city?: string
  area?: string
  price?: number | null
  ownerName?: string
  ownerPhone?: string
  clientId?: string | null
  clientName?: string | null
  notes?: string
  metadata?: Record<string, unknown>
}

export async function createPropertyServer(ctx: WriteContext, input: CreatePropertyInput): Promise<PropertyRow | null> {
  const title = (input.title ?? '').trim()
  if (!ctx.workspaceId || !title) return null
  const { data, error } = await ctx.supabase
    .from('properties')
    .insert({
      workspace_id: ctx.workspaceId,
      client_id: input.clientId ?? null,
      title,
      property_type: input.propertyType ?? 'apartment',
      operation_type: input.operationType ?? 'sale',
      status: input.status ?? 'prospecting',
      city: input.city ?? null,
      area: input.area ?? null,
      price: input.price ?? null,
      owner_name: input.ownerName ?? null,
      owner_phone: input.ownerPhone ?? null,
      notes: input.notes ?? null,
      metadata: input.metadata ?? {},
    })
    .select('*')
    .single()
  if (error) {
    console.warn('[vertical-server:createProperty]', error.message.slice(0, 120))
    return null
  }
  const row = data as PropertyRow
  await logActivityBestEffort(ctx, {
    type: 'property_created',
    title: `Propiedad en cartera: ${row.title}`,
    description: `${row.property_type} · ${row.operation_type}${row.city ? ` · ${row.city}` : ''}${row.price ? ` · ${row.price}€` : ''}`,
    clientId: row.client_id,
    clientName: input.clientName ?? null,
    metadata: { property_id: row.id, property_type: row.property_type, operation_type: row.operation_type },
  })
  return row
}

export async function updatePropertyStatusServer(
  ctx: WriteContext,
  id: string,
  status: string,
): Promise<PropertyRow | null> {
  if (!ctx.workspaceId || !id || !status) return null
  const { data, error } = await ctx.supabase
    .from('properties')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('workspace_id', ctx.workspaceId)
    .select('*')
    .single()
  if (error) {
    console.warn('[vertical-server:updatePropertyStatus]', error.message.slice(0, 120))
    return null
  }
  const row = data as PropertyRow
  await logActivityBestEffort(ctx, {
    type: 'property_status_updated',
    title: `Propiedad → ${status}`,
    description: `"${row.title}" pasa a ${status}.`,
    clientId: row.client_id,
    metadata: { property_id: row.id, status },
  })
  return row
}

// -----------------------------------------------------------------------------
// Convenience formatters for the agent output (kept here so the agent stays
// schema-aware without rewriting strings in two places).
// -----------------------------------------------------------------------------

export function formatOpportunityLine(o: OpportunityRow, idx: number): string {
  const vertical = o.vertical && o.vertical !== 'general' ? ` · ${o.vertical}` : ''
  const value = o.value ? ` · ${o.value}€` : ''
  const closeBy = o.expected_close_date ? ` · cierre ${o.expected_close_date}` : ''
  return `${idx + 1}. ${o.title} — ${o.stage}${vertical}${value}${closeBy}`
}

export function formatServiceCaseLine(c: ServiceCaseRow, idx: number): string {
  const due = c.due_date ? ` · vence ${c.due_date}` : ''
  const priority = c.priority !== 'normal' ? ` · ${c.priority}` : ''
  return `${idx + 1}. ${c.title} — ${c.case_type} · ${c.status}${priority}${due}`
}

export function formatPropertyLine(p: PropertyRow, idx: number): string {
  const where = [p.city, p.area].filter(Boolean).join(' · ')
  const price = p.price ? ` · ${p.price}€` : ''
  return `${idx + 1}. ${p.title} — ${p.property_type} ${p.operation_type} · ${p.status}${where ? ` · ${where}` : ''}${price}`
}
