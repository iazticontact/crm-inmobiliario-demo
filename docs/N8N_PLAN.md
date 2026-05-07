# NowCRM n8n Plan

## Estado actual

NowCRM ya tiene una base preparada:

- Catalogo de flujos en `src/lib/integrations.ts`.
- Helper `triggerN8nWebhook()`.
- API route interna `/api/n8n/trigger`.
- Settings muestra URL base, endpoints, estados y prueba de webhook.
- Settings puede cargar/guardar `n8n_flows` e `integrations` si hay workspace real y RLS permite acceso.

Todavia no hay n8n real conectado ni persistencia de configuracion por workspace.

## Payload base

```json
{
  "event_type": "new_lead",
  "workspace_id": "workspace-id",
  "source": "nowcrm",
  "mode": "demo|real",
  "client": {},
  "conversation": {},
  "message": {},
  "invoice": {},
  "metadata": {}
}
```

## Flujos recomendados

1. Nuevo lead registrado.
2. Mensaje entrante WhatsApp.
3. Reunion agendada.
4. Factura vencida.
5. Cobro registrado.
6. Secuencia de re-engagement.
7. Resumen diario IA.
8. Conversacion urgente.

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
- `webhook_url`
- `mode`
- `client`
- `conversation`
- `message`
- `invoice`
- `event`
- `metadata`

Devuelve `status`: `ok`, `simulated`, `skipped` o `error`.

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
