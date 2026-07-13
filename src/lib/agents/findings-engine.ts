// Motor de FINDINGS (P67) — inteligencia proactiva basada en HECHOS. Reglas objetivas con criterio
// explícito; NUNCA modifica datos: detecta y registra (dedupe por fingerprint). Server-side only.

import type { SupabaseClient } from '@supabase/supabase-js'
import { todayMadridIso, isOverdueTask } from '@/lib/assistant-temporal'

type Row = Record<string, unknown>
export type Finding = {
  finding_type: string
  entity_type: string | null
  entity_id: string | null
  fingerprint: string
  title: string
  summary: string
  severity: 'info' | 'warning' | 'critical'
}

// Ejecuta la auditoría de calidad de datos y devuelve los findings detectados (sin escribirlos).
export async function detectFindings(supabase: SupabaseClient, ws: string): Promise<Finding[]> {
  const out: Finding[] = []
  const today = todayMadridIso()
  const [propsQ, opsQ, tasksQ] = await Promise.all([
    supabase.from('properties').select('id, title, status, price, operation_type').eq('workspace_id', ws).is('deleted_at', null),
    supabase.from('opportunities').select('id, title, stage, client_id, property_id').eq('workspace_id', ws).is('deleted_at', null),
    supabase.from('tasks').select('id, title, status, due_date').eq('workspace_id', ws),
  ])
  const props = (propsQ.data ?? []) as Row[]
  const ops = (opsQ.data ?? []) as Row[]
  const tasks = (tasksQ.data ?? []) as Row[]

  const wonPropIds = new Set(ops.filter((o) => o.stage === 'won' && o.property_id).map((o) => String(o.property_id)))
  // 1) Inmueble vendido sin operación ganada vinculada.
  for (const p of props.filter((p) => p.status === 'sold' && !wonPropIds.has(String(p.id)))) {
    out.push({ finding_type: 'sold_property_without_won_operation', entity_type: 'property', entity_id: String(p.id), fingerprint: `spwwo:${p.id}`, title: `Inmueble vendido sin operación ganada: ${p.title}`, summary: 'El inmueble está en estado Vendido pero ninguna operación ganada lo tiene vinculado. Criterio: status=sold sin opportunity stage=won con property_id.', severity: 'warning' })
  }
  // 2) Operación ganada sin inmueble en estado vendido/alquilado.
  const propById = new Map(props.map((p) => [String(p.id), p]))
  for (const o of ops.filter((o) => o.stage === 'won')) {
    const p = o.property_id ? propById.get(String(o.property_id)) : null
    if (o.property_id && p && p.status !== 'sold' && p.status !== 'rented') {
      out.push({ finding_type: 'won_operation_without_sold_property', entity_type: 'opportunity', entity_id: String(o.id), fingerprint: `wowsp:${o.id}`, title: `Operación ganada con inmueble no cerrado: ${o.title}`, summary: `La operación está ganada pero su inmueble (${p.title}) está en estado ${p.status}. Criterio: stage=won con property.status ∉ {sold, rented}.`, severity: 'warning' })
    }
    if (!o.client_id) {
      out.push({ finding_type: 'operation_without_client', entity_type: 'opportunity', entity_id: String(o.id), fingerprint: `owc:${o.id}`, title: `Operación sin cliente: ${o.title}`, summary: 'La operación no tiene cliente vinculado. Criterio: client_id nulo.', severity: 'info' })
    }
  }
  // 3) Inmueble publicado sin precio.
  for (const p of props.filter((p) => (p.status === 'listed' || p.status === 'available') && !(Number(p.price) > 0))) {
    out.push({ finding_type: 'property_missing_price', entity_type: 'property', entity_id: String(p.id), fingerprint: `pmp:${p.id}`, title: `Publicado sin precio: ${p.title}`, summary: 'El inmueble está publicado pero no tiene precio. Criterio: status publicado con price nulo o 0.', severity: 'critical' })
  }
  // 4) Tareas vencidas (pendientes con fecha pasada) — una por tarea+fecha (fingerprint estable).
  for (const t of tasks.filter((t) => isOverdueTask(t.due_date as string | null, t.status as string | null, today))) {
    out.push({ finding_type: 'task_overdue', entity_type: 'task', entity_id: String(t.id), fingerprint: `tov:${t.id}:${t.due_date}`, title: `Tarea vencida: ${t.title}`, summary: `Pendiente con fecha límite ${t.due_date} anterior a hoy. Criterio: status=pending + due_date < hoy (Europe/Madrid).`, severity: 'warning' })
  }
  return out
}

// Persiste con DEDUPE por fingerprint (upsert ignorando duplicados). Devuelve nuevos vs existentes.
export async function persistFindings(supabase: SupabaseClient, ws: string, findings: Finding[]): Promise<{ created: number; duplicates: number }> {
  let created = 0, duplicates = 0
  for (const f of findings) {
    const { error } = await supabase.from('assistant_findings').insert({ workspace_id: ws, ...f })
    if (!error) created++
    else if (String((error as { code?: string }).code) === '23505') duplicates++
  }
  return { created, duplicates }
}
