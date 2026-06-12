# Plan del Asistente IA — CRM Inmobiliario Demo

## Objetivo

Preparar un agente IA tipo empleado del CRM que pueda consultar y ejecutar acciones controladas en el CRM desde `/api/assistant/v2`, OpenAI server-side y tools backend seguras.

Arquitectura:

```text
UI Asistente IA
  -> POST /api/assistant/v2
  -> OpenAI Responses API opcional
  -> tools backend allowlist
  -> Supabase guarda/consulta desde servidor
  -> devuelve respuesta y preparedAction
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

Gestiona conversaciones con clientes/leads. Es la capa preparada para WhatsApp Business Platform oficial (Meta Cloud API): mensajes entrantes, intención, sentimiento, respuestas sugeridas y conversión de conversaciones en acciones.

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

## Como conectar n8n como brazo externo

1. Crear workflow en n8n.
2. Recibir evento desde `/api/n8n/trigger` o desde un Webhook.
3. Usar nodo HTTP Request.
4. Metodo: `POST`.
5. URL: `https://tu-dominio.com/api/agent/tool`.
6. Header opcional: `x-nowcrm-secret`.
7. Body JSON con `tool`, `workspace_id`, `input`, `metadata`.
8. Usar `result` para workflows externos. n8n no debe ser el cerebro de Asistente IA.

## Assistant Agent real

Flujo actual:

```text
/assistant
  -> POST /api/assistant/v2
  -> OpenAI Responses API si OPENAI_AGENT_ENABLED=true
  -> tools backend seguras
  -> el CRM devuelve respuesta y preparedAction
```

La API key de OpenAI vive solo en el backend del CRM. n8n queda reservado para WhatsApp, email, PDFs, recordatorios y workflows externos.

## Storage / Documents readiness

Supabase Storage queda como siguiente fase para propuestas, PDFs de factura y adjuntos de conversaciones. Buckets recomendados:

- `client-files`
- `invoice-pdfs`
- `proposal-pdfs`
- `conversation-attachments`
- `workspace-assets`

El CRM debe indexar esos archivos en una tabla `documents` con `workspace_id`, `client_id`, `storage_bucket`, `storage_path`, `mime_type` y `size`. Las tools futuras deben crear primero el archivo en Storage y después registrar el documento.

## OpenAI server-side en Asistente IA

Prompt recomendado:

```text
Eres el empleado IA del CRM.
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

1. `/api/assistant/v2` es el flujo real principal del asistente (la ruta legacy `/api/assistant/chat` se eliminó).
2. Conectar Meta Cloud API para Inbox Assistant.
3. Permitir que OpenAI use tools backend allowlist.
4. Revisar `/api/agent/tool` antes de exponerlo a n8n real.
5. Crear buckets Storage y tabla `documents`.
6. Añadir tools de documentos/PDFs.
