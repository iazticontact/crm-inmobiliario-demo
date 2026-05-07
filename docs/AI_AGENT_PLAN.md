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

## Tools disponibles

- `get_workspace_summary`
- `search_clients`
- `get_client_summary`
- `get_client_detail`
- `create_client`
- `update_client`
- `create_invoice`
- `mark_invoice_paid`
- `list_invoices`
- `create_calendar_event`
- `list_calendar_events`
- `list_conversations`
- `save_message`
- `create_activity`
- `get_next_best_actions`

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

1. Pasar URL real de n8n.
2. Crear workflow `assistant_message`.
3. Anadir nodo OpenAI dentro de n8n.
4. Permitir que OpenAI decida tool + input.
5. Ejecutar tool con `x-nowcrm-secret`.
6. Devolver `suggested_response` a NowCRM.
