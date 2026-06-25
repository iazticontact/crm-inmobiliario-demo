'use client'

// Ficha de inmueble (P7.1/P7.2). Vista 360 compacta: cabecera con portada + datos + acciones
// DIRECTAS (modales de fotos y documentos, sin scroll), datos clave, operaciones y trámites
// vinculados. Fotos (PropertyPhotosManager) y documentos (EntityDocumentsManager) se gestionan en
// modales ligeros y reutilizan los mismos componentes. Carga por id (refresh-safe). RLS por
// workspace, signed URLs, sin service_role.

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import { toast } from 'sonner'
import { ArrowLeft, Home, MapPin, Pencil, Building2, ImagePlus, FilePlus2, Trash2, X } from 'lucide-react'
import { SectionCard } from '@/components/SectionCard'
import { Badge } from '@/components/Badge'
import { Button } from '@/components/Button'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { EmptyState } from '@/components/EmptyState'
import { EntityDocumentsManager } from '@/components/EntityDocumentsManager'
import { PropertyPhotosManager } from '@/components/PropertyPhotosManager'
import { PropertyStatusBadge } from '@/components/PropertyStatusBadge'
import { EditPropertyDrawer } from '@/components/VerticalEditForms'
import { DEMO_MODE_KEY, useCurrentUser } from '@/lib/current-user'
import { cn } from '@/lib/utils'
import {
  listProperties, listOpportunities, listServiceCases, deleteProperty,
  type PropertyRow, type OpportunityRow, type ServiceCaseRow,
} from '@/lib/vertical-queries'
import { getClients } from '@/lib/supabase-queries'
import { coverUrlsForProperties } from '@/lib/entity-files'
import { demoProperties, demoOpportunities, demoServiceCases } from '@/lib/demo/demo-real-estate'
import { clients as demoClients } from '@/lib/mock-data'
import { commStateLabel, COMM_STATE_TONE, commStateOf } from '@/lib/demo/vertical-templates'
import { serviceCaseStatusLabel } from '@/components/VerticalForms'
import {
  PROPERTY_OPERATION_LABEL, PROPERTY_STATUS_META,
  propLabel, propNum, propertyTypeText, isRentalProperty, isClosedPropertyStatus, formatPropertyPrice,
} from '@/lib/property-display'

function fmtDate(value: string | null): string {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' })
}

const ACTION_BTN = 'inline-flex h-9 items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 text-sm font-medium text-gray-700 shadow-sm transition-colors hover:border-gray-300 hover:bg-gray-50'

export default function PropertyDetailPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const id = Array.isArray(params.id) ? params.id[0] : params.id
  const { currentUser, isLoading: userLoading } = useCurrentUser()
  const workspaceId = currentUser?.workspaceId ?? null

  const [property, setProperty] = useState<PropertyRow | null>(null)
  const [opportunities, setOpportunities] = useState<OpportunityRow[]>([])
  const [cases, setCases] = useState<ServiceCaseRow[]>([])
  const [clientNames, setClientNames] = useState<Record<string, string>>({})
  const [coverUrl, setCoverUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [photosOpen, setPhotosOpen] = useState(false)
  const [docsOpen, setDocsOpen] = useState(false)
  // Borrado seguro desde la ficha (mismo criterio que en Cartera).
  const [askDelete, setAskDelete] = useState(false)
  const [deleteBlocked, setDeleteBlocked] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const isDemo = typeof window !== 'undefined' && window.localStorage.getItem(DEMO_MODE_KEY) === 'true'

  const load = useCallback(async () => {
    setLoading(true)
    setNotFound(false)
    if (isDemo) {
      const p = demoProperties.find((x) => x.id === id) ?? null
      setProperty(p)
      setOpportunities(demoOpportunities)
      setCases(demoServiceCases)
      setClientNames(Object.fromEntries(demoClients.map((c) => [c.id, c.name])))
      setNotFound(!p)
      setLoading(false)
      return
    }
    if (!workspaceId) { setLoading(false); return }
    try {
      const [props, opps, srv, clientList] = await Promise.all([
        listProperties(workspaceId).catch(() => []),
        listOpportunities(workspaceId).catch(() => []),
        listServiceCases(workspaceId).catch(() => []),
        getClients(workspaceId).catch(() => []),
      ])
      const p = props.find((x) => x.id === id) ?? null
      setProperty(p)
      setOpportunities(opps)
      setCases(srv)
      setClientNames(Object.fromEntries((clientList as { id: string; name: string }[]).map((c) => [c.id, c.name])))
      setNotFound(!p)
      // Portada (una signed URL, no toda la galería) para la cabecera; la galería completa se carga
      // de forma perezosa solo al abrir el modal de fotos.
      if (p) coverUrlsForProperties(workspaceId, [p.id]).then((m) => setCoverUrl(m[p.id] ?? null)).catch(() => {})
    } catch {
      setNotFound(true)
    } finally {
      setLoading(false)
    }
  }, [id, workspaceId, isDemo])

  useEffect(() => {
    if (userLoading) return
    queueMicrotask(() => { void load() })
  }, [userLoading, load])

  const linkedOps = useMemo(
    () => opportunities.filter((o) => o.property_id === id || (typeof o.metadata?.property_id === 'string' && o.metadata.property_id === id)),
    [opportunities, id],
  )
  const linkedOpIds = useMemo(() => new Set(linkedOps.map((o) => o.id)), [linkedOps])
  const linkedCases = useMemo(
    () => cases.filter((c) => c.opportunity_id && linkedOpIds.has(c.opportunity_id)),
    [cases, linkedOpIds],
  )

  const clientNameOf = (cid: string | null) => (cid ? clientNames[cid] ?? '' : '')

  // Borrado seguro: bloqueo si hay operaciones vinculadas; si no, confirmación fuerte (borra
  // también fotos/documentos vía deleteProperty). No borra clientes ni operaciones.
  const requestDelete = () => {
    if (linkedOps.length > 0) { setDeleteBlocked(true); return }
    setAskDelete(true)
  }
  const confirmDelete = async () => {
    if (isDemo) { toast.info('Modo demo: no se elimina.'); setAskDelete(false); return }
    if (!workspaceId || !id) { toast.error('Sin workspace activo.'); setAskDelete(false); return }
    setDeleting(true)
    const ok = await deleteProperty(workspaceId, id)
    setDeleting(false)
    if (!ok) { toast.error('No se pudo eliminar el inmueble. Vuelve a intentarlo.'); return }
    toast.success('Inmueble eliminado')
    router.push('/opportunities')
  }

  if (!loading && (notFound || !property)) {
    return (
      <div className="mx-auto max-w-3xl px-1 py-6">
        <Link href="/opportunities" className="mb-4 inline-flex items-center gap-1 text-sm font-medium text-indigo-600 hover:text-indigo-700">
          <ArrowLeft className="h-4 w-4" /> Volver a Cartera
        </Link>
        <EmptyState
          icon={<Building2 className="h-6 w-6 text-gray-300" />}
          title="Inmueble no encontrado"
          description="Puede que se haya eliminado o que no tengas acceso. Vuelve a la cartera para ver tus inmuebles."
        />
      </div>
    )
  }

  const p = property
  const st = p ? (PROPERTY_STATUS_META[p.status] ?? { label: p.status, tone: 'bg-gray-50 text-gray-600 border-gray-100' }) : null
  const isRent = p ? isRentalProperty(p.operation_type) : false
  const historical = p ? isClosedPropertyStatus(p.status) : false
  const specs = p ? [
    propNum(p, 'bedrooms', 'rooms') != null ? `${propNum(p, 'bedrooms', 'rooms')} hab` : '',
    propNum(p, 'bathrooms', 'baths') != null ? `${propNum(p, 'bathrooms', 'baths')} baños` : '',
    propNum(p, 'area_m2', 'm2') != null ? `${propNum(p, 'area_m2', 'm2')} m²` : '',
  ].filter(Boolean).join(' · ') : ''
  const refRaw = p ? (p.reference ?? p.metadata?.reference) : ''
  const ref = typeof refRaw === 'string' ? refRaw : ''
  const owner = p ? (clientNameOf(p.client_id) || p.owner_name || '') : ''

  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }} className="space-y-4">
      <div>
        <Link href="/opportunities" className="inline-flex items-center gap-1 text-sm font-medium text-indigo-600 hover:text-indigo-700">
          <ArrowLeft className="h-4 w-4" /> Volver a Cartera
        </Link>
      </div>

      {loading || !p || !st ? (
        <div className="space-y-4">
          <div className="h-56 w-full animate-pulse rounded-2xl bg-slate-100" />
          <div className="h-40 w-full animate-pulse rounded-2xl bg-slate-100" />
        </div>
      ) : (
        <>
          {/* Cabecera compacta: portada (columna acotada) + datos clave + acciones directas */}
          <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm shadow-gray-950/[0.03]">
            <div className="grid gap-4 md:grid-cols-[minmax(0,300px)_1fr] lg:grid-cols-[minmax(0,360px)_1fr]">
              <div className="relative aspect-[4/3] overflow-hidden rounded-xl bg-gradient-to-br from-gray-50 to-gray-100">
                {coverUrl ? (
                  <img src={coverUrl} alt={p.title} className="absolute inset-0 h-full w-full object-cover" />
                ) : isDemo ? (
                  <div className="flex h-full w-full flex-col items-center justify-center gap-1 text-center">
                    <Home className="h-8 w-8 text-gray-300" />
                    <span className="text-xs font-medium text-gray-500">Sin fotos</span>
                  </div>
                ) : (
                  <button type="button" onClick={() => setPhotosOpen(true)} className="flex h-full w-full flex-col items-center justify-center gap-1 text-center transition-colors hover:bg-gray-50">
                    <Home className="h-8 w-8 text-gray-300" />
                    <span className="text-xs font-medium text-gray-500">Sin fotos todavía</span>
                    <span className="text-[11px] font-semibold text-indigo-600">Subir fotos</span>
                  </button>
                )}
              </div>
              <div className="flex min-w-0 flex-col">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="rounded-full bg-gray-100 px-3 py-1.5 text-xs font-semibold text-gray-700">{propLabel(PROPERTY_OPERATION_LABEL, p.operation_type) || 'Operación'}</span>
                  <PropertyStatusBadge status={p.status} size="lg" />
                  {historical && <span className="rounded-full bg-gray-900/80 px-3 py-1.5 text-xs font-semibold text-white">Histórico</span>}
                </div>
                <h1 className="mt-2 text-xl font-bold leading-tight text-gray-900">{p.title}</h1>
                <p className="mt-0.5 text-[12px] text-gray-400">{[ref ? `Ref. ${ref}` : '', propertyTypeText(p), specs].filter(Boolean).join(' · ') || '—'}</p>
                <p className="mt-1 flex items-center gap-1 text-[13px] text-gray-600">
                  <MapPin className="h-3.5 w-3.5 shrink-0 text-gray-400" />
                  {[p.address, [p.city, p.area].filter(Boolean).join(', ')].filter(Boolean).join(' · ') || 'Sin ubicación'}
                </p>
                <p className="mt-2 text-2xl font-bold text-gray-900">{formatPropertyPrice(p.price, p.currency, isRent)}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button variant="primary" size="sm" onClick={() => setEditOpen(true)}><Pencil className="h-3.5 w-3.5" /> Editar</Button>
                  {!isDemo && <button type="button" onClick={() => setPhotosOpen(true)} className={ACTION_BTN}><ImagePlus className="h-3.5 w-3.5" /> Subir fotos</button>}
                  {!isDemo && <button type="button" onClick={() => setDocsOpen(true)} className={ACTION_BTN}><FilePlus2 className="h-3.5 w-3.5" /> Añadir documento</button>}
                  <button type="button" onClick={requestDelete} title="Eliminar inmueble" className="ml-auto inline-flex h-9 items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 text-sm font-medium text-gray-500 shadow-sm transition-colors hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600"><Trash2 className="h-3.5 w-3.5" /> Eliminar</button>
                </div>
              </div>
            </div>
          </div>

          {/* Datos clave */}
          <SectionCard title="Datos del inmueble" description="Características y propietario / contacto.">
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Field label="Tipo" value={propertyTypeText(p) || '—'} />
              <Field label="Operación" value={propLabel(PROPERTY_OPERATION_LABEL, p.operation_type) || '—'} />
              <Field label="Estado" value={st.label} />
              <Field label="Características" value={specs || '—'} />
              <Field label="Propietario / contacto" value={owner || '—'} />
              <Field label="Teléfono" value={p.owner_phone || '—'} />
              <Field label={isRent ? 'Renta' : 'Precio'} value={formatPropertyPrice(p.price, p.currency, isRent)} />
              <Field label="Actualizado" value={fmtDate(p.updated_at) || '—'} />
            </dl>
            {p.notes && <p className="mt-3 whitespace-pre-line rounded-lg bg-gray-50 px-3 py-2 text-[12px] text-gray-600">{p.notes}</p>}
          </SectionCard>

          {/* Operaciones vinculadas */}
          <SectionCard
            title="Operaciones vinculadas"
            description="Ventas o alquileres asociados a este inmueble."
            action={<Badge variant={linkedOps.length ? 'indigo' : 'default'} dot>{linkedOps.length} {linkedOps.length === 1 ? 'operación' : 'operaciones'}</Badge>}
          >
            {linkedOps.length === 0 ? (
              <p className="py-1 text-[13px] text-gray-400">Sin operaciones vinculadas todavía.</p>
            ) : (
              <ul className="space-y-2">
                {linkedOps.map((o) => {
                  const kind = typeof o.metadata?.operation_kind === 'string' ? o.metadata.operation_kind : null
                  return (
                    <li key={o.id} className="flex items-center justify-between gap-3 rounded-xl border border-gray-100 bg-white p-3">
                      <Link href="/opportunities" className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-gray-900">{o.title}</p>
                        <p className="truncate text-[11px] text-gray-500">{clientNameOf(o.client_id) || 'Sin cliente'}</p>
                      </Link>
                      <span className={cn('shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold', COMM_STATE_TONE[commStateOf(o.stage)])}>{commStateLabel(o.stage, kind)}</span>
                    </li>
                  )
                })}
              </ul>
            )}
          </SectionCard>

          {/* Trámites vinculados */}
          <SectionCard
            title="Trámites vinculados"
            description="Gestiones y documentación de las operaciones de este inmueble."
            action={<Badge variant={linkedCases.length ? 'indigo' : 'default'} dot>{linkedCases.length} {linkedCases.length === 1 ? 'trámite' : 'trámites'}</Badge>}
          >
            {linkedCases.length === 0 ? (
              <p className="py-1 text-[13px] text-gray-400">Sin trámites vinculados.</p>
            ) : (
              <ul className="space-y-2">
                {linkedCases.map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-3 rounded-xl border border-gray-100 bg-white p-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-gray-900">{c.title}</p>
                      <p className="truncate text-[11px] text-gray-500">{[c.case_type, c.due_date ? `vence ${fmtDate(c.due_date)}` : ''].filter(Boolean).join(' · ')}</p>
                    </div>
                    <span className="shrink-0 rounded-full bg-gray-50 px-2 py-0.5 text-[10px] font-semibold text-gray-600">{serviceCaseStatusLabel(c.status)}</span>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>

          {/* Modal de fotos (lazy) */}
          {photosOpen && !isDemo && (
            <Modal title="Fotos del inmueble" subtitle="Portada y galería. La portada se ve en la cartera." onClose={() => setPhotosOpen(false)}>
              <PropertyPhotosManager workspaceId={workspaceId} propertyId={p.id} onCoverChange={(_, url) => setCoverUrl(url)} />
            </Modal>
          )}

          {/* Modal de documentos (lazy) */}
          {docsOpen && !isDemo && (
            <Modal title="Documentos del inmueble" subtitle="Nota simple, planos, certificado energético, escrituras o contratos." onClose={() => setDocsOpen(false)}>
              <EntityDocumentsManager
                workspaceId={workspaceId}
                entityType="property"
                entityId={p.id}
                title="Documentos del inmueble"
                description="Sube nota simple, planos, certificado energético o escrituras del inmueble."
              />
            </Modal>
          )}

          <EditPropertyDrawer
            open={editOpen}
            onClose={() => setEditOpen(false)}
            workspaceId={workspaceId}
            property={p}
            onUpdated={(row) => setProperty(row)}
            onCoverChange={(_, url) => setCoverUrl(url)}
          />

          {/* Borrado BLOQUEADO: el inmueble tiene operaciones vinculadas → mejor archivar. */}
          <ConfirmDialog
            open={deleteBlocked}
            title="No puedes eliminar este inmueble"
            description={`«${p.title}» tiene ${linkedOps.length} ${linkedOps.length === 1 ? 'operación vinculada' : 'operaciones vinculadas'}. Para conservar el histórico, archívalo (cambia su estado a Vendido/Alquilado); o revisa sus operaciones antes de eliminarlo. No se ha borrado nada.`}
            confirmLabel="Entendido"
            cancelLabel="Cancelar"
            onConfirm={() => setDeleteBlocked(false)}
            onCancel={() => setDeleteBlocked(false)}
          />

          {/* Borrado SIN operaciones: confirmación fuerte (borra también fotos/documentos). */}
          <ConfirmDialog
            open={askDelete}
            destructive
            loading={deleting}
            loadingLabel="Eliminando…"
            title="¿Eliminar inmueble?"
            description={`Se eliminará «${p.title}» y sus fotos y documentos asociados. Esta acción no se puede deshacer. No se elimina ningún cliente. Para conservar el histórico, normalmente es mejor archivar.`}
            confirmLabel="Eliminar"
            cancelLabel="Cancelar"
            onConfirm={() => void confirmDelete()}
            onCancel={() => { if (!deleting) setAskDelete(false) }}
          />
        </>
      )}
    </motion.div>
  )
}

function Modal({ title, subtitle, onClose, children }: { title: string; subtitle?: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button type="button" aria-label="Cerrar" className="absolute inset-0 bg-gray-950/40 backdrop-blur-[1px]" onClick={onClose} />
      <div className="relative max-h-[85vh] w-full max-w-xl overflow-y-auto rounded-2xl border border-gray-100 bg-white p-5 shadow-xl">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-gray-900">{title}</h3>
            {subtitle && <p className="text-[12px] text-gray-500">{subtitle}</p>}
          </div>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="shrink-0 rounded-lg p-1 text-gray-400 transition-colors hover:bg-gray-50 hover:text-gray-600"><X className="h-4 w-4" /></button>
        </div>
        {children}
      </div>
    </div>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-gray-100 bg-gray-50/40 px-3 py-2">
      <dt className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">{label}</dt>
      <dd className="mt-0.5 truncate text-[13px] font-medium text-gray-800">{value}</dd>
    </div>
  )
}
