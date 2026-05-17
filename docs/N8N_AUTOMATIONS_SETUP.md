# n8n — Configuración como brazo externo de NowCRM

NowLabs AI es el cerebro. n8n NO toma decisiones: ejecuta workflows externos
(WhatsApp/email/recordatorios/PDFs) cuando NowCRM dispara `/api/n8n/trigger`.

## 1. Variables de entorno (solo nombres — nunca commitear valores)

```
N8N_BASE_URL                 # https://n8n.tudominio.com
N8N_API_KEY                  # opcional, para llamadas autenticadas a n8n cloud / self-hosted
N8N_WEBHOOK_SECRET           # se envía como x-nowcrm-secret en cada POST
N8N_DEFAULT_TIMEOUT_MS       # opcional, 1000–30000, default 8000
NOWCRM_WEBHOOK_SECRET        # secreto que n8n debe enviar para invocar /api/inbox/whatsapp/inbound
```

Si faltan `N8N_BASE_URL` o el webhook URL del flujo, el endpoint responde
`status: "pending_config"` o `status: "simulated"` y no llama a n8n real.

## 2. Endpoints

| Endpoint                          | Qué hace                                         |
| --------------------------------- | ------------------------------------------------ |
| POST `/api/n8n/trigger`           | Dispara un evento normalizado (whitelisted)      |
| GET  `/api/automations/n8n/status`| Comprueba que el host n8n responde               |
| POST `/api/automations/n8n/test`  | Test manual desde Settings                       |

### Respuesta sanitizada de `/api/n8n/trigger`

A partir de esta fase **NO se devuelve la respuesta cruda** de n8n. Solo:

```jsonc
{
  "ok": true,
  "status": "ok" | "simulated" | "skipped" | "error",
  "event_type": "appointment_booked",
  "mode": "real" | "demo",
  "http_status": 200,
  "execution_id": "abc123",   // si n8n lo devolvió
  "duration_ms": 412,
  "n8n_response": { "executionId": "abc123", "messagePreview": "ok" }
}
```

Nunca devolvemos headers, payload completo, secretos ni tokens.

## 3. Flujos esperados en n8n

El catálogo está en `src/lib/integrations.ts` (`n8nWebhookConfigs`). Cada flow
mapea a un `trigger_event` único en la tabla `public.n8n_flows`:

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

## 4. Schema real `public.n8n_flows`

```
workspace_id        uuid    NOT NULL
name                text    NOT NULL
trigger_event       text    NOT NULL   -- mapeado desde el campo "event" del payload
webhook_url         text
status              text    NOT NULL   -- active | inactive | demo | pending_config | error
requires_supabase   bool    NOT NULL
requires_whatsapp   bool    NOT NULL
requires_payment_api bool   NOT NULL
```

Antes el mapper escribía `event/label/trigger/requires` (columnas inexistentes).
El upsert ahora usa los nombres reales y el unique key es `(workspace_id, trigger_event)`.

## 5. Activación de un flujo

1. Crear el workflow en n8n, copiar la URL del webhook (HTTPS).
2. Desde Settings → Automations, pegar la URL y activar.
3. NowCRM upserta el flow en `n8n_flows` con `status='active'`.
4. La primera invocación real desde NowCRM lo despertará.

## 6. Riesgos / pendientes

- El campo `description` no existe en `n8n_flows` (se ignora si pasa por payload). Si se necesita, añadir migración separada.
- `n8n_trigger_logs` ahora tiene policies/GRANTs para `service_role`; conviene loggear cada `POST /api/n8n/trigger` desde el route para auditoría.
- En producción nunca exponer `N8N_API_KEY` ni `N8N_WEBHOOK_SECRET`.
