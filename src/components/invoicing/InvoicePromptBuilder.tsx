'use client'

// Generador de factura por TEXTO/AUDIO (P36A) — vive en el MÓDULO Facturación, NO en el Asistente IA
// general. Parser local determinista (invoice-parse). El audio usa la Web Speech API del navegador
// (sin subir audio, sin terceros, sin dependencias, SSR-safe). Nunca emite: produce una propuesta que el
// usuario revisa/edita y luego guarda como borrador.

import { useRef, useState } from 'react'
import { Sparkles, Mic, MicOff, Wand2 } from 'lucide-react'
import { toast } from 'sonner'
import { parseInvoiceText, type InvoiceParseResult } from '@/lib/invoicing/invoice-parse'
import type { ClientLite } from '@/lib/invoicing/invoice-repo'
import { cn } from '@/lib/utils'

// Tipado mínimo de la Web Speech API (sin dependencia).
type SpeechRec = {
  lang: string; continuous: boolean; interimResults: boolean
  start: () => void; stop: () => void
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null
  onerror: (() => void) | null
  onend: (() => void) | null
}
type SpeechRecCtor = new () => SpeechRec

function getSpeechCtor(): SpeechRecCtor | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as { SpeechRecognition?: SpeechRecCtor; webkitSpeechRecognition?: SpeechRecCtor }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

export function InvoicePromptBuilder({ clients, onGenerate }: {
  clients: ClientLite[]
  onGenerate: (result: InvoiceParseResult) => void
}) {
  const [text, setText] = useState('')
  const [listening, setListening] = useState(false)
  const recRef = useRef<SpeechRec | null>(null)
  const baseRef = useRef('')
  const speechAvailable = getSpeechCtor() !== null

  function toggleMic() {
    const Ctor = getSpeechCtor()
    if (!Ctor) { toast.info('El dictado no está disponible en este navegador.', { description: 'Puedes escribir o pegar el texto.' }); return }
    if (listening) { recRef.current?.stop(); return }
    const rec = new Ctor()
    rec.lang = 'es-ES'; rec.continuous = false; rec.interimResults = true
    baseRef.current = text ? `${text} ` : ''
    rec.onresult = (e) => {
      let t = ''
      for (let i = 0; i < e.results.length; i++) t += e.results[i][0]?.transcript ?? ''
      setText(baseRef.current + t)
    }
    rec.onerror = () => setListening(false)
    rec.onend = () => setListening(false)
    recRef.current = rec
    setListening(true)
    try { rec.start() } catch { setListening(false) }
  }

  function generate() {
    if (!text.trim()) { toast.info('Escribe o dicta una descripción de la factura.'); return }
    onGenerate(parseInvoiceText(text, clients))
  }

  return (
    <div className="rounded-2xl border border-indigo-100 bg-gradient-to-br from-indigo-50/70 to-white p-4 shadow-sm">
      <div className="mb-2.5 flex items-start gap-2.5">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-indigo-600 text-white"><Sparkles className="h-4 w-4" /></span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-gray-900">Crear con texto o audio</p>
          <p className="text-[11px] leading-4 text-gray-500">Describe la factura; la revisas y editas antes de emitir. No se emite nada automáticamente.</p>
        </div>
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        placeholder="Ej: «Factura a [cliente] por una comisión de venta de 1.200 € + IVA, vencimiento en 15 días»."
        className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900 outline-none placeholder:text-gray-400 focus:border-transparent focus:ring-2 focus:ring-indigo-500"
      />
      <div className="mt-2 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={toggleMic}
          aria-pressed={listening}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors',
            listening ? 'border-red-200 bg-red-50 text-red-700' : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50',
            !speechAvailable && 'opacity-60',
          )}
        >
          {listening ? <><MicOff className="h-3.5 w-3.5 animate-pulse" /> Escuchando… (detener)</> : <><Mic className="h-3.5 w-3.5" /> Dictar</>}
        </button>
        <button type="button" onClick={generate} className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-indigo-700">
          <Wand2 className="h-3.5 w-3.5" /> Generar propuesta
        </button>
      </div>
      {!speechAvailable && (
        <p className="mt-1.5 text-[10px] text-gray-400">El dictado no está disponible en este navegador. Puedes escribir o pegar el texto.</p>
      )}
    </div>
  )
}
