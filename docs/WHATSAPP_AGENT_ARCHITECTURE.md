# NowLabs WhatsApp Agent — Arquitectura

Esta es la pieza que el producto vende: una IA real que vive dentro del Inbox de
NowCRM, lee las conversaciones de WhatsApp y ayuda a responder sin enviar nada
sin permiso humano.

## Pieza por pieza

```
Cliente WhatsApp
      │
      ▼
Meta Cloud API (oficial)
      │  POST firmado HMAC
      ▼
/api/integrations/meta/whatsapp/webhook        ← verificación + firma
      │  fan-out interno
      ▼
/api/inbox/whatsapp/inbound                   ← service_role; resuelve workspace por phone_number_id
      │
      ▼
Supabase                                       ← conversations + messages + activities
      ▲   ▲
      │   │
/inbox UI│  /api/inbox/conversations[/...]    ← lista, detalle, status, send
      │
      ▼
NowLabs WhatsApp Agent (src/lib/agents/whatsapp-agent.ts)
      │  resume / clasifica / sugiere
      ▼
OpenAI Responses API                          ← solo server-side; nunca recibe tokens del cliente
      │
      ▼
Decisión sanitizada                            ← UI muestra borrador; humano confirma
```

## Componentes

### 1. Webhook (Meta → NowCRM)

**Ruta:** `src/app/api/integrations/meta/whatsapp/webhook/route.ts`

- `GET` → responde el `hub.challenge` si `hub.verify_token === META_WEBHOOK_VERIFY_TOKEN`.
- `POST` → verifica `X-Hub-Signature-256` con HMAC-SHA256(`META_APP_SECRET`).
  En `NODE_ENV=production` SIN `META_APP_SECRET` devuelve 503.
- Extrae text/contact/phone_number_id y reenvía a `/api/inbox/whatsapp/inbound`.

### 2. Inbound handler (NowCRM core)

**Ruta:** `src/app/api/inbox/whatsapp/inbound/route.ts`

- Usa `service_role` para resolver workspace por `phone_number_id` o `phone_number`.
- Crea/reutiliza `conversation` y `message`.
- Empuja `activity` si schema lo permite.
- Actualiza `whatsapp_connections.last_webhook_at`.
- **Nunca** auto-responde.

### 3. Inbox UI

**Página:** `src/app/(saas)/inbox/page.tsx`

- 3 columnas: lista / chat / panel cliente.
- Filtros: status (open/pending/resolved/archived) y canal.
- Composer con dos botones: **Enviar** (intenta Meta) y **Borrador** (solo guarda local).
- Botones IA: Sugerir respuesta, Resumir, Clasificar intención, Detectar sentimiento, Análisis completo.

### 4. Inbox API

- `GET  /api/inbox/conversations` → lista (paginada, filtrable).
- `GET  /api/inbox/conversations/[id]` → conversación + últimos 200 mensajes + cliente.
- `PATCH /api/inbox/conversations/[id]` → status, sentiment, intent, ai_summary, unread.
- `POST /api/inbox/conversations/[id]/messages` → envía o draft. Si outbound no
  está configurado, guarda como borrador con `metadata.simulated=true`.
- `POST /api/inbox/agent` → ejecuta tarea agentic. Opcional `persist:true`
  guarda summary/intent/sentiment en la conversación.

### 5. WhatsApp Agent

**Módulo:** `src/lib/agents/whatsapp-agent.ts`

Tareas soportadas:

| Tarea | Devuelve | Persistible |
|---|---|---|
| `summarize` | `summary`, `next_action` | sí (→ ai_summary) |
| `classify_intent` | `intent` ∈ {booking,quote,support,complaint,invoice,followup,sales,other}, `intent_confidence` | sí (→ intent) |
| `detect_sentiment` | `sentiment` ∈ {positive,neutral,negative,urgent} | sí (→ sentiment) |
| `suggest_reply` | `suggested_reply`, `needs_human`, `notes` | no (la UI rellena el composer) |
| `full_review` | todo lo anterior | sí (los tres campos) |

**Reglas duras:**

- No inventa precios ni horarios.
- Si falta dato del CRM → marca `needs_human=true`.
- Si sentimiento es `negative` o `urgent` → fuerza `needs_human=true`.
- No envía mensajes reales. El humano confirma siempre.
- Responde en JSON estricto; safe-parse extrae los campos válidos.

### 6. Outbound helper

**Módulo:** `src/lib/meta-whatsapp.ts`

`sendWhatsAppMessage({ admin, workspaceId, to, body })`:

- Si falta `phone_number_id` → `phone_number_id_missing`.
- Si falta `META_WHATSAPP_ACCESS_TOKEN` (o `META_ACCESS_TOKEN`) → `token_missing`.
- Si OK → llama `POST https://graph.facebook.com/v21.0/{phone_number_id}/messages` con texto.
- Sanitiza respuesta: solo expone `messageId`, nunca el JSON crudo de Meta.
- Reasons: `sent | simulated | pending_config | token_missing | phone_number_id_missing | invalid_recipient | meta_api_error | rate_limited | network_error`.

**Decisión deliberada:** durante el modo nocturno autónomo, el helper queda
preparado pero el route `/api/inbox/conversations/[id]/messages` solo envía si
el usuario pulsa "Enviar" desde la UI. No se dispara nada automáticamente.

### 7. Auto-reply (DESACTIVADO por defecto)

La tabla `inbox_agent_settings` tiene:

- `enabled` (bool, default false)
- `auto_reply_enabled` (bool, default false)
- `handoff_enabled` (bool, default true)

El agente lee estos flags. Para activar respuesta automática se necesitan **ambos**
true y la conexión Meta verificada. Mientras alguno sea false, NowCRM solo
genera borradores que el humano confirma.

## Seguridad

- `META_WHATSAPP_ACCESS_TOKEN` y `META_APP_SECRET` solo server-side, nunca expuestos al cliente.
- `service_role` solo en routes server-side con cookies seguras.
- HMAC obligatorio en producción.
- Workspace guard en TODAS las rutas (auth user → profiles.workspace_id → eq).
- Sanitización: ninguna ruta devuelve la respuesta cruda de Meta ni de OpenAI.
- Agente WhatsApp limita contexto a 20 mensajes más recientes para evitar
  inflación de tokens.

## Variables de entorno (solo nombres)

```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY        # o NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
SUPABASE_SERVICE_ROLE_KEY             # server-only

META_WEBHOOK_VERIFY_TOKEN
META_APP_SECRET                       # obligatorio en producción
META_WHATSAPP_ACCESS_TOKEN            # server-only
META_GRAPH_VERSION                    # opcional, default v21.0

NOWCRM_WEBHOOK_SECRET                 # bridge interno meta-webhook → inbound
OPENAI_API_KEY                        # server-only
NOWLABS_MODEL                         # opcional override
```

## Pruebas manuales prioritarias

1. Webhook GET con token correcto → 200 + challenge.
2. Webhook POST con firma válida → 200, mensaje aparece en /inbox.
3. /inbox lista conversaciones reales (sin mocks en modo real).
4. Click en conversación → mensajes en orden cronológico.
5. Botón "Sugerir respuesta" → composer se rellena con borrador.
6. Botón "Análisis completo" con persist=true → conversación se actualiza con summary/intent/sentiment.
7. Composer + "Borrador" → message creado con `mode: 'draft'`.
8. Composer + "Enviar" sin META_WHATSAPP_ACCESS_TOKEN → toast warning "Guardado como borrador".
9. Cambiar status a "Resuelta" desde el dropdown → se persiste.
10. Cambiar canal en filtro → solo aparecen conversaciones de ese canal.

## Riesgos restantes

- **Refresh tokens Meta** (long-lived system user tokens): no se rotan automáticamente. Documentar en operations.
- **Sin tests automatizados** del agente. Las respuestas dependen de OpenAI.
- **Multimedia**: solo se procesan mensajes `type:'text'`. Audio/image/document llegan pero se ignoran.
- **Rate limit Meta**: el agente no implementa backoff exponencial; la UI muestra `rate_limited` al usuario.
- **Auto-reply**: requiere validación manual antes de cualquier campaña real.
