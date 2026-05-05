'use client'

import { useState, useEffect, useRef } from 'react'
import { Send, Phone, Mail, Bot, MessageSquare, Target, ArrowRight, Search, CheckCircle, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/Badge'
import { Button } from '@/components/Button'
import { cn } from '@/lib/utils'
import { conversations, messages as mockMessages } from '@/lib/mock-data'
import { triggerN8nWebhook } from '@/lib/integrations'
import type { ConversationSentiment, Channel, Message } from '@/lib/types'

const sentimentConfig: Record<ConversationSentiment, { label: string; variant: 'success' | 'warning' | 'danger' }> = {
  positive: { label: 'Positivo', variant: 'success' },
  neutral: { label: 'Neutral', variant: 'warning' },
  negative: { label: 'Negativo', variant: 'danger' },
}

const channelVariant: Record<Channel, 'indigo' | 'purple' | 'info' | 'success'> = {
  WhatsApp: 'success', Instagram: 'purple', Web: 'info', Email: 'indigo',
}

const leadScores: Record<string, number> = { '1': 92, '2': 74, '3': 88, '4': 96, '5': 61 }

const leadScoreColor = (score: number) =>
  score >= 80 ? 'text-emerald-600' : score >= 60 ? 'text-amber-600' : 'text-red-500'

function generateAIResponse(msg: string): string {
  const l = msg.toLowerCase()
  if (l.includes('€') || l.includes('cobr') || l.includes('pagad') || l.includes('factura')) {
    return '✅ He registrado el cobro en el sistema. La factura ha sido actualizada y se ha enviado confirmación al cliente automáticamente.'
  }
  if (l.includes('cita') || l.includes('llamada') || l.includes('reuni') || l.includes('agenda')) {
    return '📅 Perfecto, he añadido la cita al calendario y enviado el enlace de videoconferencia al cliente. ¿Quieres que prepare una agenda previa?'
  }
  if (l.includes('propuesta') || l.includes('precio') || l.includes('plan') || l.includes('presupuesto')) {
    return '📄 He generado una propuesta comercial personalizada basada en el historial del cliente. ¿La envío directamente por email o WhatsApp?'
  }
  if (l.includes('problema') || l.includes('error') || l.includes('queja') || l.includes('incidencia')) {
    return '🔍 Entendido. He escalado la incidencia y creado un ticket de soporte prioritario. El equipo recibirá una alerta inmediatamente.'
  }
  if (l.includes('gracias') || l.includes('ok') || l.includes('perfecto') || l.includes('genial')) {
    return '✨ ¡Con mucho gusto! Estoy disponible 24/7. ¿Hay algo más en lo que pueda ayudarte?'
  }
  return '🤖 Entendido. He analizado tu mensaje y lo registré en el sistema. Basándome en el historial del cliente, te recomendaría un seguimiento en las próximas 24 horas. ¿Programo un recordatorio automático?'
}

export default function AssistantPage() {
  const [selectedId, setSelectedId] = useState<string>('1')
  const [input, setInput] = useState('')
  const [isTyping, setIsTyping] = useState(false)
  const [localMessages, setLocalMessages] = useState<Record<string, Message[]>>(mockMessages)
  const [convSearch, setConvSearch] = useState('')
  const chatEndRef = useRef<HTMLDivElement>(null)

  const selected = conversations.find((c) => c.id === selectedId)!
  const msgs = localMessages[selectedId] ?? []

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [msgs, isTyping])

  const sendMessage = async () => {
    if (!input.trim()) return
    const content = input.trim()
    const now = new Date().toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })

    const userMsg: Message = {
      id: `agent-${Date.now()}`,
      conversationId: selectedId,
      content,
      sender: 'agent',
      timestamp: now,
    }

    setLocalMessages((prev) => ({ ...prev, [selectedId]: [...(prev[selectedId] ?? []), userMsg] }))
    setInput('')
    setIsTyping(true)

    const hasPayment = content.includes('€') || content.toLowerCase().includes('cobr') || content.toLowerCase().includes('pagad')
    const hasAppointment = content.toLowerCase().includes('cita') || content.toLowerCase().includes('llamada') || content.toLowerCase().includes('reuni')

    if (hasPayment) {
      await triggerN8nWebhook('payment_registered', { message: content, client: selected.clientName })
      toast.success('Facturación actualizada', { description: 'El cobro ha sido registrado en el sistema.' })
    }
    if (hasAppointment) {
      await triggerN8nWebhook('appointment_scheduled', { message: content, client: selected.clientName })
      toast.success('Cita agendada', { description: `Evento añadido al calendario para ${selected.clientName}.` })
    }

    setTimeout(() => {
      const aiMsg: Message = {
        id: `ai-${Date.now()}`,
        conversationId: selectedId,
        content: generateAIResponse(content),
        sender: 'ai',
        timestamp: new Date().toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' }),
      }
      setLocalMessages((prev) => ({ ...prev, [selectedId]: [...(prev[selectedId] ?? []), aiMsg] }))
      setIsTyping(false)
    }, 1500)
  }

  const handleQuickAction = async (action: string) => {
    const responses: Record<string, string> = {
      'Generar propuesta': '📄 Propuesta comercial generada y lista para enviar. Incluye pricing personalizado basado en el historial del cliente.',
      'Agendar llamada': '📅 Llamada agendada para mañana a las 10:00. Se ha enviado el enlace de reunión al cliente.',
      'Enviar pricing': '💰 Tabla de precios enviada al cliente por su canal preferido. Te notificaré cuando la abra.',
    }
    const now = new Date().toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })
    const aiMsg: Message = { id: `ai-${Date.now()}`, conversationId: selectedId, content: responses[action] ?? 'Acción ejecutada.', sender: 'ai', timestamp: now }
    setLocalMessages((prev) => ({ ...prev, [selectedId]: [...(prev[selectedId] ?? []), aiMsg] }))
    if (action === 'Agendar llamada') await triggerN8nWebhook('appointment_scheduled', { action, client: selected.clientName })
    toast.success(`IA: ${action}`, { description: 'Procesado correctamente.' })
  }

  const filteredConvs = conversations.filter((c) => !convSearch || c.clientName.toLowerCase().includes(convSearch.toLowerCase()))
  const score = leadScores[selectedId] ?? 70

  return (
    <div className="flex gap-0 rounded-xl overflow-hidden border border-gray-100 shadow-sm bg-white" style={{ height: 'calc(100vh - 7rem)' }}>
      {/* Conversation list */}
      <aside className="flex w-72 shrink-0 flex-col border-r border-gray-100">
        <div className="border-b border-gray-100 p-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400 pointer-events-none" />
            <input type="text" value={convSearch} onChange={(e) => setConvSearch(e.target.value)} placeholder="Buscar conversación..." className="h-8 w-full rounded-lg border border-gray-200 bg-gray-50 pl-8 pr-3 text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent" />
          </div>
        </div>
        <ul className="flex-1 overflow-y-auto">
          {filteredConvs.map((conv) => {
            const isActive = conv.id === selectedId
            return (
              <li key={conv.id}>
                <button onClick={() => setSelectedId(conv.id)} className={cn('flex w-full items-start gap-3 border-b border-gray-50 p-3.5 text-left transition-colors', isActive ? 'bg-indigo-50' : 'hover:bg-gray-50')}>
                  <div className="relative shrink-0">
                    <div className={cn('flex h-9 w-9 items-center justify-center rounded-full text-xs font-bold text-white', isActive ? 'bg-indigo-600' : 'bg-gray-300 text-gray-600')}>
                      {conv.clientAvatar}
                    </div>
                    {conv.unread && <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-indigo-500 border-2 border-white" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-1">
                      <span className={cn('text-xs font-semibold truncate', isActive ? 'text-indigo-700' : 'text-gray-900')}>{conv.clientName}</span>
                      <span className="shrink-0 text-[10px] text-gray-400">{conv.timestamp}</span>
                    </div>
                    <p className="mt-0.5 truncate text-[11px] text-gray-500">{conv.lastMessage}</p>
                    <div className="mt-1 flex items-center gap-1">
                      <Badge variant={channelVariant[conv.channel]} className="text-[10px] px-1.5 py-0">{conv.channel}</Badge>
                      <Badge variant={sentimentConfig[conv.sentiment].variant} className="text-[10px] px-1.5 py-0">{sentimentConfig[conv.sentiment].label}</Badge>
                    </div>
                  </div>
                </button>
              </li>
            )
          })}
        </ul>
      </aside>

      {/* Chat */}
      <div className="flex flex-1 flex-col min-w-0">
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-100 text-xs font-bold text-indigo-700">{selected.clientAvatar}</div>
            <div>
              <p className="text-sm font-semibold text-gray-900">{selected.clientName}</p>
              <div className="flex items-center gap-1.5 mt-0.5">
                <Badge variant={channelVariant[selected.channel]} className="text-[10px]">{selected.channel}</Badge>
                {selected.intent && <span className="text-[10px] text-gray-400">· {selected.intent}</span>}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" onClick={() => { handleQuickAction('Agendar llamada') }}><Phone className="h-3.5 w-3.5" /></Button>
            <Button variant="ghost" size="sm" onClick={() => { handleQuickAction('Enviar pricing') }}><Mail className="h-3.5 w-3.5" /></Button>
            <Button variant="secondary" size="sm" onClick={() => toast.success('Conversación resuelta', { description: 'Marcada como resuelta en el sistema.' })}>
              <CheckCircle className="h-3.5 w-3.5" />
              Resolver
            </Button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {msgs.map((msg) => {
            const isClient = msg.sender === 'client'
            const isAI = msg.sender === 'ai'
            return (
              <div key={msg.id} className={cn('flex', isClient ? 'justify-start' : 'justify-end')}>
                <div className="max-w-xs lg:max-w-md">
                  {isAI && <div className="flex items-center gap-1 mb-1"><Bot className="h-3 w-3 text-indigo-500" /><span className="text-[10px] font-medium text-indigo-500">IA responde</span></div>}
                  <div className={cn('rounded-2xl px-4 py-2.5 text-sm', isClient ? 'bg-gray-100 text-gray-800 rounded-tl-sm' : isAI ? 'bg-indigo-600 text-white rounded-tr-sm' : 'bg-slate-700 text-white rounded-tr-sm')}>
                    {msg.content}
                  </div>
                  <p className={cn('mt-1 text-[10px] text-gray-400', isClient ? 'text-left' : 'text-right')}>{msg.timestamp}</p>
                </div>
              </div>
            )
          })}
          {isTyping && (
            <div className="flex justify-end">
              <div className="rounded-2xl rounded-tr-sm bg-indigo-100 px-4 py-2.5 flex items-center gap-1.5">
                <Loader2 className="h-3.5 w-3.5 text-indigo-500 animate-spin" />
                <span className="text-xs text-indigo-600">IA respondiendo...</span>
              </div>
            </div>
          )}
          <div ref={chatEndRef} />
        </div>

        <div className="border-t border-gray-100 p-4">
          <div className="flex items-end gap-2">
            <textarea value={input} onChange={(e) => setInput(e.target.value)} placeholder="Escribe un mensaje o usa / para comandos IA..." rows={1} className="flex-1 resize-none rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent focus:bg-white transition-all"
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() } }} />
            <Button size="sm" className="h-10 w-10 p-0 shrink-0" onClick={sendMessage} disabled={isTyping || !input.trim()}>
              <Send className="h-4 w-4" />
            </Button>
          </div>
          <div className="mt-2 flex items-center gap-2">
            <span className="text-[10px] text-gray-400">Acciones rápidas:</span>
            {['Generar propuesta', 'Agendar llamada', 'Enviar pricing'].map((action) => (
              <button key={action} onClick={() => handleQuickAction(action)} className="text-[10px] font-medium text-indigo-600 hover:text-indigo-700 border border-indigo-100 rounded-full px-2 py-0.5 bg-indigo-50 hover:bg-indigo-100 transition-colors">
                {action}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* AI Analysis panel */}
      <aside className="w-64 shrink-0 border-l border-gray-100 overflow-y-auto">
        <div className="border-b border-gray-100 px-4 py-3.5">
          <div className="flex items-center gap-2"><Bot className="h-4 w-4 text-indigo-600" /><h3 className="text-sm font-semibold text-gray-900">Análisis IA</h3></div>
        </div>
        <div className="p-4 space-y-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-indigo-100 text-sm font-bold text-indigo-700">{selected.clientAvatar}</div>
            <div><p className="text-sm font-semibold text-gray-900">{selected.clientName}</p><p className="text-[10px] text-gray-400">{selected.channel}</p></div>
          </div>

          <div className="rounded-xl bg-gray-50 p-3.5">
            <div className="flex items-center justify-between mb-2"><span className="text-xs font-medium text-gray-600">Lead Score</span><Target className="h-3.5 w-3.5 text-gray-400" /></div>
            <div className="flex items-end gap-1">
              <span className={cn('text-2xl font-bold', leadScoreColor(score))}>{score}</span>
              <span className="text-xs text-gray-400 mb-0.5">/100</span>
            </div>
            <div className="mt-2 h-1.5 w-full rounded-full bg-gray-200 overflow-hidden">
              <div className={cn('h-full rounded-full', score >= 80 ? 'bg-emerald-500' : score >= 60 ? 'bg-amber-500' : 'bg-red-500')} style={{ width: `${score}%` }} />
            </div>
          </div>

          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 mb-2">Sentimiento</p>
            <Badge variant={sentimentConfig[selected.sentiment].variant} dot className="text-xs">{sentimentConfig[selected.sentiment].label}</Badge>
          </div>

          {selected.intent && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 mb-2">Intención detectada</p>
              <div className="rounded-lg bg-blue-50 px-3 py-2"><span className="text-xs font-medium text-blue-700">{selected.intent}</span></div>
            </div>
          )}

          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 mb-2">Recomendación IA</p>
            <div className="rounded-xl border border-indigo-100 bg-indigo-50 p-3">
              <p className="text-xs text-indigo-800 leading-relaxed">
                {selected.sentiment === 'positive' ? 'Cliente con alta probabilidad de conversión. Propón una demo del plan Enterprise esta semana.' : selected.sentiment === 'negative' ? 'Urgente: cliente con fricción. Escala a soporte senior y ofrece compensación.' : 'Envía el dossier de precios y programa seguimiento en 48h para aumentar el engagement.'}
              </p>
              <button className="mt-2 flex items-center gap-1 text-[11px] font-semibold text-indigo-600 hover:text-indigo-700" onClick={() => toast.success('Recomendación aplicada', { description: 'El asistente IA lo procesará automáticamente.' })}>
                Aplicar <ArrowRight className="h-3 w-3" />
              </button>
            </div>
          </div>

          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 mb-2">Acciones rápidas</p>
            <div className="space-y-1.5">
              {[
                { label: 'Activar secuencia email', icon: <Mail className="h-3.5 w-3.5" /> },
                { label: 'Agendar llamada', icon: <Phone className="h-3.5 w-3.5" /> },
                { label: 'Abrir en Clientes', icon: <MessageSquare className="h-3.5 w-3.5" /> },
              ].map(({ label, icon }) => (
                <button key={label} onClick={() => { if (label === 'Activar secuencia email') handleQuickAction('Enviar pricing'); else if (label === 'Agendar llamada') handleQuickAction('Agendar llamada'); else toast.info(label); }}
                  className="flex w-full items-center gap-2.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50 hover:border-indigo-200 transition-colors">
                  <span className="text-indigo-500">{icon}</span>{label}
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-3">
            <p className="text-[10px] font-semibold text-emerald-700 mb-1">WhatsApp Business</p>
            <div className="flex items-center gap-1.5"><div className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" /><span className="text-[10px] text-emerald-700">Conectado · +34 612 345 678</span></div>
            <p className="text-[10px] text-emerald-600 mt-1">Última sync: hace 2 min</p>
          </div>
        </div>
      </aside>
    </div>
  )
}
