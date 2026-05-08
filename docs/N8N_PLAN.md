# NowCRM n8n Plan

## Estado actual

NowCRM ya tiene una base preparada:

- Catalogo de flujos en `src/lib/integrations.ts`.
- Helper `triggerN8nWebhook()`.
- API route interna `/api/n8n/trigger`.
- Settings muestra URL base, endpoints, estados y prueba de webhook.
- Settings puede cargar/guardar `n8n_flows` e `integrations` si hay workspace real y RLS permite acceso.
- Primer workflow real conectado para Assistant:
  - Nombre: `NowCRM - Assistant Agent`.
  - URL produccion: `https://workspacetemporalnowlabs-n8n.hvdnby.easypanel.host/webhook/nowcrm-assistant-agent`.
  - Evento: `assistant_message`.
  - Respuesta esperada: `suggested_response`.

OpenAI se ejecuta dentro de n8n. NowCRM no guarda ni necesita la API key de OpenAI.

## Eventos estandar

- `new_lead`
- `client_updated`
- `client_deleted`
- `whatsapp_message`
- `assistant_message`
- `conversation_resolved`
- `appointment_booked`
- `calendar_event_created`
- `invoice_created`
- `invoice_paid`
- `invoice_overdue`
- `reengagement_needed`
- `daily_summary`
- `urgent_conversation`
- `test_flow`

## Payload base

```json
{
  "event_type": "assistant_message",
  "workspace_id": "workspace-id",
  "flow_id": "optional-flow-id",
  "source": "nowcrm",
  "mode": "demo|real",
  "timestamp": "2026-05-07T08:00:00.000Z",
  "client": {},
  "conversation": {},
  "message": {},
  "invoice": {},
  "calendar_event": {},
  "activity": {},
  "metadata": {}
}
```

## Flujos recomendados

1. Nuevo lead registrado.
2. Mensaje entrante WhatsApp.
3. Assistant message como backend IA.
4. Reunion agendada.
5. Evento de calendario creado.
6. Factura creada.
7. Factura pagada.
8. Factura vencida.
9. Secuencia de re-engagement.
10. Resumen diario IA.
11. Conversacion urgente.

## Implementacion recomendada

1. Crear registros iniciales en `n8n_flows` por workspace.
2. Guardar `event`, `label`, `enabled`, `status`, `webhook_url`, `requires`.
3. Desde cliente llamar siempre a `/api/n8n/trigger`, nunca directo a n8n.
4. En server validar workspace/session antes de disparar en fase productiva.
5. Anadir firma compartida o token server-side cuando exista dominio real.
6. Guardar logs de ejecucion en `activities` o tabla dedicada.

## Estados soportados

- `active`: flujo listo para ejecutar contra endpoint real.
- `inactive`: flujo desactivado.
- `demo`: flujo simulado desde NowCRM.
- `pending_config`: falta endpoint, credencial o proveedor.
- `error`: ultimo guardado o ejecucion fallo.

## Endpoint interno

`POST /api/n8n/trigger`

Acepta:

- `event_type`
- `workspace_id`
- `flow_id`
- `webhook_url`
- `flow_status`
- `mode`
- `client`
- `conversation`
- `message`
- `invoice`
- `calendar_event`
- `activity`
- `metadata`

Devuelve `status`: `ok`, `simulated`, `skipped` o `error`.

## Respuesta recomendada desde n8n

```json
{
  "ok": true,
  "suggested_response": "Texto opcional para Assistant",
  "action": "reply|schedule|invoice|notify|none",
  "activity": {
    "title": "Accion registrada",
    "description": "Detalle breve"
  },
  "metadata": {}
}
```

`suggested_response` ya esta preparado para que Assistant lo use cuando el workflow real este conectado.

## Como conectar un workflow real

1. En n8n, crear workflow nuevo.
2. Anadir nodo `Webhook`.
3. Metodo: `POST`.
4. Copiar la URL publica del webhook.
5. Pegar la URL en Settings > n8n / Flujos operativos.
6. Guardar el flujo.
7. Probar desde NowCRM.
8. Si responde `ok`, cambiar el estado a `active`.

## IA dentro de n8n

Para `assistant_message`:

1. Recibir payload en Webhook.
2. Leer `conversation`, `message` y `metadata`.
3. Responder corto y operativo: si hay reserva/cita, pedir datos minimos o confirmar que NowCRM prepara la card.
4. Llamar al proveedor IA dentro de n8n.
5. Devolver `suggested_response`.
6. NowCRM guardara la respuesta como mensaje assistant.

NowCRM ya hace deteccion local de intenciones para ahorrar tokens. Si detecta una reserva o factura con datos suficientes, prepara una card de confirmacion y no necesita llamar a OpenAI para ejecutar la accion. n8n/OpenAI queda para conversacion comercial, contexto, propuesta y fallback inteligente.

## Separacion de roles Assistant

- **Inbox Assistant / Conversaciones**: trabaja sobre conversaciones, mensajes, intención y sentimiento. Es la zona que recibira WhatsApp/Whapi en la siguiente fase.
- **CRM Copilot / Asistente interno**: opera el CRM para clientes, citas, facturas, cobros, propuestas y documentos. Las escrituras criticas requieren confirmacion.

Flujo futuro recomendado:

```txt
WhatsApp -> Whapi -> n8n -> Inbox Assistant -> Supabase conversations/messages -> CRM Copilot puede actuar con tools
```

No marcar WhatsApp como conectado hasta tener QR, webhook y workflow inbound probados.

Hint de prompt recomendado en n8n:

```txt
Responde en espanol, corto y operativo. Si el usuario habla de reservas/citas, pide solo cliente, servicio, fecha, hora y duracion. No digas que la accion se ha creado si NowCRM no la ha confirmado. Si habla de facturas, pide cliente, importe, concepto y vencimiento si falta algo.
```

## Workflow real conectado

El Assistant ya puede usar este workflow cuando el flujo `assistant_message` esta `active` y tiene webhook URL:

```txt
NowCRM - Assistant Agent
https://workspacetemporalnowlabs-n8n.hvdnby.easypanel.host/webhook/nowcrm-assistant-agent
```

Payload de prueba desde Settings:

```json
{
  "event_type": "assistant_message",
  "workspace_id": "workspace-id",
  "source": "nowcrm",
  "mode": "real",
  "conversation": {
    "id": "test",
    "client_name": "Ana Rodriguez",
    "channel": "WhatsApp",
    "sentiment": "positive",
    "intent": "pricing"
  },
  "message": {
    "content": "Hola, me interesa saber el precio del Plan Pro y que incluye exactamente."
  },
  "client": {
    "name": "Ana Rodriguez",
    "status": "lead"
  },
  "metadata": {
    "source": "settings_test"
  }
}
```

Si n8n falla, NowCRM conserva la conversacion y usa la IA demo como fallback.

## AI Agent Tools

NowCRM expone una capa interna de herramientas:

`POST /api/agent/tool`

Uso desde n8n/OpenAI:

```json
{
  "tool": "search_clients",
  "workspace_id": "workspace-id",
  "input": {
    "query": "Ana"
  },
  "metadata": {
    "source": "n8n",
    "conversation_id": "conversation-id"
  }
}
```

Tools iniciales:

- `get_workspace_summary`
- `search_clients`
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

Para escritura real con service role, usar header `x-nowcrm-secret`.
El valor debe configurarse en variables server-only, nunca en cliente.

## Supabase credentials en n8n

- Usar credenciales internas de n8n.
- No pegar service role en NowCRM.
- Si se necesita Supabase desde n8n, guardar credenciales solo en n8n Credentials.
- Usar RLS o service role con mucho cuidado solo server-side.

## WhatsApp/Whapi mas adelante

Flujo objetivo:

```txt
WhatsApp -> Whapi webhook -> n8n -> OpenAI -> NowCRM tools -> Supabase -> respuesta WhatsApp
```

Credenciales necesarias:

- Whapi token.
- Channel ID.
- Webhook URL publica de n8n.
- Credenciales de n8n para llamar a `/api/agent/tool`.

Workflows futuros:

- `whatsapp_inbound_message`
- `whatsapp_send_message`
- `new_lead_from_whatsapp`
- `booking_from_whatsapp`
- `whatsapp_message`

Pasos recomendados:

1. Conectar Whapi por QR y comprobar que recibe mensajes.
2. Crear workflow `whatsapp_inbound_message` con Webhook POST.
3. Normalizar contacto, telefono y mensaje.
4. Usar `/api/agent/tool` para buscar o crear cliente con confirmacion/validacion.
5. Crear conversacion y mensaje en Supabase.
6. Llamar OpenAI dentro de n8n solo cuando haga falta respuesta.
7. Devolver respuesta por Whapi si el flujo esta aprobado.
8. Registrar activity en NowCRM.

No marcar WhatsApp como conectado en UI hasta tener QR y webhook real probados.

## Primer workflow real sugerido

`new_lead`:

- Trigger: alta de cliente en `/clients`.
- Payload: cliente, workspace, origen y metadata.
- Acciones n8n: enrich lead, notificar Slack/email, crear tarea de seguimiento.

## Seguridad

- No exponer service role en cliente.
- No guardar secretos en componentes.
- No imprimir payloads sensibles en consola.
- Usar variables server-only para tokens cuando llegue la fase real.
