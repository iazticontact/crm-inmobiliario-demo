# NowCRM WhatsApp inbound contract

Objetivo: recibir mensajes de WhatsApp Business Platform oficial (Meta Cloud API) por n8n y guardarlos en NowCRM Inbox sin auto-responder ni ejecutar acciones CRM.

## Endpoint NowCRM

`POST {{NOWCRM_BASE_URL}}/api/inbox/whatsapp/inbound`

Runtime esperado: backend Next.js en Node.js. El `service_role` vive solo en NowCRM backend.

## Headers

Para n8n/Meta Cloud API:

```http
Content-Type: application/json
x-nowcrm-webhook-secret: {{NOWCRM_WEBHOOK_SECRET}}
```

Para simulacion desde Settings:

```http
Content-Type: application/json
Authorization: Bearer <supabase_access_token>
```

No pongas `SUPABASE_SERVICE_ROLE_KEY` en n8n. n8n solo usa `NOWCRM_WEBHOOK_SECRET`.

## Payload normalizado

```json
{
  "workspaceId": "workspace-id",
  "provider": "meta",
  "phone": "+34600000000",
  "customerName": "Lead WhatsApp",
  "customerEmail": "lead@example.com",
  "message": "Hola, quiero informacion.",
  "externalConversationId": "meta-phone-or-conversation-id",
  "externalMessageId": "wamid-message-id",
  "timestamp": "2026-05-13T09:00:00.000Z",
  "metadata": {
    "source": "n8n_meta_cloud_api",
    "rawProvider": "meta"
  }
}
```

`workspaceId` es obligatorio para simulacion con usuario. Para n8n puede venir en payload o resolverse por `whatsapp_connections.phone_number`.

## Respuesta OK

```json
{
  "ok": true,
  "workspaceId": "workspace-id",
  "conversationId": "conversation-id",
  "messageId": "message-id",
  "mode": "stored_only",
  "autoReply": false,
  "authMode": "webhook_secret",
  "provider": "meta",
  "phone": "+34600000000"
}
```

`autoReply` siempre queda en `false` en esta fase.

## Errores

```json
{
  "ok": false,
  "step": "create_message",
  "error": "Error guardando message inbound.",
  "message": "Error guardando message inbound.",
  "code": "PGRST204",
  "details": "...",
  "hint": "..."
}
```

Steps relevantes:

- `parse_payload`: JSON invalido.
- `validate_payload`: faltan `provider`, `phone`, `message` o `workspaceId` cuando toca.
- `server_config`: falta configuracion server-only en NowCRM backend.
- `authorize_request`: no hay secret valido ni Bearer.
- `validate_user_token`: JWT de Supabase invalido o expirado.
- `authorize_workspace`: el usuario no pertenece al workspace.
- `resolve_workspace`: no se pudo resolver workspace.
- `find_conversation`: fallo buscando conversacion existente.
- `create_conversation`: fallo creando conversacion.
- `update_conversation`: fallo no bloqueante, solo log en development.
- `create_message`: fallo guardando el mensaje, bloqueante.
- `create_activity`: best-effort, no bloquea.

## Meta Cloud API -> n8n -> NowCRM

Variables en n8n:

- `NOWCRM_BASE_URL`
- `NOWCRM_WEBHOOK_SECRET`
- `NOWCRM_WORKSPACE_ID`

Flujo:

1. Webhook n8n recibe payload oficial de Meta Cloud API.
2. Nodo Code normaliza `phone`, `message`, ids externos y timestamp.
3. HTTP Request llama a NowCRM con `x-nowcrm-webhook-secret`.
4. NowCRM guarda `conversations` + `messages`.
5. Inbox Assistant muestra la conversacion en modo manual.

## Prueba local

Usa un tunel publico para exponer el dev server si n8n esta fuera de tu maquina. Configura:

```text
NOWCRM_BASE_URL=https://tu-tunel-publico
NOWCRM_WEBHOOK_SECRET=<mismo valor que en NowCRM backend>
NOWCRM_WORKSPACE_ID=<workspace real>
```

No copies claves Supabase ni tokens Meta en NowCRM frontend.

## Outbound futuro

Estado actual: preparado a nivel de producto, no conectado a Meta real.

Flujo previsto:

```text
Operador en Inbox
-> mensaje outbound guardado en NowCRM
-> n8n recibe whatsapp_outbound_requested
-> Meta Cloud API envia el WhatsApp
-> NowCRM actualiza deliveryStatus
```

Mientras no exista el workflow outbound, los mensajes manuales del Inbox se tratan como `local_pending`; no se debe mostrar como enviado por WhatsApp real.
