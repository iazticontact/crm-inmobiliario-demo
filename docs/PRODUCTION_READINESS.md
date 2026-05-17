# NowCRM / NowLabs AI — Production Readiness

Estado de la rama `final-functional-polish` tras la fase de hardening final.

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
META_WEBHOOK_VERIFY_TOKEN
META_APP_SECRET                       # obligatorio en producción para HMAC
META_WHATSAPP_PHONE_NUMBER_ID         # opcional, default por workspace
META_WHATSAPP_ACCESS_TOKEN            # solo server-side

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

### Schema-aware fixes
- `getWhatsappConnection` selecciona `connection_status` (no `status`).
- `upsertWhatsappConnection` escribe `connection_status`.
- `disconnectWhatsapp` actualiza `connection_status='disconnected'`.
- `getInboxAgentSettings` selecciona columnas reales (enabled, mode,
  agent_name, handoff_enabled, business_context, tone).
- `upsertInboxAgentSettings` escribe `enabled` (no `status`).

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
