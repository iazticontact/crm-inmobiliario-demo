'use client'

// "Plantillas del workspace" panel — used inside /opportunities → Plantillas
// subtab. Surfaces editable templates from workspace_templates with a
// fallback to the static catalog in vertical-templates.ts.
//
// Scope intentionally small: list, create, edit and archive. No DELETE
// (status='archived' marks a row as hidden without losing history).
//
// Honest copy: when there's no workspace_id (demo/offline) we don't pretend
// to write anywhere — the panel renders only the base catalog and a notice.

import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Archive, Loader2, Pencil, Plus, RefreshCcw, Sparkles } from 'lucide-react'
import { SideDrawer } from '@/components/SideDrawer'
import { Button } from '@/components/Button'
import { Input } from '@/components/Input'
import { Badge } from '@/components/Badge'
import { EmptyState } from '@/components/EmptyState'
import { cn } from '@/lib/utils'
import {
  archiveWorkspaceTemplate,
  createWorkspaceTemplate,
  listWorkspaceTemplates,
  updateWorkspaceTemplate,
  type WorkspaceTemplate,
  type WorkspaceTemplateType,
} from '@/lib/workspace-templates'
import {
  MESSAGE_TEMPLATES,
  VERTICALS,
  type MessageTemplate,
  type VerticalKey,
} from '@/lib/demo/vertical-templates'

const SELECT_CLS =
  'h-9 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-colors'

const TEXTAREA_CLS =
  'w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-colors font-mono leading-relaxed'

const FIELD_LABEL_CLS = 'text-sm font-medium text-gray-700'

const TYPE_OPTIONS: Array<{ id: WorkspaceTemplateType; label: string }> = [
  { id: 'message', label: 'Mensaje' },
  { id: 'proposal', label: 'Propuesta' },
  { id: 'document_request', label: 'Petición de documentación' },
  { id: 'custom', label: 'Personalizada' },
]

const CHANNEL_OPTIONS = [
  { id: '', label: 'Cualquier canal' },
  { id: 'whatsapp', label: 'WhatsApp' },
  { id: 'instagram', label: 'Instagram' },
  { id: 'email', label: 'Email' },
]

type Mode = 'create' | 'edit'

type TemplateDrawerProps = {
  open: boolean
  mode: Mode
  workspaceId: string | null
  initial: WorkspaceTemplate | null
  defaultVertical: VerticalKey
  onClose: () => void
  onSaved: (row: WorkspaceTemplate) => void
}

function TemplateDrawer({ open, mode, workspaceId, initial, defaultVertical, onClose, onSaved }: TemplateDrawerProps) {
  if (!open) return null
  return (
    <TemplateDrawerInner
      key={initial?.id ?? 'new'}
      mode={mode}
      workspaceId={workspaceId}
      initial={initial}
      defaultVertical={defaultVertical}
      onClose={onClose}
      onSaved={onSaved}
    />
  )
}

function TemplateDrawerInner({ mode, workspaceId, initial, defaultVertical, onClose, onSaved }: Omit<TemplateDrawerProps, 'open'>) {
  const [name, setName] = useState(() => initial?.name ?? '')
  const [type, setType] = useState<WorkspaceTemplateType>(() => (initial?.type as WorkspaceTemplateType) ?? 'message')
  const [vertical, setVertical] = useState<VerticalKey>(() => (initial?.vertical as VerticalKey) ?? defaultVertical)
  const [channel, setChannel] = useState<string>(() => initial?.channel ?? '')
  const [content, setContent] = useState(() => initial?.content ?? '')
  const [saving, setSaving] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) { toast.error('Necesito un nombre para la plantilla.'); return }
    if (!content.trim()) { toast.error('Necesito contenido.'); return }
    if (!workspaceId) { toast.error('Sin workspace activo. Inicia sesión real para guardar.'); return }
    setSaving(true)
    try {
      let row: WorkspaceTemplate | null = null
      if (mode === 'create') {
        row = await createWorkspaceTemplate(workspaceId, {
          type,
          vertical,
          name: name.trim(),
          channel: channel.trim() || null,
          content,
        })
      } else if (initial) {
        row = await updateWorkspaceTemplate(workspaceId, initial.id, {
          name: name.trim(),
          vertical,
          channel: channel.trim() || null,
          content,
        })
      }
      if (!row) {
        toast.error('No se pudo guardar la plantilla.')
        return
      }
      toast.success(mode === 'create' ? 'Plantilla creada' : 'Plantilla actualizada')
      onSaved(row)
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <SideDrawer
      open
      onClose={onClose}
      title={mode === 'create' ? 'Nueva plantilla del workspace' : 'Editar plantilla'}
      description="Las plantillas del workspace conviven con el catálogo base; NowLabs y el composer las verán primero."
      width="lg"
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="secondary" size="sm" type="button" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button variant="primary" size="sm" type="submit" form="workspace-template-form" loading={saving} disabled={saving}>
            {mode === 'create' ? 'Crear plantilla' : 'Guardar cambios'}
          </Button>
        </div>
      }
    >
      <form id="workspace-template-form" onSubmit={handleSubmit} className="space-y-3">
        <Input label="Nombre" placeholder="Ej. Bienvenida — lead inmobiliaria" value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <label className={FIELD_LABEL_CLS}>Tipo</label>
            <select className={SELECT_CLS} value={type} onChange={(e) => setType(e.target.value as WorkspaceTemplateType)} disabled={mode === 'edit'}>
              {TYPE_OPTIONS.map((t) => (
                <option key={t.id} value={t.id}>{t.label}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className={FIELD_LABEL_CLS}>Vertical</label>
            <select className={SELECT_CLS} value={vertical} onChange={(e) => setVertical(e.target.value as VerticalKey)}>
              {Object.values(VERTICALS).map((v) => (
                <option key={v.key} value={v.key}>{v.label}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <label className={FIELD_LABEL_CLS}>Canal</label>
          <select className={SELECT_CLS} value={channel} onChange={(e) => setChannel(e.target.value)}>
            {CHANNEL_OPTIONS.map((c) => (
              <option key={c.id} value={c.id}>{c.label}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <label className={FIELD_LABEL_CLS}>Contenido</label>
          <textarea
            rows={10}
            className={TEXTAREA_CLS}
            placeholder="Hola {{nombre}}, soy {{agente}} de {{empresa}}…"
            value={content}
            onChange={(e) => setContent(e.target.value)}
          />
          <p className="text-[11px] text-gray-500">
            Usa <code className="rounded bg-gray-100 px-1 text-[10px]">{'{{variable}}'}</code> para placeholders.
            NowLabs sustituirá <code className="rounded bg-gray-100 px-1 text-[10px]">{'{{nombre}}'}</code>, <code className="rounded bg-gray-100 px-1 text-[10px]">{'{{empresa}}'}</code>, <code className="rounded bg-gray-100 px-1 text-[10px]">{'{{agente}}'}</code> cuando estén disponibles.
          </p>
        </div>
      </form>
    </SideDrawer>
  )
}

type WorkspaceTemplatesPanelProps = {
  workspaceId: string | null
  vertical: VerticalKey | 'all'
}

export function WorkspaceTemplatesPanel({ workspaceId, vertical }: WorkspaceTemplatesPanelProps) {
  const [rows, setRows] = useState<WorkspaceTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [editing, setEditing] = useState<WorkspaceTemplate | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  // queueMicrotask defers setState out of the effect's sync body — matches the
  // pattern in Client360Drawer and keeps react-hooks/set-state-in-effect happy.
  useEffect(() => {
    let cancelled = false
    if (!workspaceId) {
      queueMicrotask(() => {
        if (cancelled) return
        setRows([])
        setLoading(false)
      })
      return () => { cancelled = true }
    }
    queueMicrotask(() => { if (!cancelled) setLoading(true) })
    listWorkspaceTemplates(workspaceId, { limit: 100 })
      .then((list) => {
        if (cancelled) return
        setRows(list.filter((r) => r.status !== 'archived'))
        setLoading(false)
      })
      .catch(() => {
        if (cancelled) return
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [workspaceId, refreshKey])

  const refresh = () => setRefreshKey((k) => k + 1)

  const visibleRows = useMemo(() => {
    if (vertical === 'all') return rows
    return rows.filter((r) => r.vertical === vertical || r.vertical === 'general')
  }, [rows, vertical])

  const baseRows = useMemo<MessageTemplate[]>(() => {
    if (vertical === 'all') return MESSAGE_TEMPLATES.slice(0, 12)
    return MESSAGE_TEMPLATES.filter((t) => t.vertical === vertical || t.vertical === 'general').slice(0, 12)
  }, [vertical])

  async function handleArchive(row: WorkspaceTemplate) {
    if (!workspaceId) return
    const ok = await archiveWorkspaceTemplate(workspaceId, row.id)
    if (!ok) { toast.error('No se pudo archivar.'); return }
    setRows((prev) => prev.filter((r) => r.id !== row.id))
    toast.success('Plantilla archivada')
  }

  const defaultVerticalForCreate: VerticalKey = vertical === 'all' ? 'general' : (vertical as VerticalKey)

  return (
    <div className="space-y-4">
      {/* Workspace templates */}
      <section className="rounded-2xl border border-gray-100 bg-white">
        <header className="flex items-center justify-between gap-2 border-b border-gray-100 px-4 py-3">
          <div className="flex items-center gap-2">
            <Sparkles className="h-3.5 w-3.5 text-indigo-600" />
            <h3 className="text-sm font-semibold text-gray-900">Plantillas del workspace</h3>
            <Badge variant={visibleRows.length ? 'indigo' : 'default'} dot>{visibleRows.length}</Badge>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={refresh} disabled={loading}>
              <RefreshCcw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
              Refrescar
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => { setEditing(null); setDrawerOpen(true) }}
              disabled={!workspaceId}
              title={!workspaceId ? 'Inicia sesión real para crear plantillas del workspace' : 'Crear plantilla'}
            >
              <Plus className="h-3.5 w-3.5" /> Nueva plantilla
            </Button>
          </div>
        </header>

        {!workspaceId ? (
          <div className="px-4 py-5">
            <EmptyState
              icon={<Sparkles className="h-5 w-5 text-gray-300" />}
              title="Inicia sesión real para editar plantillas"
              description="Las plantillas del workspace se guardan en workspace_templates con RLS. En modo demo sólo verás el catálogo base."
            />
          </div>
        ) : loading ? (
          <div className="flex items-center justify-center gap-2 px-4 py-6 text-xs text-gray-400">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Cargando plantillas…
          </div>
        ) : visibleRows.length === 0 ? (
          <div className="px-4 py-5">
            <EmptyState
              icon={<Sparkles className="h-5 w-5 text-gray-300" />}
              title="Aún no hay plantillas del workspace"
              description="Crea una plantilla con &quot;Nueva plantilla&quot; o duplica una del catálogo base de abajo."
              action={
                <Button variant="primary" size="sm" onClick={() => { setEditing(null); setDrawerOpen(true) }}>
                  <Plus className="h-3.5 w-3.5" /> Nueva plantilla
                </Button>
              }
            />
          </div>
        ) : (
          <ul className="divide-y divide-gray-50">
            {visibleRows.map((row) => (
              <li key={row.id} className="flex items-start gap-3 px-4 py-3 hover:bg-indigo-50/30">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <p className="truncate text-sm font-semibold text-gray-900">{row.name}</p>
                    <span className="rounded-full border border-indigo-100 bg-indigo-50 px-1.5 py-0.5 text-[10px] font-medium text-indigo-700">
                      del workspace
                    </span>
                    <span className="rounded-full border border-gray-100 bg-gray-50 px-1.5 py-0.5 text-[10px] text-gray-600">
                      {row.type}
                    </span>
                    {row.channel && (
                      <span className="rounded-full border border-gray-100 bg-gray-50 px-1.5 py-0.5 text-[10px] text-gray-600">
                        {row.channel}
                      </span>
                    )}
                    <span className="rounded-full border border-gray-100 bg-gray-50 px-1.5 py-0.5 text-[10px] text-gray-600">
                      {row.vertical}
                    </span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-[11px] leading-snug text-gray-500">{row.content}</p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={() => { setEditing(row); setDrawerOpen(true) }}
                    title="Editar"
                    className="flex h-7 w-7 items-center justify-center rounded-md text-gray-400 hover:bg-indigo-50 hover:text-indigo-600"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleArchive(row)}
                    title="Archivar (sin DELETE)"
                    className="flex h-7 w-7 items-center justify-center rounded-md text-gray-400 hover:bg-rose-50 hover:text-rose-600"
                  >
                    <Archive className="h-3.5 w-3.5" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Base catalog (read-only) */}
      <section className="rounded-2xl border border-gray-100 bg-white">
        <header className="flex items-center justify-between gap-2 border-b border-gray-100 px-4 py-3">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-gray-900">Catálogo base</h3>
            <Badge variant="default" dot>{baseRows.length}</Badge>
          </div>
          <span className="text-[11px] text-gray-500">Plantillas predefinidas — duplica para editar.</span>
        </header>
        <ul className="grid gap-2 p-3 sm:grid-cols-2">
          {baseRows.map((tmpl) => (
            <li key={tmpl.id} className="rounded-xl border border-gray-100 bg-white p-3 hover:bg-gray-50">
              <div className="flex items-center justify-between gap-2">
                <p className="truncate text-sm font-medium text-gray-900">{tmpl.title}</p>
                <span className="rounded-full border border-gray-100 bg-gray-50 px-1.5 py-0.5 text-[10px] font-medium text-gray-600">
                  {tmpl.channel}
                </span>
              </div>
              <p className="mt-1 line-clamp-3 text-[11px] leading-snug text-gray-500">{tmpl.body}</p>
              <button
                type="button"
                disabled={!workspaceId}
                onClick={() => {
                  setEditing({
                    id: '',
                    workspace_id: workspaceId ?? '',
                    type: 'message',
                    vertical: tmpl.vertical,
                    name: tmpl.title,
                    channel: tmpl.channel === 'any' ? null : tmpl.channel,
                    content: tmpl.body,
                    status: 'active',
                    metadata: { duplicated_from: tmpl.id },
                    created_at: '',
                    updated_at: '',
                  })
                  setDrawerOpen(true)
                }}
                className="mt-2 text-[11px] font-semibold text-indigo-600 hover:text-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
                title={!workspaceId ? 'Inicia sesión real para duplicar' : 'Duplicar al workspace'}
              >
                Duplicar al workspace →
              </button>
            </li>
          ))}
        </ul>
      </section>

      <TemplateDrawer
        open={drawerOpen}
        mode={editing && editing.id ? 'edit' : 'create'}
        workspaceId={workspaceId}
        initial={editing && editing.id ? editing : editing /* duplicate flow uses initial but creates */ }
        defaultVertical={defaultVerticalForCreate}
        onClose={() => { setDrawerOpen(false); setEditing(null) }}
        onSaved={(row) => {
          // For both create and edit, replace or prepend.
          setRows((prev) => {
            const exists = prev.some((r) => r.id === row.id)
            if (exists) return prev.map((r) => (r.id === row.id ? row : r))
            return [row, ...prev]
          })
        }}
      />
    </div>
  )
}
