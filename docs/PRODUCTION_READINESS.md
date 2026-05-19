# NowCRM / NowLabs AI — Production Readiness

Estado de la rama `final-functional-polish` tras el **cierre quirúrgico**
(n8n trigger seguro, Meta webhook server-side, dedupe inbound, outbound
persistido, config status integrado).

## 0. Resumen ejecutivo — qué falta para producción

| Ítem                                            | Estado | Quién |
| ----------------------------------------------- | :----: | ----- |
| Código de cierre WhatsApp/Inbox/Meta/n8n        | ✅     | hecho |
| Lint / tsc / build verdes                       | ✅     | hecho |
| Crear cuenta Meta Business real (no "Now AI")   | ⏳     | usuario |
| Generar tokens Meta (`META_*`, `NOWCRM_*`)      | ⏳     | usuario |
| Configurar variables en Vercel                  | ⏳     | usuario |
| URL pública (Vercel domain o tunel para test)   | ⏳     | usuario |
| Registrar webhook en Meta Developers            | ⏳     | usuario |
| Probar primer mensaje real                      | ⏳     | usuario |
| Auto-reply OFF                                  | ✅     | default |
| Conexión n8n MCP                                | ❌     | fase posterior — no antes de probar todo lo anterior |

**No hacer deploy hasta haber validado los 4 ítems con ⏳ contra Meta real.**

## 1. Variables de entorno requeridas (solo nombres)

```
# Supabase
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY        # o NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
SUPABASE_SERVICE_ROLE_KEY             # server-only, nunca al cliente

# Google Calendar
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
GOOGLE_REDIRECT_URI

# Meta WhatsApp Cloud API
META_WEBHOOK_VERIFY_TOKEN             # UUID generado por ti, registrado en Meta
META_APP_SECRET                       # obligatorio en producción (HMAC X-Hub-Signature-256)
META_WHATSAPP_ACCESS_TOKEN            # System User token (no temporal). Server-only.
META_GRAPH_VERSION                    # opcional, default v21.0

# n8n
N8N_BASE_URL
N8N_API_KEY
N8N_WEBHOOK_SECRET
N8N_DEFAULT_TIMEOUT_MS

# OpenAI / NowLabs AI
OPENAI_API_KEY
NOWLABS_MODEL                         # opcional override

# Forwarding interno
NOWCRM_WEBHOOK_SECRET                 # Meta → /api/inbox/whatsapp/inbound
AGENT_TOOL_SECRET                     # opcional, para /api/agent/tool desde n8n
NEXT_PUBLIC_APP_URL                   # base URL pública
```

`.env.local` está ignorado por git. Nunca commitear valores.

## 1.bis Migraciones añadidas en fase WhatsApp/Inbox (2026-05-17)

- `inbox_performance_indices` (idempotente):
  - `conversations(workspace_id, updated_at DESC)`
  - `conversations(workspace_id, channel, status)`
  - `conversations(client_id) WHERE client_id IS NOT NULL`
  - `messages(conversation_id, created_at)`
  - `messages(workspace_id, created_at DESC)`
  - `activities(workspace_id, created_at DESC)`
  - `clients(workspace_id, phone) WHERE phone IS NOT NULL`

## 2. Migraciones Supabase aplicadas en esta fase

- `service_role_grants_and_policies_hardening` (idempotente):
  - GRANT CRUD para `service_role` en: clients, invoices, whatsapp_connections,
    activities, conversations, messages, tasks, agent_action_logs,
    n8n_trigger_logs, inbox_agent_settings.
  - Policy `service_role_full_access` en: invoices, calendar_events, tasks,
    agent_action_logs, n8n_trigger_logs, inbox_agent_settings.
  - El resto ya tenían policy.

## 3. Cambios de código relevantes

### Google Calendar
- `cancel-event` ahora trata `204`, `404` y `410 Gone` como éxito.
- `cancel-event` y `update-event` bloquean eventos con `is_read_only=true`
  y devuelven `reason: 'read_only_event'` en vez de tocar Google.

### Google Calendar — cancelación atómica (rev. 2026-05-17)
- **Bug arreglado**: cancelar desde Calendar UI / Assistant no eliminaba el evento en Google.
- Causa: la UI hacía soft-cancel local y luego llamaba Google como `void fetch` (fire-and-forget).
  Si el fallback hacía hard-delete, la route no podía leer `google_event_id` y Google nunca recibía DELETE.
- Fix: `cancel-event` ahora es **fuente única**: Google DELETE + local soft-cancel en una sola llamada.
- Contrato JSON estable: `{ ok, localCancelled, googleCancelled, googleAlreadyGone, reason, message, synced }`.
- Multi-calendar: `cancel-event`, `update-event` y `sync-event` ahora usan
  `event.google_calendar_id || conn.default_calendar_id || conn.calendar_id || 'primary'`
  en lugar de saltar directo a `primary`.
- UI y agente reportan resultado real con razón legible (read-only, needs_reconnect,
  google_forbidden, rate_limited, etc.).

### NowLabs AI v2 (`nowlabs-main-agent.ts`)
- `search_calendar_events` selecciona `is_read_only` y lo muestra como
  `[solo lectura]` en la lista.
- `prepare_cancel_booking` y `prepare_reschedule_booking` rechazan eventos
  read-only con mensaje claro: "viene de un calendario de Google de solo
  lectura, lo tengo en cuenta para disponibilidad pero no puedo modificarlo".
- `prepare_cancel_multiple_bookings` excluye read-only y avisa de cuántos saltó.
- `prepare_cleanup_duplicates` requiere ≥2 eventos editables tras filtrar
  read-only; el `keep_event_id` ahora se valida contra eventos escribibles.

### n8n
- `/api/n8n/trigger` ya NO devuelve `n8n_response` cruda. Se sanitiza a
  `{ executionId?, messagePreview? }` y se añade `duration_ms`.
- Mapper de `public.n8n_flows`: lee de `trigger_event` y escribe a
  `name / trigger_event / requires_supabase / requires_whatsapp /
  requires_payment_api`. El upsert busca por `(workspace_id, trigger_event)`.

### integrations
- Mapper de `public.integrations`: lee/escribe `provider` (no `key`),
  consolida `description/category/info` dentro de `config` jsonb.

### Meta WhatsApp
- Webhook POST rechaza con 503 si `META_APP_SECRET` no está configurado y
  `NODE_ENV === 'production'`.
- En dev/local, se loggea warning y se acepta sin firma (modo desarrollo).

### WhatsApp CRM (Inbox + Agent) — rev. 2026-05-17
- Nueva página `/inbox` (3 columnas: lista, chat, panel cliente).
- Nuevo helper `src/lib/meta-whatsapp.ts` para envío vía Meta Cloud API
  (`v21.0` por defecto, override con `META_GRAPH_VERSION`). Si falta token o
  phone_number_id, devuelve `pending_config`/`token_missing` y NO falla.
- Nuevo módulo `src/lib/agents/whatsapp-agent.ts` con 5 tareas:
  summarize, classify_intent, detect_sentiment, suggest_reply, full_review.
  Devuelve JSON estricto; jamás auto-envía.
- Nuevas rutas API:
  - `GET /api/inbox/conversations` (paginada, filtrable)
  - `GET /api/inbox/conversations/[id]` (conv + mensajes + cliente)
  - `PATCH /api/inbox/conversations/[id]` (status, sentiment, intent, ai_summary, unread)
  - `POST /api/inbox/conversations/[id]/messages` (draft/send; sanitizada)
  - `POST /api/inbox/agent` (ejecuta tarea agentic, opcional persist)
- Sidebar: añadido enlace `/inbox`.
- Auto-reply queda OFF por defecto en `inbox_agent_settings`.
- Arquitectura completa documentada en `docs/WHATSAPP_AGENT_ARCHITECTURE.md`.

### Google Calendar disconnect — fix (rev. 2026-05-20)
- Nuevo endpoint `POST /api/integrations/google/calendar/disconnect`:
  1. Intenta revocar el refresh_token contra `https://oauth2.googleapis.com/revoke`
     (best-effort — no falla la desconexión si Google está caído o el token ya es inválido).
  2. Limpia con `service_role`: `refresh_token_enc=NULL`, `calendar_id=NULL`,
     `selected_calendar_ids=NULL`, `calendar_metadata=NULL`, `sync_enabled=false`,
     `last_sync_at=NULL`. Mantiene la fila con `status='disconnected'` para auditoría.
  3. Fallback automático a esquema legacy (sin columnas multi-calendar) si detecta `42703`.
- `deriveStatus()` en `/api/integrations/google/calendar/status` ahora maneja
  `status='disconnected'` explícitamente — antes caía al fallback `calendar_id`
  y reportaba `oauth_pending`, que es lo que provocaba el lag visual y los
  reintentos de sync con token viejo.
- `disconnectGoogleCalendar` en `supabase-queries.ts` ahora llama al endpoint
  via `fetch` (la revocación + service_role no son posibles desde el navegador).
- `handleGCalDisconnect` en `/settings`:
  - usa `gcalLoading` para mostrar "Desconectando…" en el botón;
  - re-lee el estado del servidor tras desconectar (no se queda con local stale);
  - el botón queda disabled durante la operación.
- Tipo `GoogleCalendarConnectionStatus` añade `'disconnected'`.

### NowLabs AI — nuevas tools globales (rev. 2026-05-20)
- `workspace_overview` — resumen ejecutivo cross-vertical en una sola pasada
  paralela: clientes (total/activos/leads/hot) + oportunidades abiertas/ganadas
  + expedientes abiertos (con fuera de plazo) + propiedades activas + facturas
  pendientes/vencidas + citas próximas + tareas pendientes + conversaciones
  Inbox abiertas. Limita cada query a 300-500 filas para latencia razonable.
- `list_pending_items` — consolida en bloque todo lo que requiere atención:
  facturas vencidas + facturas pendientes + tareas + citas próximas +
  expedientes (con conteo fuera de plazo) + conversaciones abiertas. Cada
  sección con 5 ejemplos visibles y conteo total.
- `summarize_inbox_status` — total/abiertas/negativas + desglose por canal.
- Sistema prompt actualizado con rutas 17b/17c/17d para que el LLM elija
  estas tools en lugar de las antiguas cuando aplique.
- Pre-router intacto: las nuevas tools llegan via OpenAI tool-calling (el
  agente decide), no via regex matching.

### Schema-aware fixes
- `getWhatsappConnection` selecciona `connection_status` (no `status`).
- `upsertWhatsappConnection` escribe `connection_status`.
- `disconnectWhatsapp` actualiza `connection_status='disconnected'`.
- `getInboxAgentSettings` selecciona columnas reales (enabled, mode,
  agent_name, handoff_enabled, business_context, tone).
- `upsertInboxAgentSettings` escribe `enabled` (no `status`).

### Vertical Pack v1 — UI humana (rev. 2026-05-18, Prompt B)
- `/opportunities` renombrada a **Operaciones** en sidebar y header. Subtabs
  (Pipeline / Expedientes / Propiedades / Plantillas / Automatizaciones) +
  drawers de creación + inline status edit + actividad por workspace.
- Nueva primitiva `src/components/SideDrawer.tsx` (overlay, ESC, scroll-lock)
  reutilizada por todos los drawers verticales.
- Drawers de creación en `src/components/VerticalForms.tsx` —
  `NewOpportunityDrawer`, `NewServiceCaseDrawer`, `NewPropertyDrawer`.
  Cada uno usa los mismos helpers (con activity log) que crean entidades
  via `vertical-queries.ts`. Activity tagged `metadata.source = 'ui_manual'`.
- `vertical-queries.ts` ampliado con `updateServiceCaseStatus`,
  `updatePropertyStatus`, `getClientVerticalSummary` y log a `activities`
  paralelo al agente.
- Cliente 360 (`src/components/Client360Drawer.tsx`) — drawer agregador con
  oportunidades / expedientes / propiedades / conversaciones / facturas /
  próximas citas / actividad. CTAs abren drawers de creación con
  `defaultClientId`+`defaultClientName` pre-cargados.
- `/clients`: icono Eye en cada fila abre el Cliente 360.
- `/inbox`: en el panel derecho de la conversación, botón "Crear oportunidad
  desde esta conversación" — abre el drawer con `client_id` y `source` del
  canal pre-rellenos.
- `/automations`: nueva sección "Automatizaciones verticales preparadas"
  arriba del banner amarillo. Lista las 10 entradas del catálogo con badge
  "Preparada" y botón disabled "Activar cuando n8n esté conectado".
- `/dashboard`: las 3 quick-link cards leen counts reales de
  `opportunities`, `service_cases` y `properties`.
- `/settings`: card "Vertical del workspace" con 5 opciones, persistencia en
  `localStorage` mientras no exista `workspace_settings` en Supabase.

**Coexistencia UI ↔ NowLabs AI**: las herramientas verticales del agente
ejecutan cambios tras confirmación verbal en chat; los drawers de UI son el
camino manual equivalente. Ambos convergen sobre las mismas tablas con
RLS y dejan el mismo tipo de activity (cambia `metadata.source`).

### Vertical Pack v1 — NowLabs AI tools (rev. 2026-05-18)
- Nuevo helper server-side `src/lib/vertical-server.ts` con list / create /
  updateStage / updateStatus para `opportunities`, `service_cases` y
  `properties`. Workspace-scoped, RLS-aware, jamás lanza al cliente.
- Cada escritura confirmada apuntla `activities` con `metadata.source =
  'nowlabs_agent'` y `type` específico (`opportunity_created`,
  `opportunity_stage_updated`, `service_case_created`,
  `service_case_status_updated`, `property_created`,
  `property_status_updated`).
- `nowlabs-main-agent.ts` pasa de 19 a 28 tools: añade 3 lecturas
  (`list_opportunities`, `list_service_cases`, `list_properties`) y 6
  escrituras (`create_opportunity`, `update_opportunity_stage`,
  `create_service_case`, `update_service_case_status`, `create_property`,
  `update_property_status`).
- Diseño deliberado: las escrituras NO usan prepared-action cards. El
  agente confirma verbalmente en chat ("¿La creo?" → "sí" → tool fires)
  para no inflar `src/app/(saas)/assistant/page.tsx` (3 198 líneas). Toda
  la confirmación vive en el system prompt y en la respuesta natural del
  modelo. Una orden inequívoca con todos los datos puede crear sin doble
  confirmación.
- Sin cambios en API route ni en `assistant/page.tsx`: la respuesta del
  agente para una tool de escritura llega como `answer` regular.

## 4. Checklist de demo / producción

### Antes de la demo
- [ ] `/api/debug/auth-session` devuelve `hasUser:true` y un `workspaceId` real.
- [ ] `/api/debug/google-calendar-connection` devuelve `hasConnection:true` y `hasRefreshToken:true`.
- [ ] Página `/calendar` muestra header de Google conectado.
- [ ] Modal de calendarios deja seleccionar varios sin error.
- [ ] Importación re-ejecutada no duplica (dedup por `google_calendar_id + google_event_id`).
- [ ] NowLabs AI crea/cancela/reprograma cita y se ve reflejado en Google.
- [ ] Eventos read-only no se editan ni desde UI ni desde NowLabs AI.

### Antes de producción
- [ ] `META_APP_SECRET` configurado.
- [ ] Webhook Meta registrado en Meta Business Manager.
- [ ] HTTPS público obligatorio para webhooks Google y Meta.
- [ ] `NOWCRM_WEBHOOK_SECRET` rotado y compartido con n8n.
- [ ] `SUPABASE_SERVICE_ROLE_KEY` solo en el host server-side.
- [ ] `refresh_token_enc` cifrado real en vez de plaintext (riesgo abierto, ver §5).
- [ ] Lint / tsc / build verdes (esta fase: ✅).
- [ ] Probar test de WhatsApp inbound desde Settings.

### Antes de demo con clientes del Vertical Pack
- [ ] `/opportunities` carga con datos reales del workspace (sin flash demo
      para usuarios autenticados).
- [ ] NowLabs AI crea oportunidad, expediente y propiedad pidiendo
      confirmación verbal antes de cada escritura.
- [ ] El operador entiende que una orden inequívoca ("crea ya la
      oportunidad…") ejecuta sin segunda confirmación.
- [ ] Cambiar stage / status de las 3 entidades funciona vía NowLabs.
- [ ] Las activities quedan asentadas con `metadata.source='nowlabs_agent'`.

### Fase E — Workspace Settings + Plantillas editables + Automations preparadas (rev. 2026-05-18)

- Tablas Supabase añadidas (idempotentes, RLS workspace-scoped, policies
  separadas para `authenticated` y `service_role`):
  - `public.workspace_settings(workspace_id UNIQUE, vertical, business_name,
    default_language, timezone, ai_tone, auto_reply_enabled, metadata)`.
  - `public.workspace_templates(workspace_id, type, vertical, name, channel,
    content, status, metadata)` — sin DELETE, archivar con `status='archived'`.
  - Índices: `workspace_settings(vertical)`,
    `workspace_templates(workspace_id, updated_at DESC)`,
    `workspace_templates(workspace_id, type)`,
    `workspace_templates(workspace_id, vertical)`.

- Cliente nuevo:
  - `src/lib/workspace-settings.ts` — get/upsert por workspace + helpers
    `readLocalVertical / writeLocalVertical` como fallback.
  - `src/lib/workspace-templates.ts` — list / create / update / archive.
  - `src/components/WorkspaceTemplatesPanel.tsx` — UI editable que convive
    con el catálogo base `MESSAGE_TEMPLATES`. Sin DELETE (archive). Sin
    workspace real, sólo muestra el catálogo base (empty state honesto).

- `VerticalPreferenceCard` ahora lee/escribe `workspace_settings`. El badge
  refleja la persistencia real:
  - **Guardado en workspace** (Cloud) — persistencia multi-dispositivo OK.
  - **Guardado localmente** (HardDrive) — no se pudo escribir Supabase.
  - **Sin guardar todavía**.

- `/opportunities` subtab "Plantillas" usa `WorkspaceTemplatesPanel` en
  vez del catálogo estático recortado.

- `/automations`:
  - Leyenda de 3 categorías arriba (CRM interno · Vertical Pack ·
    Integraciones pendientes).
  - Vertical Pack: cada card muestra ahora el `triggerEvent` (chip mono).
  - Sección nueva "Contrato n8n" con accordion mostrando el payload JSON
    que NowCRM enviará; remite a `docs/N8N_PAYLOAD_CONTRACT.md`.
  - Sin nuevas llamadas a n8n real. Botones de Vertical Pack siguen disabled.

- NowLabs AI / Settings: pendiente para fase posterior leer
  `workspace_settings` (vertical, ai_tone, default_language,
  auto_reply_enabled). `auto_reply_enabled` queda en false hasta que las
  integraciones reales estén operativas.

#### Qué sigue antes del VPS
- Probar end-to-end el guardado de `workspace_settings` con un usuario real.
- Decidir si NowLabs AI v2 debe leer `ai_tone` y `default_language` antes
  o después del VPS.
- Sacar la decisión de quién puede editar plantillas (owner vs operadores)
  y si conviene un campo `created_by` en `workspace_templates`.

#### Qué sigue después del VPS
- Activar workflows n8n reales (Vertical Pack toggle "Activar cuando n8n
  esté conectado" pasa a permitirlo).
- Cuando Meta WhatsApp esté live, encender `auto_reply_enabled` por workspace.
- Auditar `workspace_templates` con datos reales para detectar duplicados
  contra el catálogo base.

#### Qué puede demostrar Andrei hoy
- Ir a `/settings`, cambiar el vertical, recargar, ver el badge "Guardado en
  workspace" y el cambio persistido.
- En `/opportunities → Plantillas`, crear / duplicar / editar / archivar
  plantillas del workspace conviviendo con el catálogo base.
- En `/automations`, mostrar la leyenda de las tres categorías, abrir el
  accordion "Contrato n8n" para enseñar el payload exacto que llegará al
  partner técnico una vez se monte el VPS.

## 5. Riesgos abiertos

- **`google_calendar_connections.refresh_token_enc`** se guarda en plaintext.
  Marcar como rotar cuando se mueva el secreto a Supabase Vault o similar.
- **`integrations.config`** ahora vive como jsonb; consumidores antiguos
  podrían no leer `description/category/info` desde ahí. Validar página
  Settings tras desplegar.
- **n8n `description` column**: no existe en schema real. Se descarta en el
  upsert. Si se necesita persistir, añadir migración.
- **Whapi**: no se usa. Cualquier referencia residual debe eliminarse antes
  de producción.

## 6. Pruebas manuales — ver final del prompt de hardening
