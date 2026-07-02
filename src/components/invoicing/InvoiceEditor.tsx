'use client'

// Editor de factura PRO (P36B) — pantalla completa con dos paneles: a la izquierda el formulario por
// secciones (Cabecera · Emisor · Facturar a · Conceptos · Totales · Notas) y a la derecha una vista previa
// en vivo que refleja el PDF final. En móvil alterna Editar / Vista previa. Controlado por la página (el
// estado y las operaciones de datos viven fuera). Sin n8n, sin Asistente: flujo manual con revisión.

import { useState } from 'react'
import Link from 'next/link'
import { X, Plus, Trash2, FileDown, RefreshCw, RotateCcw, AlertTriangle, Building2, Eye, PencilLine, CheckCircle2 } from 'lucide-react'
import { Button } from '@/components/Button'
import { AutocompleteSelect } from '@/components/AutocompleteSelect'
import { DecimalInput } from '@/components/invoicing/DecimalInput'
import { InvoicePreview } from '@/components/invoicing/InvoicePreview'
import { calculateInvoiceTotals, calcLineTotals, formatInvoiceCurrency } from '@/lib/invoicing/calc'
import { currencyOptions, currencyName } from '@/lib/invoicing/currencies'
import { cn } from '@/lib/utils'
import type { InvoiceStatus, IssuerSnapshot, CustomerSnapshot } from '@/lib/invoicing/types'
import type { InvoiceFormData, InvoiceFormItem, ClientLite } from '@/lib/invoicing/invoice-repo'

const field = 'w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-base sm:text-sm text-gray-900 outline-none placeholder:text-gray-400 focus:border-transparent focus:ring-2 focus:ring-indigo-500 disabled:bg-gray-50 disabled:text-gray-500'
const num = (v: string) => { const n = Number(v); return Number.isFinite(n) ? n : 0 }
const has = (v: string | null | undefined): v is string => !!(v && String(v).trim())

export type InvoiceEditorMode = 'create' | 'edit' | 'view'

export function InvoiceEditor({
  open, onClose, mode, form, onChange, clients, issuer, issuerMissing,
  displayNumber, status, saving, emitting, regenerating, trashed, canHardDelete,
  onSaveDraft, onEmit, onDownload, onRegenerate, onTrash, onRestore, onHardDelete,
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
  trashed?: boolean
  canHardDelete?: boolean
  onSaveDraft: () => void
  onEmit: () => void
  onDownload?: () => void
  onRegenerate?: () => void
  onTrash?: () => void
  onRestore?: () => void
  onHardDelete?: () => void
}) {
  const [mobileView, setMobileView] = useState<'edit' | 'preview'>('edit')
  const [confirmEmit, setConfirmEmit] = useState(false)
  if (!open) return null

  const readOnly = mode === 'view'
  const customer: CustomerSnapshot | null = form.clientId ? clients.find((c) => c.id === form.clientId)?.snapshot ?? { clientId: form.clientId } : null
  const totals = calculateInvoiceTotals(form.items.map((i) => ({ quantity: i.quantity, unitPrice: i.unitPrice, taxRate: i.taxRate, withholdingRate: i.withholdingRate, discountRate: i.discountRate })))
  const money = (n: number) => formatInvoiceCurrency(n, form.currency || 'EUR')
  const eur = (n: number) => formatInvoiceCurrency(n, 'EUR')

  const isForeign = (form.currency || 'EUR').toUpperCase() !== 'EUR'
  const fxOk = !isForeign || (typeof form.exchangeRateToEur === 'number' && form.exchangeRateToEur > 0)
  const eurEquiv = isForeign && form.exchangeRateToEur ? totals.total * form.exchangeRateToEur : null
  const hasAmount = form.items.some((i) => i.quantity > 0 && i.unitPrice > 0)
  const canEmit = !!form.clientId && hasAmount && fxOk
  const custMissing = customer ? [!has(customer.taxId) ? 'NIF/CIF' : null, !has(customer.address) ? 'dirección' : null].filter(Boolean) as string[] : []

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
            {form.opportunityId && (
              <div className="flex items-start gap-2 rounded-lg border border-indigo-100 bg-indigo-50/50 px-3 py-2 text-[11px] leading-4 text-gray-600">
                <Building2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-indigo-500" />
                <span>Factura generada desde una <b>operación inmobiliaria</b>. La base son tus <b>honorarios/comisión</b> (no el precio del inmueble). Revísala y edítala antes de emitir.</span>
              </div>
            )}
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
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <label className="flex flex-col gap-1">
                    <span className="text-xs font-medium text-gray-600">Serie de numeración</span>
                    <input className={field} value={form.series} disabled={readOnly} onChange={(e) => onChange((f) => ({ ...f, series: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4) }))} />
                    <span className="text-[11px] text-gray-400">Separa la numeración. Normalmente puedes dejar «A». Ejemplo: FAC-A/2026/0001.</span>
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-xs font-medium text-gray-600">Moneda</span>
                    {readOnly
                      ? <input className={field} value={`${form.currency} — ${currencyName(form.currency)}`} disabled />
                      : <AutocompleteSelect value={form.currency} onChange={(v) => onChange((f) => ({ ...f, currency: (v || 'EUR').toUpperCase() }))} options={currencyOptions} allowClear={false} inputClassName="text-base sm:text-sm" />}
                  </label>
                  <label className="flex flex-col gap-1"><span className="text-xs font-medium text-gray-600">Fecha de emisión</span><input type="date" className={field} value={form.issueDate} disabled={readOnly} onChange={(e) => onChange((f) => ({ ...f, issueDate: e.target.value }))} /></label>
                  <label className="flex flex-col gap-1"><span className="text-xs font-medium text-gray-600">Vencimiento</span><input type="date" className={field} value={form.dueDate ?? ''} disabled={readOnly} onChange={(e) => onChange((f) => ({ ...f, dueDate: e.target.value || null }))} /></label>
                </div>

                {isForeign && (
                  <div className="space-y-2 rounded-lg border border-indigo-100 bg-indigo-50/40 p-3">
                    <p className="text-[11px] font-medium text-gray-700">Factura en {form.currency}. Añade el tipo de cambio a EUR (moneda base del CRM):</p>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                      <label className="flex flex-col gap-1"><span className="text-[10px] text-gray-500">1 {form.currency} = € </span><input type="number" step="any" min="0" className={field} value={form.exchangeRateToEur ?? ''} disabled={readOnly} placeholder="0,00" onChange={(e) => onChange((f) => ({ ...f, exchangeRateToEur: e.target.value === '' ? null : num(e.target.value) }))} /></label>
                      <label className="flex flex-col gap-1"><span className="text-[10px] text-gray-500">Fecha del cambio</span><input type="date" className={field} value={form.exchangeRateDate ?? form.issueDate} disabled={readOnly} onChange={(e) => onChange((f) => ({ ...f, exchangeRateDate: e.target.value || null }))} /></label>
                      <label className="flex flex-col gap-1"><span className="text-[10px] text-gray-500">Fuente</span><input className={field} value={form.exchangeRateSource} disabled={readOnly} placeholder="Manual" onChange={(e) => onChange((f) => ({ ...f, exchangeRateSource: e.target.value }))} /></label>
                    </div>
                    {eurEquiv != null
                      ? <p className="text-[11px] text-gray-600">Equivalente orientativo: <b>{eur(eurEquiv)}</b> (total {money(totals.total)}).</p>
                      : <p className="text-[11px] text-amber-600">Sin tipo de cambio no podrás emitir ni contar esta factura en el resumen en EUR.</p>}
                    <p className="text-[10px] text-gray-400">Conversión orientativa para control interno. Revisa el tipo de cambio aplicable con tu asesor fiscal.</p>
                  </div>
                )}
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
                  <p className="mt-0.5">{[has(customer.taxId) ? `NIF ${customer.taxId}` : null, customer.address, customer.email, customer.phone, customer.country].filter(Boolean).join(' · ') || 'Sin datos de contacto en la ficha del cliente.'}</p>
                  {custMissing.length > 0 && !readOnly && (
                    <p className="mt-2 flex items-start gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] text-amber-700"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> Este cliente no tiene {custMissing.join(' ni ')}. Puedes emitir, pero revisa si necesitas completarlo en su ficha.</p>
                  )}
                </div>
              ) : (
                <p className="rounded-lg border border-dashed border-gray-200 bg-gray-50/50 p-3 text-xs text-gray-400">Selecciona un cliente en la cabecera para rellenar sus datos automáticamente.</p>
              )}
            </Section>

            {/* D · Conceptos */}
            <Section title="Conceptos" step="D" action={!readOnly ? <button onClick={addItem} className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"><Plus className="h-3.5 w-3.5" /> Añadir línea</button> : undefined}>
              {!readOnly && (
                <p className="mb-2 rounded-lg border border-indigo-100 bg-indigo-50/50 px-3 py-2 text-[11px] leading-4 text-gray-600">
                  Factura por tus <b>honorarios/comisión</b>, no por el precio del inmueble. El <b>IVA se calcula sobre los honorarios</b>. Ej.: vivienda 250.000 € · honorarios 7.500 € → factura <b>7.500 € + IVA</b>.
                </p>
              )}
              <div className="space-y-3">
                {form.items.map((it, idx) => {
                  const lt = calcLineTotals({ quantity: it.quantity, unitPrice: it.unitPrice, taxRate: it.taxRate, withholdingRate: it.withholdingRate, discountRate: it.discountRate })
                  return (
                    <div key={idx} className="rounded-xl border border-gray-100 bg-gray-50/50 p-3">
                      <div className="mb-2 flex items-start gap-2">
                        <input className={field} list="invoice-concepts" placeholder="Concepto (p. ej. Honorarios de intermediación inmobiliaria)" value={it.description} disabled={readOnly} onChange={(e) => setItem(idx, { description: e.target.value })} />
                        {!readOnly && <button title="Eliminar" onClick={() => delItem(idx)} className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-gray-400 hover:bg-red-50 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>}
                      </div>
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                        <Field label="Cantidad"><DecimalInput value={it.quantity} min={0} disabled={readOnly} className={field} ariaLabel="Cantidad" onCommit={(n) => setItem(idx, { quantity: n })} /></Field>
                        <Field label="Precio"><DecimalInput value={it.unitPrice} min={0} disabled={readOnly} className={field} ariaLabel="Precio" onCommit={(n) => setItem(idx, { unitPrice: n })} /></Field>
                        <Field label="Dto. %"><DecimalInput value={it.discountRate} min={0} max={100} disabled={readOnly} className={field} ariaLabel="Descuento %" onCommit={(n) => setItem(idx, { discountRate: n })} /></Field>
                        <Field label="IVA %"><DecimalInput value={it.taxRate} min={0} disabled={readOnly} list="iva-rates" className={field} ariaLabel="IVA %" onCommit={(n) => setItem(idx, { taxRate: n })} /></Field>
                        <Field label="IRPF %"><DecimalInput value={it.withholdingRate} min={0} disabled={readOnly} list="irpf-rates" className={field} ariaLabel="IRPF %" onCommit={(n) => setItem(idx, { withholdingRate: n })} /></Field>
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
          <InvoicePreview issuer={issuer} customer={customer} displayNumber={displayNumber} status={status} issueDate={form.issueDate} dueDate={form.dueDate} currency={form.currency} notes={form.notes} items={form.items} exchange={isForeign && form.exchangeRateToEur ? { currency: form.currency, rate: form.exchangeRateToEur, date: form.exchangeRateDate ?? form.issueDate } : null} />
        </div>
      </div>

      {/* Sugerencias de tipos habituales (editable, sin bloqueos) */}
      <datalist id="iva-rates"><option value="21" /><option value="10" /><option value="4" /><option value="0" /></datalist>
      <datalist id="irpf-rates"><option value="0" /><option value="7" /><option value="15" /><option value="19" /></datalist>
      <datalist id="invoice-concepts">
        <option value="Honorarios de intermediación inmobiliaria" />
        <option value="Comisión por venta de inmueble" />
        <option value="Comisión por alquiler de inmueble" />
        <option value="Gestión y tramitación" />
        <option value="Asesoramiento inmobiliario" />
      </datalist>

      {/* Acciones — dependen del estado (ciclo de vida) */}
      <footer className="flex items-center justify-between gap-2 border-t border-gray-200 bg-white px-4 py-3 sm:px-6">
        <div className="flex items-center gap-1.5">
          <Button variant="secondary" size="sm" onClick={onClose}>Cerrar</Button>
          {onTrash && (
            <button onClick={onTrash} className="inline-flex items-center gap-1 rounded-lg px-2.5 py-2 text-xs font-medium text-red-600 transition-colors hover:bg-red-50"><Trash2 className="h-3.5 w-3.5" /> Mover a papelera</button>
          )}
        </div>
        <div className="flex items-center gap-2">
          {trashed ? (
            <>
              {onHardDelete && canHardDelete && <button onClick={onHardDelete} className="inline-flex items-center gap-1 rounded-lg px-2.5 py-2 text-xs font-medium text-red-600 transition-colors hover:bg-red-50"><Trash2 className="h-3.5 w-3.5" /> Eliminar definitivamente</button>}
              {onRestore && <Button variant="primary" size="sm" onClick={onRestore}><RotateCcw className="h-3.5 w-3.5" /> Restaurar</Button>}
            </>
          ) : readOnly ? (
            <>
              {onRegenerate && <Button variant="secondary" size="sm" onClick={onRegenerate} loading={regenerating} disabled={regenerating}><RefreshCw className="h-3.5 w-3.5" /> Regenerar PDF</Button>}
              {onDownload && <Button variant="primary" size="sm" onClick={onDownload}><FileDown className="h-3.5 w-3.5" /> Descargar PDF</Button>}
            </>
          ) : (
            <>
              <Button variant="secondary" size="sm" onClick={onSaveDraft} loading={saving} disabled={saving || emitting}>Guardar borrador</Button>
              <Button variant="primary" size="sm" onClick={() => setConfirmEmit(true)} loading={emitting} disabled={saving || emitting}>Guardar y emitir</Button>
            </>
          )}
        </div>
      </footer>

      {/* Revisión antes de emitir (checklist) */}
      {confirmEmit && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-950/50 backdrop-blur-sm" onClick={() => setConfirmEmit(false)} />
          <div className="relative flex max-h-[90vh] w-full max-w-md flex-col rounded-2xl bg-white shadow-2xl">
            <div className="border-b border-gray-100 px-5 py-4">
              <h3 className="text-sm font-semibold text-gray-900">Revisar antes de emitir</h3>
              <p className="mt-0.5 text-[11px] text-gray-500">Comprueba que todo es correcto. Al emitir se reservará el siguiente número de la serie {form.series || 'A'}.</p>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3 text-xs">
              <CheckRow label="Cliente" value={has(customer?.name) ? customer!.name! : 'Sin cliente'} bad={!form.clientId} />
              <CheckRow label="NIF/CIF del cliente" value={has(customer?.taxId) ? customer!.taxId! : 'No consta'} warn={!has(customer?.taxId)} />
              <CheckRow label="Emisor" value={has(issuer?.legalName) ? issuer!.legalName! : 'Sin configurar'} warn={hasCritical} />
              <CheckRow label="Serie" value={form.series || 'A'} />
              <CheckRow label="Fecha de emisión" value={form.issueDate} />
              <CheckRow label="Vencimiento" value={form.dueDate ?? '—'} warn={!form.dueDate} />
              <CheckRow label="Moneda" value={`${form.currency}${isForeign ? (fxOk ? ` · 1 ${form.currency} = ${form.exchangeRateToEur} EUR` : ' · falta tipo de cambio') : ''}`} bad={isForeign && !fxOk} />
              <CheckRow label="Conceptos" value={`${form.items.length} línea${form.items.length === 1 ? '' : 's'}`} bad={!hasAmount} />
              <div className="my-2 border-t border-gray-100" />
              <CheckRow label="Base imponible" value={money(totals.subtotal)} />
              <CheckRow label="IVA" value={money(totals.taxTotal)} />
              {totals.withholdingTotal > 0 && <CheckRow label="Retención IRPF" value={`−${money(totals.withholdingTotal)}`} />}
              <div className="mt-1 flex items-center justify-between rounded-lg bg-indigo-50/70 px-3 py-2"><span className="text-sm font-bold text-gray-900">Total</span><span className="text-sm font-bold tabular-nums text-indigo-700">{money(totals.total)}{eurEquiv != null ? ` · ${eur(eurEquiv)}` : ''}</span></div>
              <p className="mt-3 text-[11px] text-gray-500">Se generará y guardará el PDF. <b>La numeración no se reutiliza:</b> si después anulas o eliminas la factura, ese número no se reasigna.</p>
              {!canEmit && <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2 text-[11px] text-amber-800">{!form.clientId ? 'Selecciona un cliente. ' : ''}{!hasAmount ? 'Añade al menos una línea con importe. ' : ''}{isForeign && !fxOk ? 'Añade el tipo de cambio a EUR. ' : ''}</p>}
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-gray-100 px-5 py-3">
              <Button variant="secondary" size="sm" onClick={() => setConfirmEmit(false)}>Volver a editar</Button>
              <Button variant="primary" size="sm" disabled={!canEmit || emitting} loading={emitting} onClick={() => { setConfirmEmit(false); onEmit() }}>Emitir factura</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function CheckRow({ label, value, warn, bad }: { label: string; value: string; warn?: boolean; bad?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1">
      <span className="flex items-center gap-1.5 text-gray-500">
        {bad ? <AlertTriangle className="h-3.5 w-3.5 text-red-500" /> : warn ? <AlertTriangle className="h-3.5 w-3.5 text-amber-500" /> : <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />}
        {label}
      </span>
      <span className={cn('max-w-[55%] truncate text-right font-medium', bad ? 'text-red-600' : warn ? 'text-amber-700' : 'text-gray-800')}>{value}</span>
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
