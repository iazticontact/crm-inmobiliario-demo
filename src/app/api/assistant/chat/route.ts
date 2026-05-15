// LEGACY — not used by NowLabs AI v2. The UI routes all real copilot queries to /api/assistant/v2.
// This route is kept for reference and may serve the Inbox Assistant or direct API consumers.
import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import type { SupabaseClient } from '@supabase/supabase-js'
import * as T from '@/lib/assistant-tools'
import { runAgent } from '@/lib/assistant-agent'

type Body = {
  workspaceId?: string
  conversationId?: string
  message?: string
  mode?: string
  lastReferencedClientId?: string
  lastReferencedClientName?: string
  lastResults?: Record<string, unknown>[]
}

type ChatResponse = {
  ok: boolean
  answer?: string
  referencedClientId?: string
  referencedClientName?: string
  preparedAction?: T.PreparedActionData
  referencedList?: Record<string, unknown>[]
  suggestedActions?: string[]
  debugSource?: string
  error?: string
}

function normalize(value: string) {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

const ORDINAL_ES = ['primero', 'segundo', 'tercero', 'cuarto', 'quinto', 'sexto', 'séptimo', 'octavo', 'noveno', 'décimo', 'undécimo', 'duodécimo']

function resolveOrdinalIndex(t: string, listLen: number): number {
  if (!listLen) return -1
  // Numeric: "el 5", "el número 5", "número 5", "cliente 5", "el 11"
  const numMatch = t.match(/\b(?:el|la|numero|cliente)\s+(\d{1,2})\b/)
  if (numMatch) {
    const n = parseInt(numMatch[1], 10)
    if (n >= 1 && n <= listLen) return n - 1
  }
  // Last
  if (/\b(el ultimo|el final|el ultimo de la lista)\b/.test(t)) return listLen - 1
  // Word ordinals 0-11
  if (/\b(el primero?|la primera?|numero uno|el uno)\b/.test(t)) return 0
  if (/\b(el segundo|la segunda|el dos)\b/.test(t)) return 1
  if (/\b(el tercero|el tercer|la tercera|el tres)\b/.test(t)) return 2
  if (/\b(el cuarto|la cuarta|el cuatro)\b/.test(t)) return 3
  if (/\b(el quinto|la quinta|el cinco)\b/.test(t)) return 4
  if (/\b(el sexto|la sexta|el seis)\b/.test(t)) return 5
  if (/\b(el septimo|la septima|el siete)\b/.test(t)) return 6
  if (/\b(el octavo|la octava|el ocho)\b/.test(t)) return 7
  if (/\b(el noveno|la novena|el nueve)\b/.test(t)) return 8
  if (/\b(el decimo|la decima|el diez)\b/.test(t)) return 9
  if (/\b(el undecimo|la undecima|onceavo|el once)\b/.test(t)) return listLen > 10 ? 10 : -1
  if (/\b(el duodecimo|la duodecima|doceavo|el doce)\b/.test(t)) return listLen > 11 ? 11 : -1
  return -1
}

function detectIntent(
  text: string,
  lastReferencedClientName?: string,
  lastReferencedClientId?: string,
  lastResults?: Record<string, unknown>[]
): string | null {
  const t = normalize(text)
  const hasRef = Boolean(lastReferencedClientName || lastReferencedClientId)
  const hasList = Boolean(lastResults?.length)

  // Ordinal references — resolve from last results list
  if (hasList) {
    const oi = resolveOrdinalIndex(t, lastResults?.length ?? 0)
    if (oi >= 0) return `ordinal:${oi}`
    // Out-of-bounds ordinal attempt (e.g. "el undécimo" when list has 8 items)
    if (/\b(primero?|segundo|tercero|cuarto|quinto|sexto|septimo|octavo|noveno|decimo|undecimo|duodecimo|ultimo|onceavo|doceavo)\b/.test(t) ||
        /\b(?:el|la|numero|cliente)\s+\d{1,2}\b/.test(t)) {
      return 'ordinal:oob'
    }
  }

  // Client-specific contextual queries
  if (/\b(sus datos|su correo|su email|su telefono|su empresa|todos sus datos|dame todos sus datos|pasame sus datos|dame su email|dame su telefono|dame su empresa|pasa sus datos)\b/.test(t)) {
    return hasRef ? 'client_data_card' : 'no_client_referenced'
  }
  if (/\b(informe del ultimo cliente|hazme un informe del ultimo)\b/.test(t)) return 'latest_client_report'
  if (/\b(informe de ese|informe de el|informe de este|resumen de ese|resumen de este|todos los datos|dame todo lo que tengas|hazme un informe)\b/.test(t)) {
    return hasRef ? 'client_report_referenced' : 'no_client_referenced'
  }
  if (/\b(ese cliente|este cliente)\b/.test(t)) return hasRef ? 'client_report_referenced' : 'no_client_referenced'
  if (/\b(primer cliente|primero que (tuvimos|entr[oó]|empez[oó])|cliente (mas|m[aá]s) antiguo|desde el (inicio|principio))\b/.test(t)) return 'oldest_client'
  if (/\b(ultimo|ultima) cliente\b/.test(t)) return 'latest_client'

  // Workspace overview
  if (/\b(cuantos clientes|numero de clientes|clientes tengo|total de clientes)\b/.test(t)) return 'workspace_summary'
  if (/\b(resume mi crm|resumen crm|estado crm|como va mi crm|situacion crm)\b/.test(t)) return 'workspace_summary'

  // Invoices
  if (/\b(facturas pendientes|pendientes de pago|cobros pendientes|facturas sin pagar|facturas abiertas)\b/.test(t)) return 'pending_invoices'
  if (/\b(facturas? vencidas?|facturas? atrasadas?|facturas? impagadas?|cobros? vencidos?|pagos? vencidos?)\b/.test(t)) return 'overdue_invoices'

  // Booking with hottest client — must be checked before upcoming_events
  if (
    /\b(prepar|agenda|crear?|reservar?|pon|programar?)\b/.test(t) &&
    /\b(cita|reunion)\b/.test(t) &&
    /\b(cliente (mas )?caliente|lead caliente|mas caliente|mayor (lead )?score|mayor puntuacion|mas prometedor|mejor lead)\b/.test(t)
  ) return 'booking_hottest'

  // Calendar — "cita con" removed (too broad; would catch booking phrases)
  if (/\b(citas proximas|proximas citas|agenda|calendario|reuniones proximas|que tengo manana|tengo algo|esta semana)\b/.test(t)) return 'upcoming_events'

  // Tasks
  if (/\b(tareas? pendientes?|que tareas? (tengo|hay)|mis tareas?|todas las tareas?|tareas? abiertas?)\b/.test(t)) return 'pending_tasks'

  // WhatsApp messages — checked before generic conversations
  if (/\b(mensajes? (de|por|desde|en) (whatsapp|wsp|wa)|mensajes? (entrantes?|recibidos?)|que (mensajes?|ha?n llegado)|(whatsapp|wsp) (mensajes?|recibidos?))\b/.test(t)) return 'whatsapp_messages'

  // Conversations
  if (/\b(conversaciones? (recientes?|ultimas?|abiertas?)|ultimas? conversaciones?)\b/.test(t)) return 'recent_conversations'

  // Client lists
  if (/\b(todos los clientes|lista(r)? (mis |los |todos )?clientes|muestrame (los |mis )?clientes|dame (los |mis )?clientes|que clientes (tengo|hay)|clientes (que tengo|registrados|en el crm)|ver (todos )?los clientes|lista de clientes|muestra (los |mis )?clientes)\b/.test(t)) return 'list_all_clients'
  if (/\b(clientes? calientes?|leads? calientes?|mas interesantes?|mas prometedores?|mayor (lead )?score|mayor puntuacion|mejores? leads?|top leads?|leads? con mayor|mejores? clientes?)\b/.test(t)) return 'hot_leads'
  if (/\b(clientes? activos?|que clientes? estan activos?)\b/.test(t)) return 'active_clients'
  if (/\b(clientes? (inactivos?|parados?|sin actividad)|que clientes? (no responden|estan parados?|estan inactivos?|han dejado))\b/.test(t)) return 'inactive_clients'
  if (/\bclientes? (de|del|por) (whatsapp|wa|instagram|email|correo|web|canal)\b/.test(t)) return 'clients_by_channel'
  if (/\b(lead score|puntuacion|score) (mayor|superior|encima|minimo|por encima) (de|al?)?\s*\d/.test(t)) return 'clients_by_lead_score'
  if (/\bcon (lead )?score (mayor|superior|de|minimo) \d/.test(t)) return 'clients_by_lead_score'
  if (/\b(ultimos?|recientes?|nuevos?) (clientes?|leads?)\b/.test(t) || /\bclientes? (nuevos?|recientes?|de esta semana|que entraron)\b/.test(t)) return 'recent_clients'

  // Analysis / plans
  if (/\b(resumen comercial|informe comercial|estado comercial|balance comercial|como va el negocio)\b/.test(t)) return 'commercial_summary'
  if (/\b(que (deberia|debo|tengo que) hacer (hoy|esta manana)|plan (del dia|de hoy|para hoy)|acciones de hoy|que hacer hoy|agenda de hoy|prioridades de hoy)\b/.test(t)) return 'daily_plan'
  if (/\b(oportunidades?(de (negocio|venta|ventas|cierre))?|que oportunidades? (tengo|hay))\b/.test(t)) return 'opportunities'
  if (/\b(quien (necesita|requiere) seguimiento|clientes? sin seguimiento|a quien (contactar|llamar|escribir)|quien contactar primero|seguimiento pendiente)\b/.test(t)) return 'needs_followup'
  if (/\b(informe (completo|del|del crm|general)|reporte (del crm|general|completo)|hazme un informe (del crm|completo|general))\b/.test(t)) return 'workspace_report'
  if (/\b(automatiz|flujo|workflow|n8n|automatica)\b/.test(t)) return 'automation_recommendations'
  if (/\b(proxima accion|siguiente accion|que hago|prioridad|siguiente paso|accion comercial|recomendaciones?)\b/.test(t)) return 'recommended_actions'

  // Fallback client search by name
  if (/\b(habla de|dime de|datos de|quien es|cuentame de|resume|informe de|busca|buscar|encuentra)\b/.test(t)) return 'search_clients'

  return null
}

function extractChannel(t: string): string {
  if (/whatsapp|wsp|\bwa\b/.test(t)) return 'whatsapp'
  if (/instagram|\big\b/.test(t)) return 'instagram'
  if (/email|correo|mail/.test(t)) return 'email'
  if (/\bweb\b/.test(t)) return 'web'
  return 'whatsapp'
}

function extractMinScore(t: string): number | undefined {
  const m = t.match(/(\d+)/)
  return m ? parseInt(m[1], 10) : undefined
}

function extractRecentLimit(message: string): number {
  const m = message.match(/\b(\d+)\s*(?:ultimos|recientes|nuevos)?\s*clientes?\b|\b(?:ultimos|recientes|nuevos)\s*(\d+)\s*clientes?\b/i)
  return m ? Math.min(parseInt(m[1] ?? m[2], 10), 20) : 5
}

function extractSearchQuery(message: string, t: string): string {
  const patterns = [
    /(?:busca|buscar|encuentra|habla de|dime de|datos de|quien es|resume|informe de)\s+(?:el cliente\s+|la cliente\s+)?(.+)/i,
    /(?:sobre|de)\s+([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+)*)/,
  ]
  for (const pattern of patterns) {
    const m = message.match(pattern)
    if (m?.[1]?.trim()) return m[1].trim()
  }
  return t.replace(/\b(busca|buscar|encuentra|habla de|dime de|datos de|quien es|cuentame de|resume|informe de|el cliente|la cliente)\b/g, '').trim() || message.trim()
}

// Creates a server Supabase client using the request cookies so the user's session is available.
async function buildServerSupabase(): Promise<SupabaseClient | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const key = (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim())
  if (!url || !key) return null
  const cookieStore = await cookies()
  return createServerClient(url, key, {
    cookies: {
      getAll() { return cookieStore.getAll() },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options))
        } catch {
          // Route handler may not always update cookies (e.g. during static rendering)
        }
      },
    },
  })
}

type WorkspaceAccessResult = { ok: true } | { ok: false; status: 401 | 403; error: string }

// Checks that the authenticated user owns the requested workspaceId.
async function validateWorkspaceAccess(supabase: SupabaseClient, workspaceId: string): Promise<WorkspaceAccessResult> {
  const { data: { user }, error: userError } = await supabase.auth.getUser()
  if (userError || !user) return { ok: false, status: 401, error: 'unauthorized' }

  const { data: profile } = await supabase
    .from('profiles')
    .select('workspace_id')
    .eq('id', user.id)
    .maybeSingle()

  if (!profile?.workspace_id || profile.workspace_id !== workspaceId) {
    return { ok: false, status: 403, error: 'forbidden' }
  }

  return { ok: true }
}

export async function POST(req: NextRequest): Promise<NextResponse<ChatResponse>> {
  try {
    const body = await req.json() as Body
    const { workspaceId, message, mode, lastReferencedClientId, lastReferencedClientName, lastResults } = body

    if (!workspaceId || !message?.trim()) {
      return NextResponse.json({ ok: false, error: 'workspaceId and message are required' }, { status: 400 })
    }

    // Only NowLabs AI (copilot) may access CRM tools — Inbox Assistant is blocked here
    if (mode && mode !== 'copilot' && mode !== 'nowlabs_ai') {
      return NextResponse.json({ ok: false, error: 'mode_not_supported' }, { status: 422 })
    }

    const supabase = await buildServerSupabase()
    if (!supabase) {
      return NextResponse.json({ ok: false, error: 'Supabase not configured' }, { status: 503 })
    }

    // Verify the authenticated user owns the requested workspace
    const access = await validateWorkspaceAccess(supabase, workspaceId)
    if (!access.ok) {
      return NextResponse.json({ ok: false, error: access.error }, { status: access.status })
    }

    console.log('[assistant/chat][ENTRY]', {
      mode,
      workspaceId,
      message,
      hasLastReferencedClientId: Boolean(lastReferencedClientId),
      lastReferencedClientName,
      lastResultsCount: Array.isArray(lastResults) ? lastResults.length : 0,
    })

    // -----------------------------------------------------------------------
    // RANKING GUARDRAIL — must run before the OpenAI agent (and before the
    // deterministic fallback) for every explicit ranking query.
    //
    // The LLM cannot be trusted to ignore lastReferencedClientId when the
    // user asks for "el más caliente" — it will pull the last mentioned client
    // from context. Only Supabase knows the real lead_score ordering.
    // -----------------------------------------------------------------------
    const tGuard = normalize(message)
    const hasRankingPhrase = /\b(mas caliente|mayor score|mejor lead|mas prometedor|mayor potencial|mas potencial|lead caliente|top leads?|mas fuerte|mayor puntuacion|mas score|oportunidad mas alta|mayor lead score|mejor cliente|cliente prioritario)\b/.test(tGuard)

    if (hasRankingPhrase) {
      const hotResult = await T.toolHotLeads(supabase, workspaceId)
      const hotList = (hotResult.referencedList ?? []) as Array<Record<string, unknown>>

      if (!hotList.length) {
        return NextResponse.json({
          ok: true,
          answer: 'Sin leads con score ≥ 70 ahora mismo. Dime un cliente en concreto y miro su situación.',
          debugSource: 'ranking_guardrail:empty',
        })
      }

      const top = hotList[0]
      const topName = String(top.name ?? '')
      const topId = String(top.id ?? '')
      const topScore = top.lead_score

      const wantsBooking = /\b(cita|reunion|reunión|booking|agendar|agenda|reservar|reserva|programar|quedamos?|pon |ponme|preparar? (una )?cita)\b/.test(tGuard)
      const wantsTask = /\b(tarea|seguimiento|recordatorio|llamar|contactar|escribirle?)\b/.test(tGuard)

      console.log('[assistant/chat][RANKING_RETURN]', {
        topName,
        topScore,
        wantsBooking,
        wantsTask,
        hotListLength: hotList.length,
        hotListPreview: hotList.slice(0, 3).map((c) => ({ name: c.name, lead_score: c.lead_score, status: c.status })),
      })

      if (wantsBooking) {
        const prepared = T.toolPrepareAction('booking', { clientId: topId, clientName: topName })
        const rankingContext = `🔥 **${topName}** es ahora mismo el cliente con más potencial del CRM, con score ${topScore}.`
        const bookingLine = prepared.preparedAction?.missingFields?.length
          ? `📅 Te dejo preparada una cita comercial con él. Solo me falta ${prepared.preparedAction.missingFields.join(' y ')} para cerrarla.`
          : `📅 Cita comercial con ${topName} lista para confirmar.`
        const answer = `${rankingContext}\n${bookingLine}`
        console.log(`[assistant/chat] source=ranking_guardrail action=booking target=${topName}`)
        return NextResponse.json({
          ok: true,
          answer,
          referencedClientId: topId,
          referencedClientName: topName,
          preparedAction: prepared.preparedAction,
          referencedList: hotList,
          debugSource: 'ranking_guardrail',
        })
      }

      if (wantsTask) {
        const prepared = T.toolPrepareTask({
          clientId: topId,
          clientName: topName,
          taskTitle: 'Seguimiento comercial',
          description: 'Seguimiento recomendado por NowLabs AI para cliente con alto potencial',
        })
        const taskLine = prepared.preparedAction?.missingFields?.length
          ? `✅ Te preparo una tarea de seguimiento para ${topName} — falta: ${prepared.preparedAction.missingFields.join(', ')}. Dímelos y la dejo lista.`
          : `✅ Tarea de seguimiento para ${topName} lista para confirmar.`
        const answer = `${taskLine}\nTiene score ${topScore}, así que yo lo priorizaría hoy antes que otros leads.`
        console.log(`[assistant/chat] source=ranking_guardrail action=task target=${topName}`)
        return NextResponse.json({
          ok: true,
          answer,
          referencedClientId: topId,
          referencedClientName: topName,
          preparedAction: prepared.preparedAction,
          referencedList: hotList,
          debugSource: 'ranking_guardrail',
        })
      }

      const runners = hotList.slice(1, 3).map((c) => `${String(c.name)} (${c.lead_score})`).join(', ')
      const base = `🔥 El cliente con más potencial ahora mismo es **${topName}** (score ${topScore})${runners ? `. Le siguen: ${runners}` : ''}.`
      console.log(`[assistant/chat] source=ranking_guardrail action=info target=${topName}`)
      return NextResponse.json({
        ok: true,
        answer: base,
        referencedClientId: topId,
        referencedClientName: topName,
        referencedList: hotList,
        debugSource: 'ranking_guardrail',
      })
    }
    // -----------------------------------------------------------------------

    // Try OpenAI Responses API agent first — falls back to deterministic router on error,
    // no key, or when OPENAI_AGENT_ENABLED=false.
    const agentEnabled = Boolean(process.env.OPENAI_API_KEY) && process.env.OPENAI_AGENT_ENABLED !== 'false'
    if (agentEnabled) {
      const agentResult = await runAgent(supabase, workspaceId, message, {
        lastReferencedClientId,
        lastReferencedClientName,
        lastResults,
      })
      if (agentResult.debugSource === 'openai_agent' && agentResult.answer) {
        console.log(`[assistant/chat] source=openai_agent`)
        return NextResponse.json({
          ok: true,
          answer: agentResult.answer,
          referencedClientId: agentResult.referencedClientId,
          referencedClientName: agentResult.referencedClientName,
          referencedList: agentResult.referencedList,
          preparedAction: agentResult.preparedAction,
          suggestedActions: agentResult.suggestedActions,
          debugSource: 'openai_agent',
        })
      }
      // Agent returned empty answer or fell back — log and continue to deterministic fallback
      if (agentResult.error && agentResult.error !== 'no_api_key' && agentResult.error !== 'agent_disabled') {
        console.warn(`[assistant/chat] agent_fallback reason=${agentResult.error}`)
      }
    }

    // Deterministic fallback router
    const t = normalize(message)
    const intent = detectIntent(message, lastReferencedClientName, lastReferencedClientId, lastResults)

    if (!intent) {
      console.log('[assistant/chat]', { debugSource: 'backend_no_intent', messageSnippet: message.slice(0, 50) })
      return NextResponse.json({ ok: false, error: 'no_intent' }, { status: 422 })
    }

    // Ordinal: out-of-bounds (asked for index beyond list length)
    if (intent === 'ordinal:oob') {
      const len = lastResults?.length ?? 0
      return NextResponse.json({ ok: true, answer: `Solo tengo ${len} resultado${len !== 1 ? 's' : ''} en la lista. Prueba con "el primero", "el último" o un número del 1 al ${len}.`, debugSource: 'ordinal:oob' })
    }

    // Ordinal: resolve from last results
    if (intent.startsWith('ordinal:')) {
      const idx = parseInt(intent.split(':')[1], 10)
      const list = lastResults ?? []
      const res = T.toolSelectByOrdinal(list, idx)
      if (!res.referencedClientId) {
        return NextResponse.json({ ok: true, answer: res.text, debugSource: 'ordinal:bounds' })
      }
      const item = list[idx] as Record<string, unknown>
      const ordinalName = ORDINAL_ES[idx] ?? `número ${idx + 1}`
      const name = String(item.name ?? 'Sin nombre')
      const co = item.company && String(item.company) !== 'No consta' ? `, de ${String(item.company)}` : ''
      const stRaw = String(item.status ?? '')
      const stText = stRaw ? `Está como ${stRaw}` : ''
      const chRaw = String(item.channel ?? '')
      const chText = chRaw ? `, viene por ${chRaw}` : ''
      const sc = item.lead_score !== undefined && item.lead_score !== null ? ` y tiene score ${item.lead_score}` : ''
      const sentence = `El ${ordinalName} cliente es ${name}${co}. ${stText}${chText}${sc}.`.replace(/\.\s*\./g, '.').trim()
      return NextResponse.json({
        ok: true,
        answer: sentence,
        referencedClientId: res.referencedClientId,
        referencedClientName: res.referencedClientName,
        debugSource: 'ordinal',
      })
    }

    if (intent === 'no_client_referenced') {
      return NextResponse.json({ ok: true, answer: 'No hay ningún cliente seleccionado. Dime el nombre y lo busco.', debugSource: 'no_ref' })
    }

    let result: T.ToolResult

    switch (intent) {
      case 'workspace_summary':
      case 'client_count':
      case 'commercial_summary':
        result = await T.toolCrmOverview(supabase, workspaceId)
        break

      case 'list_all_clients':
        result = await T.toolListClients(supabase, workspaceId)
        break

      case 'active_clients':
        result = await T.toolListClients(supabase, workspaceId, { status: 'active' })
        break

      case 'inactive_clients':
        result = await T.toolListClients(supabase, workspaceId, { status: 'inactive' })
        break

      case 'clients_by_channel':
        result = await T.toolListClients(supabase, workspaceId, { channel: extractChannel(t) })
        break

      case 'clients_by_lead_score': {
        const minScore = extractMinScore(t)
        result = await T.toolListClients(supabase, workspaceId, { minScore })
        break
      }

      case 'hot_leads':
      case 'opportunities':
        result = await T.toolHotLeads(supabase, workspaceId)
        break

      case 'recent_clients':
        result = await T.toolLatestClients(supabase, workspaceId, extractRecentLimit(message))
        break

      case 'latest_client': {
        const lr = await T.toolLatestClients(supabase, workspaceId, 1)
        const c = lr.referencedList?.[0]
        result = c ? { ...lr, referencedClientId: String(c.id), referencedClientName: String(c.name) } : lr
        break
      }

      case 'oldest_client': {
        const or = await T.toolOldestClient(supabase, workspaceId)
        result = or
        break
      }

      case 'booking_hottest': {
        const hotRes = await T.toolHotLeads(supabase, workspaceId)
        const hotList = (hotRes.referencedList ?? []) as Array<Record<string, unknown>>
        if (!hotList.length) {
          result = { text: 'Sin leads calientes ahora mismo. ¿Para qué cliente preparo la cita?', data: null }
          break
        }
        const topLead = hotList[0]
        const prepared = T.toolPrepareAction('booking', { clientId: String(topLead.id), clientName: String(topLead.name) })
        console.log('[assistant/chat]', { debugSource: 'backend_fallback:booking_hottest', messageSnippet: message.slice(0, 50), referencedClientName: String(topLead.name), hasPreparedAction: true, preparedActionType: 'booking' })
        return NextResponse.json({
          ok: true,
          answer: prepared.text,
          referencedClientId: String(topLead.id),
          referencedClientName: String(topLead.name),
          preparedAction: prepared.preparedAction,
          debugSource: 'backend_fallback:booking_hottest',
        })
      }

      case 'pending_invoices':
        result = await T.toolPendingInvoices(supabase, workspaceId)
        break

      case 'overdue_invoices':
        result = await T.toolOverdueInvoices(supabase, workspaceId)
        break

      case 'upcoming_events':
        result = await T.toolUpcomingEvents(supabase, workspaceId)
        break

      case 'pending_tasks':
        result = await T.toolPendingTasks(supabase, workspaceId)
        break

      case 'whatsapp_messages':
        result = await T.toolRecentMessages(supabase, workspaceId, 'whatsapp')
        break

      case 'recent_conversations':
        result = await T.toolRecentConversations(supabase, workspaceId)
        break

      case 'recommended_actions':
      case 'daily_plan':
        result = await T.toolRecommendedActions(supabase, workspaceId)
        break

      case 'workspace_report': {
        const [overview, actions] = await Promise.all([
          T.toolCrmOverview(supabase, workspaceId),
          T.toolRecommendedActions(supabase, workspaceId),
        ])
        result = {
          text: [
            `📊 Informe CRM — ${new Date().toLocaleDateString('es-ES', { year: 'numeric', month: 'long', day: 'numeric' })}`,
            `\n**Resumen**\n${overview.text}`,
            `\n**Acciones prioritarias**\n${actions.text}`,
          ].join('\n'),
          data: { overview: overview.data, actions: actions.data },
        }
        break
      }

      case 'automation_recommendations':
        result = await T.toolAutomationRecommendations(supabase, workspaceId)
        break

      case 'needs_followup': {
        const [hot, inv] = await Promise.all([
          T.toolHotLeads(supabase, workspaceId),
          T.toolOverdueInvoices(supabase, workspaceId),
        ])
        const lines: string[] = []
        if (hot.referencedList?.length) {
          lines.push(`Leads calientes sin cerrar (${hot.referencedList.length}): ${hot.referencedList.slice(0, 3).map((c) => String(c.name)).join(', ')}`)
        }
        const overdueArr = Array.isArray(inv.data) ? inv.data : []
        if (overdueArr.length) lines.push(`Facturas vencidas: ${overdueArr.length} pendiente(s) de cobro`)
        result = {
          text: lines.length ? `Pendiente de acción:\n${lines.join('\n')}` : 'Sin seguimientos urgentes ahora mismo. Todo controlado.',
          data: { hot: hot.data, overdue: inv.data },
        }
        break
      }

      case 'client_report_referenced':
      case 'client_data_card':
        result = await T.toolGetClientContext(supabase, workspaceId, lastReferencedClientId, lastReferencedClientName)
        break

      case 'latest_client_report': {
        const lr2 = await T.toolLatestClients(supabase, workspaceId, 1)
        const lc = lr2.referencedList?.[0]
        result = lc ? await T.toolGetClientContext(supabase, workspaceId, String(lc.id)) : { text: 'No hay clientes registrados todavía.', data: null }
        break
      }

      case 'search_clients': {
        const q = extractSearchQuery(message, t)
        result = await T.toolSearchClients(supabase, workspaceId, q)
        break
      }

      default:
        return NextResponse.json({ ok: false, error: 'no_intent' }, { status: 422 })
    }

    console.log('[assistant/chat]', { debugSource: `backend_fallback:${intent}`, messageSnippet: message.slice(0, 50), referencedClientName: result.referencedClientName, hasPreparedAction: false })
    return NextResponse.json({
      ok: true,
      answer: result.text,
      referencedClientId: result.referencedClientId,
      referencedClientName: result.referencedClientName,
      referencedList: result.referencedList,
      debugSource: `backend_fallback:${intent}`,
    })
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error'
    console.error('[assistant/chat]', { debugSource: 'backend_error', error: msg.slice(0, 100) })
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
