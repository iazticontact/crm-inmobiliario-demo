import { getSupabaseBrowserClient } from '@/lib/supabase'
import type { Channel, Client, ClientStatus } from '@/lib/types'

export type ProfileRecord = {
  id: string
  user_id?: string | null
  workspace_id?: string | null
  full_name?: string | null
  email?: string | null
  role?: string | null
  trial_status?: string | null
}

export type WorkspaceRecord = {
  id: string
  owner_id?: string | null
  name?: string | null
  trial_status?: string | null
  plan?: string | null
  status?: string | null
}

export type ClientPayload = {
  name: string
  company?: string
  email: string
  phone?: string
  channel: Channel
  status: ClientStatus
  leadScore?: number
  notes?: string
}

type RecordValue = string | number | boolean | null | undefined
type DataRecord = Record<string, RecordValue>

function asString(value: unknown, fallback = '') {
  return typeof value === 'string' && value.trim() ? value : fallback
}

function asNumber(value: unknown, fallback = 0) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function getInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase()
  return name.trim().slice(0, 2).toUpperCase() || 'C'
}

function normalizeChannel(value: unknown): Channel {
  if (value === 'WhatsApp' || value === 'Instagram' || value === 'Web' || value === 'Email') return value
  return 'WhatsApp'
}

function normalizeStatus(value: unknown): ClientStatus {
  if (value === 'active' || value === 'lead' || value === 'inactive' || value === 'churned') return value
  return 'lead'
}

export async function getCurrentUser() {
  const supabase = getSupabaseBrowserClient()
  if (!supabase) return null
  const { data, error } = await supabase.auth.getUser()
  if (error) throw error
  return data.user
}

export async function getCurrentProfile(userId?: string) {
  const user = userId ? null : await getCurrentUser()
  const id = userId ?? user?.id
  if (!id) return null

  const supabase = getSupabaseBrowserClient()
  if (!supabase) return null

  const byId = await supabase
    .from('profiles')
    .select('*')
    .eq('id', id)
    .maybeSingle()

  if (byId.data) return byId.data as ProfileRecord

  const byUserId = await supabase
    .from('profiles')
    .select('*')
    .eq('user_id', id)
    .maybeSingle()

  if (byUserId.data) return byUserId.data as ProfileRecord
  if (byId.error && byUserId.error) throw byId.error
  return null
}

export async function getCurrentWorkspace(profile?: ProfileRecord | null, ownerId?: string) {
  const resolvedProfile = profile ?? (await getCurrentProfile())
  const workspaceId = resolvedProfile?.workspace_id

  const supabase = getSupabaseBrowserClient()
  if (!supabase) return null

  if (workspaceId) {
    const { data, error } = await supabase
      .from('workspaces')
      .select('*')
      .eq('id', workspaceId)
      .maybeSingle()

    if (error) throw error
    if (data) return data as WorkspaceRecord
  }

  if (!ownerId) return null

  const { data, error } = await supabase
    .from('workspaces')
    .select('*')
    .eq('owner_id', ownerId)
    .maybeSingle()

  if (error) throw error
  return data as WorkspaceRecord | null
}

export async function getWorkspaceContext() {
  const user = await getCurrentUser()
  if (!user) return null
  const profile = await getCurrentProfile(user.id)
  const workspace = await getCurrentWorkspace(profile, user.id)
  return { user, profile, workspace }
}

export function mapSupabaseClient(row: DataRecord): Client {
  const name = asString(row.name, 'Cliente')
  return {
    id: asString(row.id),
    name,
    company: asString(row.company, 'Sin empresa'),
    email: asString(row.email),
    phone: asString(row.phone, '-'),
    channel: normalizeChannel(row.channel),
    status: normalizeStatus(row.status),
    leadScore: asNumber(row.lead_score, 50),
    lastInteraction: asString(row.last_interaction, 'Ahora mismo'),
    avatar: asString(row.avatar, getInitials(name)),
    notes: asString(row.notes),
  }
}

function toClientRow(workspaceId: string, payload: ClientPayload): DataRecord {
  return {
    workspace_id: workspaceId,
    name: payload.name.trim(),
    company: payload.company?.trim() || null,
    email: payload.email.trim(),
    phone: payload.phone?.trim() || null,
    channel: payload.channel,
    status: payload.status,
    lead_score: payload.leadScore ?? 50,
    notes: payload.notes?.trim() || null,
    last_interaction: 'Ahora mismo',
  }
}

export async function getClients(workspaceId: string) {
  const supabase = getSupabaseBrowserClient()
  if (!supabase) return []

  const { data, error } = await supabase
    .from('clients')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false })

  if (error) throw error
  return ((data as DataRecord[] | null) ?? []).map(mapSupabaseClient)
}

export async function createClientLead(workspaceId: string, payload: ClientPayload) {
  const supabase = getSupabaseBrowserClient()
  if (!supabase) throw new Error('Supabase no esta configurado')

  const { data, error } = await supabase
    .from('clients')
    .insert(toClientRow(workspaceId, payload))
    .select('*')
    .single()

  if (error) throw error
  return mapSupabaseClient(data as DataRecord)
}

export async function updateClient(id: string, payload: ClientPayload) {
  const supabase = getSupabaseBrowserClient()
  if (!supabase) throw new Error('Supabase no esta configurado')

  const row = toClientRow('', payload)
  delete row.workspace_id
  const { data, error } = await supabase
    .from('clients')
    .update(row)
    .eq('id', id)
    .select('*')
    .single()

  if (error) throw error
  return mapSupabaseClient(data as DataRecord)
}

export async function deleteClient(id: string) {
  const supabase = getSupabaseBrowserClient()
  if (!supabase) throw new Error('Supabase no esta configurado')

  const { error } = await supabase
    .from('clients')
    .delete()
    .eq('id', id)

  if (error) throw error
}
