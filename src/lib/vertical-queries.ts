// Vertical Pack queries — Supabase reads/writes for opportunities,
// service_cases and properties. Kept in its own file to avoid bloating
// supabase-queries.ts and to make the workspace-scoping contract obvious in
// one place.
//
// Every query is workspace-scoped via the user's auth session + RLS; the
// browser client never sees rows from other workspaces. The helpers degrade
// quietly to empty arrays when Supabase is not configured so the UI keeps
// rendering empty states instead of crashing.
//
// Writes append an `activities` row best-effort with metadata.source='ui_manual'
// so the dashboard timeline shows UI and Asistente IA actions side by side. The
// server-side mirror (vertical-server.ts) writes the same activity types with
// metadata.source='nowlabs_agent'.

import type { SupabaseClient } from '@supabase/supabase-js'
import { getSupabaseBrowserClient } from '@/lib/supabase'
import type { VerticalKey } from '@/lib/demo/vertical-templates'

async function logActivity(
  supabase: SupabaseClient,
  input: {
    workspaceId: string
    type: string
    title: string
    description?: string
    clientId?: string | null
    clientName?: string | null
    metadata?: Record<string, unknown>
  },
) {
  try {
    await supabase.from('activities').insert({
      workspace_id: input.workspaceId,
      type: input.type,
      title: input.title,
      description: input.description ?? null,
      client_id: input.clientId ?? null,
      client_name: input.clientName ?? null,
      metadata: { source: 'ui_manual', ...(input.metadata ?? {}) },
    })
  } catch (err) {
    if (process.env.NODE_ENV === 'development') {
      console.warn('[vertical-queries:logActivity]', err instanceof Error ? err.message : String(err))
    }
  }
}

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export type OpportunityRow = {
  id: string
  workspace_id: string
  client_id: string | null
  title: string
  vertical: VerticalKey | string
  pipeline: string
  stage: string
  value: number | null
  probability: number | null
  currency: string | null
  source: string | null
  assigned_to: string | null
  expected_close_date: string | null
  notes: string | null
  metadata: Record<string, unknown> | null
  created_at: string
  updated_at: string
}

export type ServiceCaseRow = {
  id: string
  workspace_id: string
  client_id: string | null
  opportunity_id: string | null
  case_type: string
  vertical: VerticalKey | string
  title: string
  status: string
  priority: string
  due_date: string | null
  assigned_to: string | null
  notes: string | null
  metadata: Record<string, unknown> | null
  created_at: string
  updated_at: string
}

export type PropertyRow = {
  id: string
  workspace_id: string
  client_id: string | null
  title: string
  property_type: string | null
  operation_type: string | null
  status: string
  city: string | null
  area: string | null
  address: string | null
  price: number | null
  currency: string | null
  owner_name: string | null
  owner_phone: string | null
  notes: string | null
  metadata: Record<string, unknown> | null
  created_at: string
  updated_at: string
}

// -----------------------------------------------------------------------------
// Reads
// -----------------------------------------------------------------------------

export async function listOpportunities(workspaceId: string, opts?: { vertical?: VerticalKey; limit?: number }) {
  const supabase = getSupabaseBrowserClient()
  if (!supabase || !workspaceId) return [] as OpportunityRow[]
  let q = supabase
    .from('opportunities')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('updated_at', { ascending: false })
    .limit(opts?.limit ?? 100)
  if (opts?.vertical) q = q.eq('vertical', opts.vertical)
  const { data, error } = await q
  if (error) {
    if (process.env.NODE_ENV === 'development') console.warn('[listOpportunities]', error.message)
    return [] as OpportunityRow[]
  }
  return (data ?? []) as OpportunityRow[]
}

export async function listServiceCases(workspaceId: string, opts?: { vertical?: VerticalKey; status?: string; limit?: number }) {
  const supabase = getSupabaseBrowserClient()
  if (!supabase || !workspaceId) return [] as ServiceCaseRow[]
  let q = supabase
    .from('service_cases')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('updated_at', { ascending: false })
    .limit(opts?.limit ?? 100)
  if (opts?.vertical) q = q.eq('vertical', opts.vertical)
  if (opts?.status) q = q.eq('status', opts.status)
  const { data, error } = await q
  if (error) {
    if (process.env.NODE_ENV === 'development') console.warn('[listServiceCases]', error.message)
    return [] as ServiceCaseRow[]
  }
  return (data ?? []) as ServiceCaseRow[]
}

export async function listProperties(workspaceId: string, opts?: { status?: string; limit?: number }) {
  const supabase = getSupabaseBrowserClient()
  if (!supabase || !workspaceId) return [] as PropertyRow[]
  let q = supabase
    .from('properties')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('updated_at', { ascending: false })
    .limit(opts?.limit ?? 100)
  if (opts?.status) q = q.eq('status', opts.status)
  const { data, error } = await q
  if (error) {
    if (process.env.NODE_ENV === 'development') console.warn('[listProperties]', error.message)
    return [] as PropertyRow[]
  }
  return (data ?? []) as PropertyRow[]
}

// Client 360 — vertical entities scoped to a single client. Used by the
// /clients drawer and any future cliente-360 surface.
export async function getClientVerticalSummary(workspaceId: string, clientId: string) {
  const supabase = getSupabaseBrowserClient()
  if (!supabase || !workspaceId || !clientId) {
    return { opportunities: [] as OpportunityRow[], cases: [] as ServiceCaseRow[], properties: [] as PropertyRow[] }
  }
  const [opps, srv, props] = await Promise.all([
    supabase.from('opportunities').select('*').eq('workspace_id', workspaceId).eq('client_id', clientId).order('updated_at', { ascending: false }).limit(20),
    supabase.from('service_cases').select('*').eq('workspace_id', workspaceId).eq('client_id', clientId).order('updated_at', { ascending: false }).limit(20),
    supabase.from('properties').select('*').eq('workspace_id', workspaceId).eq('client_id', clientId).order('updated_at', { ascending: false }).limit(20),
  ])
  return {
    opportunities: ((opps.data ?? []) as OpportunityRow[]),
    cases: ((srv.data ?? []) as ServiceCaseRow[]),
    properties: ((props.data ?? []) as PropertyRow[]),
  }
}

// -----------------------------------------------------------------------------
// Writes (lean, RLS-aware). All return the inserted row or null on failure.
// -----------------------------------------------------------------------------

export async function createOpportunity(workspaceId: string, input: {
  title: string
  vertical: VerticalKey
  pipeline?: string
  stage?: string
  clientId?: string | null
  clientName?: string | null
  value?: number | null
  probability?: number | null
  source?: string | null
  assignedTo?: string | null
  expectedCloseDate?: string | null
  notes?: string | null
  metadata?: Record<string, unknown>
}) {
  const supabase = getSupabaseBrowserClient()
  if (!supabase || !workspaceId || !input.title?.trim()) return null
  const { data, error } = await supabase
    .from('opportunities')
    .insert({
      workspace_id: workspaceId,
      client_id: input.clientId ?? null,
      title: input.title.trim(),
      vertical: input.vertical,
      pipeline: input.pipeline ?? 'default',
      stage: input.stage ?? 'new',
      value: input.value ?? null,
      probability: input.probability ?? null,
      source: input.source ?? null,
      assigned_to: input.assignedTo ?? null,
      expected_close_date: input.expectedCloseDate ?? null,
      notes: input.notes ?? null,
      metadata: input.metadata ?? {},
    })
    .select('*')
    .single()
  if (error) {
    if (process.env.NODE_ENV === 'development') console.warn('[createOpportunity]', error.message)
    return null
  }
  const row = data as OpportunityRow
  await logActivity(supabase, {
    workspaceId,
    type: 'opportunity_created',
    title: `Operación creada: ${row.title}`,
    description: `Vertical ${row.vertical} · stage ${row.stage}${row.value ? ` · ${row.value}€` : ''}`,
    clientId: row.client_id,
    clientName: input.clientName ?? null,
    metadata: { opportunity_id: row.id, vertical: row.vertical, stage: row.stage },
  })
  return row
}

export async function updateOpportunityStage(workspaceId: string, id: string, stage: string) {
  const supabase = getSupabaseBrowserClient()
  if (!supabase || !workspaceId || !id) return false
  const { data, error } = await supabase
    .from('opportunities')
    .update({ stage, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('workspace_id', workspaceId)
    .select('id, title, stage, client_id')
    .single()
  if (error) {
    if (process.env.NODE_ENV === 'development') console.warn('[updateOpportunityStage]', error.message)
    return false
  }
  await logActivity(supabase, {
    workspaceId,
    type: 'opportunity_stage_updated',
    title: `Operación → ${stage}`,
    description: `"${data.title}" pasa a etapa ${stage}.`,
    clientId: data.client_id,
    metadata: { opportunity_id: data.id, stage },
  })
  return true
}

export type UpdateOpportunityInput = {
  title?: string
  vertical?: VerticalKey | string
  stage?: string
  clientId?: string | null
  value?: number | null
  probability?: number | null
  source?: string | null
  expectedCloseDate?: string | null
  notes?: string | null
}

export async function updateOpportunity(workspaceId: string, id: string, input: UpdateOpportunityInput) {
  const supabase = getSupabaseBrowserClient()
  if (!supabase || !workspaceId || !id) return null
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (typeof input.title === 'string' && input.title.trim()) patch.title = input.title.trim()
  if (input.vertical) patch.vertical = input.vertical
  if (input.stage) patch.stage = input.stage
  if (input.clientId !== undefined) patch.client_id = input.clientId
  if (input.value !== undefined) patch.value = input.value
  if (input.probability !== undefined) patch.probability = input.probability
  if (input.source !== undefined) patch.source = input.source
  if (input.expectedCloseDate !== undefined) patch.expected_close_date = input.expectedCloseDate
  if (input.notes !== undefined) patch.notes = input.notes

  const { data, error } = await supabase
    .from('opportunities')
    .update(patch)
    .eq('id', id)
    .eq('workspace_id', workspaceId)
    .select('*')
    .single()
  if (error) {
    if (process.env.NODE_ENV === 'development') console.warn('[updateOpportunity]', error.message)
    return null
  }
  const row = data as OpportunityRow
  await logActivity(supabase, {
    workspaceId,
    type: 'opportunity_updated',
    title: `Operación editada: ${row.title}`,
    description: `Stage ${row.stage}${row.value ? ` · ${row.value}€` : ''}${row.probability != null ? ` · ${row.probability}%` : ''}`,
    clientId: row.client_id,
    metadata: { opportunity_id: row.id },
  })
  return row
}

export async function createServiceCase(workspaceId: string, input: {
  title: string
  caseType: string
  vertical: VerticalKey
  clientId?: string | null
  clientName?: string | null
  opportunityId?: string | null
  status?: string
  priority?: string
  assignedTo?: string | null
  dueDate?: string | null
  notes?: string | null
  metadata?: Record<string, unknown>
}) {
  const supabase = getSupabaseBrowserClient()
  if (!supabase || !workspaceId || !input.title?.trim()) return null
  const { data, error } = await supabase
    .from('service_cases')
    .insert({
      workspace_id: workspaceId,
      client_id: input.clientId ?? null,
      opportunity_id: input.opportunityId ?? null,
      title: input.title.trim(),
      case_type: input.caseType,
      vertical: input.vertical,
      status: input.status ?? 'open',
      priority: input.priority ?? 'normal',
      assigned_to: input.assignedTo ?? null,
      due_date: input.dueDate ?? null,
      notes: input.notes ?? null,
      metadata: input.metadata ?? {},
    })
    .select('*')
    .single()
  if (error) {
    if (process.env.NODE_ENV === 'development') console.warn('[createServiceCase]', error.message)
    return null
  }
  const row = data as ServiceCaseRow
  await logActivity(supabase, {
    workspaceId,
    type: 'service_case_created',
    title: `Expediente abierto: ${row.title}`,
    description: `${row.case_type} · estado ${row.status}${row.due_date ? ` · vence ${row.due_date}` : ''}`,
    clientId: row.client_id,
    clientName: input.clientName ?? null,
    metadata: { case_id: row.id, case_type: row.case_type },
  })
  return row
}

export async function updateServiceCaseStatus(workspaceId: string, id: string, status: string) {
  const supabase = getSupabaseBrowserClient()
  if (!supabase || !workspaceId || !id) return false
  const { data, error } = await supabase
    .from('service_cases')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('workspace_id', workspaceId)
    .select('id, title, status, client_id')
    .single()
  if (error) {
    if (process.env.NODE_ENV === 'development') console.warn('[updateServiceCaseStatus]', error.message)
    return false
  }
  await logActivity(supabase, {
    workspaceId,
    type: 'service_case_status_updated',
    title: `Expediente → ${status}`,
    description: `"${data.title}" pasa a ${status}.`,
    clientId: data.client_id,
    metadata: { case_id: data.id, status },
  })
  return true
}

export type UpdateServiceCaseInput = {
  title?: string
  caseType?: string
  vertical?: VerticalKey | string
  status?: string
  priority?: string
  clientId?: string | null
  dueDate?: string | null
  notes?: string | null
}

export async function updateServiceCase(workspaceId: string, id: string, input: UpdateServiceCaseInput) {
  const supabase = getSupabaseBrowserClient()
  if (!supabase || !workspaceId || !id) return null
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (typeof input.title === 'string' && input.title.trim()) patch.title = input.title.trim()
  if (input.caseType) patch.case_type = input.caseType
  if (input.vertical) patch.vertical = input.vertical
  if (input.status) patch.status = input.status
  if (input.priority) patch.priority = input.priority
  if (input.clientId !== undefined) patch.client_id = input.clientId
  if (input.dueDate !== undefined) patch.due_date = input.dueDate
  if (input.notes !== undefined) patch.notes = input.notes

  const { data, error } = await supabase
    .from('service_cases')
    .update(patch)
    .eq('id', id)
    .eq('workspace_id', workspaceId)
    .select('*')
    .single()
  if (error) {
    if (process.env.NODE_ENV === 'development') console.warn('[updateServiceCase]', error.message)
    return null
  }
  const row = data as ServiceCaseRow
  await logActivity(supabase, {
    workspaceId,
    type: 'service_case_updated',
    title: `Expediente editado: ${row.title}`,
    description: `${row.case_type} · ${row.status}${row.priority !== 'normal' ? ` · ${row.priority}` : ''}${row.due_date ? ` · vence ${row.due_date}` : ''}`,
    clientId: row.client_id,
    metadata: { case_id: row.id },
  })
  return row
}

export async function createProperty(workspaceId: string, input: {
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
}) {
  const supabase = getSupabaseBrowserClient()
  if (!supabase || !workspaceId || !input.title?.trim()) return null
  const { data, error } = await supabase
    .from('properties')
    .insert({
      workspace_id: workspaceId,
      client_id: input.clientId ?? null,
      title: input.title.trim(),
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
    if (process.env.NODE_ENV === 'development') console.warn('[createProperty]', error.message)
    return null
  }
  const row = data as PropertyRow
  await logActivity(supabase, {
    workspaceId,
    type: 'property_created',
    title: `Propiedad en cartera: ${row.title}`,
    description: `${row.property_type} · ${row.operation_type}${row.city ? ` · ${row.city}` : ''}${row.price ? ` · ${row.price}€` : ''}`,
    clientId: row.client_id,
    clientName: input.clientName ?? null,
    metadata: { property_id: row.id, property_type: row.property_type, operation_type: row.operation_type },
  })
  return row
}

export async function updatePropertyStatus(workspaceId: string, id: string, status: string) {
  const supabase = getSupabaseBrowserClient()
  if (!supabase || !workspaceId || !id) return false
  const { data, error } = await supabase
    .from('properties')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('workspace_id', workspaceId)
    .select('id, title, status, client_id')
    .single()
  if (error) {
    if (process.env.NODE_ENV === 'development') console.warn('[updatePropertyStatus]', error.message)
    return false
  }
  await logActivity(supabase, {
    workspaceId,
    type: 'property_status_updated',
    title: `Propiedad → ${status}`,
    description: `"${data.title}" pasa a ${status}.`,
    clientId: data.client_id,
    metadata: { property_id: data.id, status },
  })
  return true
}

export type UpdatePropertyInput = {
  title?: string
  propertyType?: string
  operationType?: string
  status?: string
  city?: string | null
  area?: string | null
  price?: number | null
  ownerName?: string | null
  ownerPhone?: string | null
  clientId?: string | null
  notes?: string | null
}

export async function updateProperty(workspaceId: string, id: string, input: UpdatePropertyInput) {
  const supabase = getSupabaseBrowserClient()
  if (!supabase || !workspaceId || !id) return null
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (typeof input.title === 'string' && input.title.trim()) patch.title = input.title.trim()
  if (input.propertyType) patch.property_type = input.propertyType
  if (input.operationType) patch.operation_type = input.operationType
  if (input.status) patch.status = input.status
  if (input.city !== undefined) patch.city = input.city
  if (input.area !== undefined) patch.area = input.area
  if (input.price !== undefined) patch.price = input.price
  if (input.ownerName !== undefined) patch.owner_name = input.ownerName
  if (input.ownerPhone !== undefined) patch.owner_phone = input.ownerPhone
  if (input.clientId !== undefined) patch.client_id = input.clientId
  if (input.notes !== undefined) patch.notes = input.notes

  const { data, error } = await supabase
    .from('properties')
    .update(patch)
    .eq('id', id)
    .eq('workspace_id', workspaceId)
    .select('*')
    .single()
  if (error) {
    if (process.env.NODE_ENV === 'development') console.warn('[updateProperty]', error.message)
    return null
  }
  const row = data as PropertyRow
  await logActivity(supabase, {
    workspaceId,
    type: 'property_updated',
    title: `Propiedad editada: ${row.title}`,
    description: `${row.property_type ?? ''}${row.operation_type ? ` · ${row.operation_type}` : ''}${row.city ? ` · ${row.city}` : ''} · ${row.status}`,
    clientId: row.client_id,
    metadata: { property_id: row.id },
  })
  return row
}

// -----------------------------------------------------------------------------
// Client lookup — lightweight selector used by the edit drawers and the
// "Vincular cliente" CTA in Inbox. Returns just enough to render a picker.
// -----------------------------------------------------------------------------

export type ClientLite = {
  id: string
  name: string
  company: string | null
  email: string | null
  phone: string | null
}

export async function listClientsLite(workspaceId: string, opts?: { query?: string; limit?: number }) {
  const supabase = getSupabaseBrowserClient()
  if (!supabase || !workspaceId) return [] as ClientLite[]
  let q = supabase
    .from('clients')
    .select('id, name, company, email, phone')
    .eq('workspace_id', workspaceId)
    .order('updated_at', { ascending: false })
    .limit(opts?.limit ?? 50)
  if (opts?.query && opts.query.trim()) {
    const term = opts.query.trim().replace(/[%,]/g, '')
    q = q.or(`name.ilike.%${term}%,email.ilike.%${term}%,company.ilike.%${term}%`)
  }
  const { data, error } = await q
  if (error) {
    if (process.env.NODE_ENV === 'development') console.warn('[listClientsLite]', error.message)
    return [] as ClientLite[]
  }
  return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
    id: String(r.id ?? ''),
    name: String(r.name ?? ''),
    company: (r.company as string | null) ?? null,
    email: (r.email as string | null) ?? null,
    phone: (r.phone as string | null) ?? null,
  }))
}
