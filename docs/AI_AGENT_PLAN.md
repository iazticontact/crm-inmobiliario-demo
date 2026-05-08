# NowCRM AI Agent Plan

## Objetivo

Preparar un agente IA tipo empleado del CRM que pueda consultar y ejecutar acciones controladas en NowCRM desde n8n/OpenAI.

Arquitectura:

```text
n8n / OpenAI
  -> POST /api/agent/tool
  -> valida tool, workspace y secreto opcional
  -> ejecuta accion allowlist
  -> Supabase guarda/consulta
  -> devuelve JSON para la IA
```

## Endpoint

`POST /api/agent/tool`

Payload:

```json
{
  "tool": "get_workspace_summary",
  "workspace_id": "workspace-id",
  "input": {},
  "metadata": {
    "source": "n8n",
    "conversation_id": "conversation-id",
    "user_intent": "resumir workspace"
  }
}
```

Respuesta:

```json
{
  "ok": true,
  "tool": "get_workspace_summary",
  "result": {},
  "message": "Resumen del workspace generado."
}
```

## Dos roles de Assistant

### Inbox Assistant / Conversaciones

Gestiona conversaciones con clientes/leads. Es la capa preparada para WhatsApp/Whapi futuro: mensajes entrantes, intención, sentimiento, respuestas sugeridas y conversión de conversaciones en acciones.

### CRM Copilot / Asistente interno

Empleado interno del CRM. El usuario le pide buscar clientes, resumir cuentas, preparar citas, crear facturas con confirmación, revisar cobros, proponer próximas acciones y preparar documentos cuando Storage esté listo.

## Tools disponibles por categoria

### Lectura segura

- `get_workspace_summary`
- `search_clients`
- `get_client_summary`
- `get_client_detail`
- `list_invoices`
- `list_calendar_events`
- `list_conversations`
- `get_next_best_actions`

### Escritura con confirmacion

- `create_client`
- `update_client`
- `create_invoice`
- `mark_invoice_paid`
- `create_calendar_event`
- `save_message`
- `create_activity`

### Futuras tools con Storage

- `create_proposal_document`
- `generate_invoice_pdf`
- `attach_file_to_client`
- `list_client_documents`

## Seguridad

- No existe SQL libre.
- Solo se ejecutan tools allowlist.
- `workspace_id` es obligatorio.
- No se devuelven secretos.
- No se expone service role al cliente.
- `SUPABASE_SERVICE_ROLE_KEY` es opcional y SERVER ONLY.
- Si existe service role, las tools de escritura requieren `x-nowcrm-secret`.
- El secreto puede venir de `AGENT_TOOL_SECRET` o `N8N_WEBHOOK_SECRET`.
- Si no hay acceso real, la API devuelve fallback seguro.

## Como conectarlo con n8n

1. Crear workflow en n8n.
2. Recibir evento desde `/api/n8n/trigger` o desde un Webhook.
3. Usar nodo HTTP Request.
4. Metodo: `POST`.
5. URL: `https://tu-dominio.com/api/agent/tool`.
6. Header opcional: `x-nowcrm-secret`.
7. Body JSON con `tool`, `workspace_id`, `input`, `metadata`.
8. Usar `result` para alimentar OpenAI o decidir siguiente accion.

## Assistant Agent real conectado

Primer workflow real:

```txt
NowCRM - Assistant Agent
https://workspacetemporalnowlabs-n8n.hvdnby.easypanel.host/webhook/nowcrm-assistant-agent
```

Flujo actual:

```text
/assistant
  -> guarda mensaje user en Supabase
  -> busca flujo assistant_message activo
  -> POST /api/n8n/trigger
  -> n8n llama OpenAI
  -> n8n devuelve suggested_response
  -> NowCRM guarda mensaje assistant
```

NowCRM no contiene la API key de OpenAI. La clave vive solo en n8n Credentials.

## Storage / Documents readiness

Supabase Storage queda como siguiente fase para propuestas, PDFs de factura y adjuntos de conversaciones. Buckets recomendados:

- `client-files`
- `invoice-pdfs`
- `proposal-pdfs`
- `conversation-attachments`
- `workspace-assets`

El CRM debe indexar esos archivos en una tabla `documents` con `workspace_id`, `client_id`, `storage_bucket`, `storage_path`, `mime_type` y `size`. Las tools futuras deben crear primero el archivo en Storage y después registrar el documento.

## OpenAI dentro de n8n

Prompt recomendado:

```text
Eres el empleado IA de NowCRM.
Puedes pedir herramientas internas via /api/agent/tool.
No inventes datos. Si falta informacion, usa get_workspace_summary, search_clients o get_client_detail.
Cuando propongas una accion, devuelve JSON con tool, input y explicacion.
```

Ejemplos de usuario:

- "Crea una factura de 299 EUR para Ana Rodriguez por Plan Pro"
- "Resume este cliente"
- "Que clientes deberia contactar hoy"
- "Agenda una llamada manana a las 10"
- "Marca esta factura como pagada"

## Proximos pasos

1. Mantener `assistant_message` como workflow real.
2. Conectar Whapi para Inbox Assistant.
3. Permitir que OpenAI decida tool + input en n8n.
4. Ejecutar tool con `x-nowcrm-secret`.
5. Crear buckets Storage y tabla `documents`.
6. Añadir tools de documentos/PDFs.
