'use client'

// Editor de factura PRO (P36B) — pantalla completa con dos paneles: a la izquierda el formulario por
// secciones (Cabecera · Emisor · Facturar a · Conceptos · Totales · Notas) y a la derecha una vista previa
// en vivo que refleja el PDF final. En móvil alterna Editar / Vista previa. Controlado por la página (el
// estado y las operaciones de datos viven fuera). Sin n8n, sin Asistente: flujo manual con revisión.

import { useState } from 'react'
import Link from 'next/link'
import { X, Plus, Trash2, FileDown, RefreshCw, AlertTriangle, Building2, Eye, PencilLine } from 'lucide-react'
import { Button } from '@/components/Button'
import { InvoicePreview } from '@/components/invoicing/InvoicePreview'
import { calculateInvoiceTotals, calcLineTotals, formatInvoiceCurrency } from '@/lib/invoicing/calc'
import { cn } from '@/lib/utils'
import type { InvoiceStatus, IssuerSnapshot, CustomerSnapshot } from '@/lib/invoicing/types'
import type { InvoiceFormData, InvoiceFormItem, ClientLite } from '@/lib/invoicing/invoice-repo'

const field = 'w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-base sm:text-sm text-gray-900 outline-none placeholder:text-gray-400 focus:border-transparent focus:ring-2 focus:ring-indigo-500 disabled:bg-gray-50 disabled:text-gray-500'
const num = (v: string) => { const n = Number(v); return Number.isFinite(n) ? n : 0 }
const has = (v: string | null | undefined): v is string => !!(v && String(v).trim())

export type InvoiceEditorMode = 'create' | 'edit' | 'view'

export function InvoiceEditor({
  open, onClose, mode, form, onChange, clients, issuer, issuerMissing,
  displayNumber, status, saving, emitting, regenerating,
  onSaveDraft, onEmit, onDownload, onRegenerate,
}: {
  open: boolean
  onClose: () => void
  mode: InvoiceEditorMode
  form: InvoiceFormData
  onChange: (updater: (f: InvoiceFormData) => InvoiceFormData) => void
  clients: ClientLite[]
  issuer: IssuerSnapshot | null
  issuerMissing: string[]
  displayNumber: string | null
  status: InvoiceStatus
  saving: boolean
  emitting: boolean
  regenerating?: boolean
  onSaveDraft: () => void
  onEmit: () => void
  onDownload?: () => void
  onRegenerate?: () => void
}) {
  const [mobileView, setMobileView] = useState<'edit' | 'preview'>('edit')
  if (!open) return null

  const readOnly = mode === 'view'
  const customer: CustomerSnapshot | null = form.clientId ? clients.find((c) => c.id === form.clientId)?.snapshot ?? { clientId: form.clientId } : null
  const totals = calculateInvoiceTotals(form.items.map((i) => ({ quantity: i.quantity, unitPrice: i.unitPrice, taxRate: i.taxRate, withholdingRate: i.withholdingRate, discountRate: i.discountRate })))
  const money = (n: number) => formatInvoiceCurrency(n, form.currency || 'EUR')

  const setItem = (idx: number, patch: Partial<InvoiceFormItem>) => onChange((f) => ({ ...f, items: f.items.map((it, i) => (i === idx ? { ...it, ...patch } : it)) }))
  const addItem = () => onChange((f) => ({ ...f, items: [...f.items, { description: '', quantity: 1, unitPrice: 0, discountRate: 0, taxRate: 21, withholdingRate: 0, sortOrder: f.items.length }] }))
  const delItem = (idx: number) => onChange((f) => ({ ...f, items: f.items.length > 1 ? f.items.filter((_, i) => i !== idx) : f.items }))

  const title = mode === 'view' ? `Factura ${displayNumber ?? ''}`.trim() : mode === 'edit' ? 'Editar borrador' : 'Nueva factura'
  const hasCritical = issuerMissing.length > 0

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-gray-100">
      {/* Barra superior */}
      <header className="flex items-center justify-between gap-3 border-b border-gray-200 bg-white px-4 py-3 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <button onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100" aria-label="Cerrar"><X className="h-4.5 w-4.5" /></button>
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold text-gray-900">{title}</h2>
            <p className="text-[11px] text-gray-500">{readOnly ? 'Solo lectura' : 'Se numera automáticamente al emitir'}</p>
          </div>
        </div>
        {/* Toggle móvil */}
        <div className="flex items-center gap-1 rounded-lg bg-gray-100 p-0.5 lg:hidden">
          <button onClick={() => setMobileView('edit')} className={cn('flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium', mobileView === 'edit' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500')}><PencilLine className="h-3.5 w-3.5" /> Editar</button>
          <button onClick={() => setMobileView('preview')} className={cn('flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium', mobileView === 'preview' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500')}><Eye className="h-3.5 w-3.5" /> Vista previa</button>
        </div>
      </header>

      {/* Cuerpo */}
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {/* Formulario */}
        <div className={cn('min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6 lg:max-w-[560px] lg:border-r lg:border-gray-200', mobileView === 'preview' && 'hidden lg:block')}>
          <div className="mx-auto max-w-xl space-y-5">
            {/* A · Cabecera */}
            <Section title="Cabecera" step="A">
              <div className="grid grid-cols-1 gap-3">
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-medium text-gray-600">Cliente</span>
                  <select className={field} value={form.clientId ?? ''} disabled={readOnly} onChange={(e) => onChange((f) => ({ ...f, clientId: e.target.value || null }))}>
                    <option value="">Selecciona un cliente…</option>
                    {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                  {!form.clientId && !readOnly && <span className="text-[11px] text-amber-600">Necesario para emitir la factura.</span>}
                </label>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <label className="flex flex-col gap-1"><span className="text-xs font-medium text-gray-600">Serie</span><input className={field} value={form.series} disabled={readOnly} onChange={(e) => onChange((f) => ({ ...f, series: e.target.value.toUpperCase().slice(0, 4) }))} /></label>
                  <label className="flex flex-col gap-1"><span className="text-xs font-medium text-gray-600">Moneda</span><input className={field} value={form.currency} disabled={readOnly} onChange={(e) => onChange((f) => ({ ...f, currency: e.target.value.toUpperCase().slice(0, 3) }))} /></label>
                  <label className="flex flex-col gap-1"><span className="text-xs font-medium text-gray-600">Emisión</span><input type="date" className={field} value={form.issueDate} disabled={readOnly} onChange={(e) => onChange((f) => ({ ...f, issueDate: e.target.value }))} /></label>
                  <label className="flex flex-col gap-1"><span className="text-xs font-medium text-gray-600">Vencimiento</span><input type="date" className={field} value={form.dueDate ?? ''} disabled={readOnly} onChange={(e) => onChange((f) => ({ ...f, dueDate: e.target.value || null }))} /></label>
                </div>
              </div>
            </Section>

            {/* B · Emisor */}
            <Section title="Emisor" step="B">
              <div className="rounded-lg border border-gray-100 bg-gray-50/60 p-3">
                <div className="flex items-start gap-2">
                  <Building2 className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" />
                  <div className="min-w-0 text-xs text-gray-600">
                    <p className="font-semibold text-gray-800">{has(issuer?.legalName) ? issuer!.legalName : 'Tu empresa (sin configurar)'}</p>
                    <p className="truncate">{[has(issuer?.taxId) ? `NIF ${issuer!.taxId}` : null, issuer?.address, issuer?.city].filter(Boolean).join(' · ') || 'Sin datos fiscales'}</p>
                  </div>
                </div>
                {hasCritical && (
                  <div className="mt-2 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2 text-[11px] text-amber-800">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>Faltan datos fiscales del emisor: <b>{issuerMissing.join(', ')}</b>. <Link href="/settings" className="font-semibold underline">Complétalos en Configuración</Link> para una factura seria.</span>
                  </div>
                )}
              </div>
            </Section>

            {/* C · Facturar a */}
            <Section title="Facturar a" step="C">
              {customer && has(customer.name) ? (
                <div className="rounded-lg border border-gray-100 bg-white p-3 text-xs text-gray-600">
                  <p className="font-semibold text-gray-800">{customer.name}</p>
                  <p className="mt-0.5 space-x-1">{[has(customer.taxId) ? `NIF ${customer.taxId}` : null, customer.email, customer.phone].filter(Boolean).join(' · ') || 'Sin datos de contacto en la ficha del cliente.'}</p>
                </div>
              ) : (
                <p className="rounded-lg border border-dashed border-gray-200 bg-gray-50/50 p-3 text-xs text-gray-400">Selecciona un cliente en la cabecera para rellenar este bloque.</p>
              )}
            </Section>

            {/* D · Conceptos */}
            <Section title="Conceptos" step="D" action={!readOnly ? <button onClick={addItem} className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"><Plus className="h-3.5 w-3.5" /> Añadir línea</button> : undefined}>
              <div className="space-y-3">
                {form.items.map((it, idx) => {
                  const lt = calcLineTotals({ quantity: it.quantity, unitPrice: it.unitPrice, taxRate: it.taxRate, withholdingRate: it.withholdingRate, discountRate: it.discountRate })
                  return (
                    <div key={idx} className="rounded-xl border border-gray-100 bg-gray-50/50 p-3">
                      <div className="mb-2 flex items-start gap-2">
                        <input className={field} placeholder="Descripción del concepto" value={it.description} disabled={readOnly} onChange={(e) => setItem(idx, { description: e.target.value })} />
                        {!readOnly && <button title="Eliminar" onClick={() => delItem(idx)} className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-gray-400 hover:bg-red-50 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>}
                      </div>
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                        <Field label="Cantidad"><input type="number" min="0" step="any" className={field} value={it.quantity} disabled={readOnly} onChange={(e) => setItem(idx, { quantity: num(e.target.value) })} /></Field>
                        <Field label="Precio"><input type="number" min="0" step="any" className={field} value={it.unitPrice} disabled={readOnly} onChange={(e) => setItem(idx, { unitPrice: num(e.target.value) })} /></Field>
                        <Field label="Dto. %"><input type="number" min="0" max="100" step="any" className={field} value={it.discountRate} disabled={readOnly} onChange={(e) => setItem(idx, { discountRate: num(e.target.value) })} /></Field>
                        <Field label="IVA %"><input type="number" min="0" step="any" className={field} value={it.taxRate} disabled={readOnly} onChange={(e) => setItem(idx, { taxRate: num(e.target.value) })} /></Field>
                        <Field label="IRPF %"><input type="number" min="0" step="any" className={field} value={it.withholdingRate} disabled={readOnly} onChange={(e) => setItem(idx, { withholdingRate: num(e.target.value) })} /></Field>
                      </div>
                      <div className="mt-2 text-right text-[11px] text-gray-500">Total línea: <span className="font-semibold text-gray-800">{money(lt.lineTotal)}</span></div>
                    </div>
                  )
                })}
              </div>
            </Section>

            {/* E · Totales */}
            <Section title="Totales" step="E">
              <div className="rounded-xl border border-gray-100 bg-white p-3 text-sm">
                <Row label="Base imponible" value={money(totals.subtotal)} />
                <Row label="IVA" value={money(totals.taxTotal)} />
                {totals.withholdingTotal > 0 && <Row label="Retención IRPF" value={`−${money(totals.withholdingTotal)}`} />}
                <div className="mt-1.5 flex justify-between border-t border-gray-100 pt-1.5 text-base font-semibold text-gray-900"><span>Total</span><span className="tabular-nums">{money(totals.total)}</span></div>
              </div>
            </Section>

            {/* F · Notas */}
            <Section title="Notas" step="F">
              <div className="grid grid-cols-1 gap-3">
                <label className="flex flex-col gap-1"><span className="text-xs font-medium text-gray-600">Notas (visibles en la factura)</span>
                  <textarea rows={2} className={field} value={form.notes} disabled={readOnly} onChange={(e) => onChange((f) => ({ ...f, notes: e.target.value }))} /></label>
                <label className="flex flex-col gap-1"><span className="text-xs font-medium text-gray-600">Notas internas (no salen en el PDF)</span>
                  <textarea rows={2} className={field} value={form.internalNotes} disabled={readOnly} onChange={(e) => onChange((f) => ({ ...f, internalNotes: e.target.value }))} /></label>
              </div>
            </Section>
          </div>
        </div>

        {/* Vista previa */}
        <div className={cn('min-h-0 flex-1 overflow-y-auto bg-gray-100 px-4 py-5 sm:px-6', mobileView === 'edit' && 'hidden lg:block')}>
          <p className="mx-auto mb-2 max-w-[640px] text-[11px] font-medium uppercase tracking-wide text-gray-400">Vista previa · se parece al PDF final</p>
          <InvoicePreview issuer={issuer} customer={customer} displayNumber={displayNumber} status={status} issueDate={form.issueDate} dueDate={form.dueDate} currency={form.currency} notes={form.notes} items={form.items} />
        </div>
      </div>

      {/* Acciones */}
      <footer className="flex items-center justify-between gap-2 border-t border-gray-200 bg-white px-4 py-3 sm:px-6">
        <Button variant="secondary" size="sm" onClick={onClose}>Cerrar</Button>
        <div className="flex items-center gap-2">
          {readOnly ? (
            <>
              {onRegenerate && <Button variant="secondary" size="sm" onClick={onRegenerate} loading={regenerating} disabled={regenerating}><RefreshCw className="h-3.5 w-3.5" /> Regenerar PDF</Button>}
              {onDownload && <Button variant="primary" size="sm" onClick={onDownload}><FileDown className="h-3.5 w-3.5" /> Descargar PDF</Button>}
            </>
          ) : (
            <>
              <Button variant="secondary" size="sm" onClick={onSaveDraft} loading={saving} disabled={saving || emitting}>Guardar borrador</Button>
              <Button variant="primary" size="sm" onClick={onEmit} loading={emitting} disabled={saving || emitting}>Guardar y emitir</Button>
            </>
          )}
        </div>
      </footer>
    </div>
  )
}

function Section({ title, step, action, children }: { title: string; step: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="flex h-5 w-5 items-center justify-center rounded-md bg-indigo-100 text-[10px] font-bold text-indigo-700">{step}</span>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">{title}</h3>
        </div>
        {action}
      </div>
      {children}
    </section>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="flex flex-col gap-1"><span className="text-[10px] text-gray-500">{label}</span>{children}</label>
}

function Row({ label, value }: { label: string; value: string }) {
  return <div className="flex justify-between text-gray-600"><span>{label}</span><span className="tabular-nums">{value}</span></div>
}
