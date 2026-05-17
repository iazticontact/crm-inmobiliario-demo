# Contrato NowCRM ↔ n8n

Este documento fija el contrato JSON que NowCRM envía a n8n y la respuesta
que espera. Cualquier workflow nuevo debe ajustarse a este contrato.

## 1. Endpoint que llama NowCRM

NowCRM **siempre** llama a:

```
POST ${N8N_BASE_URL}/webhook/${slug}
```

Donde `slug` viene de la allowlist server-side en
[src/app/api/n8n/trigger/route.ts](../src/app/api/n8n/trigger/route.ts)
(mapa `EVENT_TO_WORKFLOW_SLUG`).

El usuario final no puede inyectar URLs ni paths. Cualquier `webhook_url` que
llegue en el body se ignora.

## 2. Headers que NowCRM envía

```
Content-Type: application/json
X-N8N-API-KEY: <N8N_API_KEY>          # solo si configurado (no obligatorio para webhooks)
x-nowcrm-secret: <N8N_WEBHOOK_SECRET> # solo si configurado, valida que el webhook viene de NowCRM
```

El workflow de n8n debe verificar `x-nowcrm-secret` contra el secreto que el
operador haya configurado en n8n. Si no coincide, debe responder 401.

## 3. Body que NowCRM envía

```jsonc
{
  "event_type": "appointment_booked",       // siempre presente, del allowlist
  "workspace_id": "uuid-del-workspace",     // siempre presente
  "flow_id": "uuid-del-flow-en-n8n_flows",  // opcional
  "source": "nowcrm",                       // literal
  "mode": "real" | "demo",                  // demo si workspace_id falta o no es real
  "timestamp": "2026-05-17T18:00:00.000Z",  // ISO 8601, server-side

  // Bloques opcionales — solo se rellenan los que aplican al event_type
  "client": {                               // datos sanitizados del cliente
    "id": "uuid-client",
    "name": "Cliente Demo",
    "email": "cliente@example.com",
    "phone": "+34600000000"
  },
  "conversation": {
    "id": "uuid-conversation",
    "channel": "whatsapp",
    "client_name": "Cliente Demo",
    "intent": "booking",
    "sentiment": "positive"
  },
  "message": {                              // último/relevant message
    "content": "Hola, quiero confirmar la cita"
  },
  "invoice": {
    "id": "uuid-invoice",
    "client_name": "Cliente Demo",
    "amount": 299.0,
    "status": "paid"
  },
  "calendar_event": {
    "id": "uuid-event",
    "title": "Llamada Pro",
    "starts_at": "2026-05-20T10:00:00Z",
    "ends_at": "2026-05-20T10:30:00Z",
    "client_name": "Cliente Demo"
  },
  "activity": { },

  // Metadatos libres del flujo (NowCRM siempre añade triggered_at)
  "metadata": {
    "source": "settings_flow" | "automations" | "dashboard" | "billing" | "calendar" | "assistant",
    "triggered_at": "2026-05-17T18:00:00.000Z"
  }
}
```

**NowCRM nunca envía a n8n**:

- `SUPABASE_SERVICE_ROLE_KEY`
- `OPENAI_API_KEY`
- Tokens de Meta
- `refresh_token_enc` ni nada de OAuth
- Email/teléfono de otros workspaces
- Datos crudos del request HTTP original

## 4. Respuesta que NowCRM espera de n8n

n8n puede responder cualquier JSON. NowCRM **solo** lee de forma whitelisted:

```jsonc
{
  "ok": true,                       // opcional
  "executionId": "abc123",          // o execution_id / id — se normaliza
  "message": "Lead procesado",      // o status_text / statusText — corto

  // Para flows tipo Assistant Agent (raros), respuesta sugerida:
  "suggested_response": "Texto a sugerir al operador"
}
```

NowCRM **NUNCA** propaga al cliente el JSON crudo de n8n. La respuesta hacia
el cliente del CRM es:

```jsonc
{
  "ok": true,
  "status": "ok" | "simulated" | "skipped" | "error",
  "event_type": "appointment_booked",
  "workflow_slug": "appointment-booked",
  "mode": "real" | "demo",
  "http_status": 200,
  "execution_id": "abc123",
  "duration_ms": 412,
  "n8n_response": {
    "executionId": "abc123",
    "messagePreview": "Lead procesado"   // recortado a 240 chars
  },
  "suggested_response": "Texto sugerido"  // solo si n8n lo envió
}
```

## 5. Códigos de error y timeouts

| Situación NowCRM | Status devuelto al cliente | Acción esperada |
| ---------------- | --------------------------- | --------------- |
| `event_type` no allowlisted | `error` 400 | Frontend muestra error y NO reintenta |
| Sin sesión Supabase | `error` 401 | Frontend redirige a login |
| `workspace_id` no coincide | `error` 403 | Frontend debe limpiar estado y recargar |
| `flow_status === 'inactive'` | `skipped` 200 | UI muestra "Flujo inactivo" |
| `N8N_BASE_URL` no configurada | `simulated` 200 | UI muestra "Modo simulado" |
| URL construida insegura | `error` 502 | Loguear y avisar al operador |
| Timeout (`N8N_DEFAULT_TIMEOUT_MS`, default 8s) | `error` 502 | El frontend puede reintentar manualmente |
| n8n responde 4xx/5xx | `error` + `http_status` | Sin reintento automático |
| Network error | `error` 502 | Frontend muestra "No se pudo contactar n8n" |

## 6. Idempotencia y reintentos

- NowCRM **no reintenta** automáticamente. El operador (o un sistema externo)
  decide si re-disparar.
- Los workflows en n8n **deben ser idempotentes**: si reciben el mismo
  `event_type` + `workspace_id` + identificador de recurso (`invoice.id`,
  `calendar_event.id`, etc.) en doble, no deben duplicar el efecto.
- Para el flujo `whatsapp_message` específicamente, el `externalMessageId` de
  Meta llega en `message.externalMessageId` (si NowCRM lo envía) y debe usarse
  como clave de idempotencia.

## 7. Rate limits

Actualmente no hay rate limit aplicado server-side en `/api/n8n/trigger` (solo
auth + allowlist). Para producción se recomienda:

- Rate limit por workspace a nivel de middleware o Vercel Edge Config.
- Circuit breaker en n8n para no saturar canales externos (WhatsApp/email)
  cuando un workflow falla repetidamente.

## 8. Versionado del contrato

- Cambios **no breaking** (campos nuevos opcionales): se añaden sin notificar.
- Cambios **breaking** (renombrar campo, cambiar tipo, cambiar shape):
  - Mantener compatibilidad por al menos 1 ciclo de release.
  - Añadir `metadata.contract_version: 2` cuando aplique.

## 9. Workflows allowlisted hoy

Ver [N8N_AUTOMATIONS_SETUP.md](N8N_AUTOMATIONS_SETUP.md) sección 3.

Si un slug que necesitas no está en la tabla:

1. Añadirlo a `N8N_EVENT_TYPES` en [src/lib/integrations.ts](../src/lib/integrations.ts).
2. Añadirlo a `EVENT_TO_WORKFLOW_SLUG` en [src/app/api/n8n/trigger/route.ts](../src/app/api/n8n/trigger/route.ts).
3. Actualizar `n8nWebhookConfigs` (descripción + label visible en Settings).
4. Actualizar este documento.
5. Crear el workflow en n8n con el path `/webhook/<slug>`.
