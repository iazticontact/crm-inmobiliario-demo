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
- Persiste cada mensaje **server-side llamando directamente a `processInboundWhatsAppMessage`**
  desde `src/lib/whatsapp-inbound.ts`. No hay `fetch` interno, no se depende de
  `NEXT_PUBLIC_APP_URL`. Tipos soportados: texto, imagen, audio, video, documento,
  sticker, ubicación, contactos, botones y reacciones (los no-texto se guardan
  como placeholder en español tipo `[nota de voz]`, `[imagen] caption…`).
- `value.statuses` (delivered/read) se cuenta pero todavía no patchea el outbound.

### 2. Inbound handler (HTTP bridge para simulador/legacy)

**Ruta:** `src/app/api/inbox/whatsapp/inbound/route.ts`

- Existe para el simulador de Settings y como puente HTTP server-to-server con
  un secreto interno (`NOWCRM_WEBHOOK_SECRET`). El webhook de Meta NO lo usa
  (llama al helper directamente).
- Comparte exactamente la misma lógica que el webhook gracias al helper
  `processInboundWhatsAppMessage`: dedupe por `externalMessageId`, link por
  teléfono al cliente, escritura de `metadata` en el mensaje y conversación.
- Actualiza `whatsapp_connections.last_webhook_at` en cada inbound real.
- **Nunca** auto-responde.

### 3. Inbox UI — **solo canales externos**

**Página:** `src/app/(saas)/inbox/page.tsx`

> El Inbox es exclusivamente la bandeja de entrada de **mensajes reales de
> clientes desde canales externos**. Las conversaciones internas con NowLabs
> Copilot/Assistant viven en `/assistant` y el dashboard. El API
> `/api/inbox/conversations` excluye CRM internal por defecto
> (`?includeInternal=1` para opt-in en debugging).

- 3 columnas: lista / chat / panel cliente compacto.
- **Tabs externos (channelType)** — definidos en `src/lib/inbox-classify.ts`:
  - **Todos** (default) → cualquier canal externo: WhatsApp / Instagram / Web / Email / unknown.
  - **WhatsApp** → solo `channelType='whatsapp'`. Real si source = `meta_cloud_api`.
  - **Instagram** → preparado, pendiente de conectar (`future:true`).
  - **Web** → conversaciones del chat web / formularios.
  - **Email** → integración Gmail/Email futura (`future:true`).
- Filtros secundarios: status (open/pending/resolved/archived).
- Composer: **"Enviar"** se reemplaza por **"Guardar borrador"** cuando el
  canal no está conectado (config Meta no ready). Nunca dice "Enviado" si no
  hay envío real.
- Botones IA: Sugerir respuesta, Resumir, Clasificar intención, Detectar
  sentimiento, Análisis completo.
- Mensajes con `metadata.source` interno (Copilot/Assistant) se renderizan
  centrados como *system note*, no como burbuja de WhatsApp. Aunque por
  defecto el Inbox ya filtra esos hilos en el API.
- Mensajes con `metadata.source` interno (Copilot/Assistant) se renderizan
  centrados como *system note*, no como burbuja de WhatsApp, para que nunca se
  confundan con un mensaje real del cliente.

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

## Reparto de responsabilidades con n8n

- **NowLabs WhatsApp Agent** (este módulo) es el **cerebro** del Inbox: resume,
  clasifica, sugiere y prepara borradores. Vive dentro de NowCRM y habla con
  OpenAI server-side.
- **n8n** es solo el **brazo externo** de automatización: recordatorios,
  follow-ups, resumen diario, avisos por email, integraciones externas. n8n
  NUNCA decide la respuesta a un cliente y NUNCA llama a OpenAI por NowCRM.
- El cliente de NowCRM pulsa "Enviar" o "Borrador". El agente nunca envía solo,
  salvo que `inbox_agent_settings.auto_reply_enabled = true` AND `enabled = true`
  AND Meta verificado, que es opt-in por workspace y se debería activar solo
  después de validación manual durante al menos una semana.

## Riesgos restantes

- **Refresh tokens Meta** (long-lived system user tokens): no se rotan automáticamente. Documentar en operations.
- **Sin tests automatizados** del agente. Las respuestas dependen de OpenAI.
- **Multimedia**: texto, imagen, audio, video, documento, sticker, ubicación,
  contactos, botones y reacciones se persisten con placeholder. El operador ve
  que llegó algo, pero NowCRM todavía no descarga el contenido binario.
- **Rate limit Meta**: el agente no implementa backoff exponencial; la UI muestra `rate_limited` al usuario.
- **Auto-reply**: requiere validación manual antes de cualquier campaña real.
- **Status updates (delivered/read)**: el webhook los cuenta pero no actualiza
  todavía `metadata.send_status` de la fila outbound. Mejora futura.
