# n8n — Configuración como brazo externo de NowCRM

NowLabs AI es el cerebro. **n8n NO toma decisiones**: ejecuta workflows externos
(WhatsApp/email/recordatorios/PDFs) cuando NowCRM dispara `/api/n8n/trigger`.

## 1. Variables de entorno (solo nombres — nunca commitear valores)

```
N8N_BASE_URL                 # https://n8n.tudominio.com — única URL a la que se envían triggers
N8N_API_KEY                  # opcional, para llamadas autenticadas a n8n cloud / self-hosted
N8N_WEBHOOK_SECRET           # se envía como x-nowcrm-secret en cada POST
N8N_DEFAULT_TIMEOUT_MS       # opcional, 1000–30000, default 8000
NOWCRM_WEBHOOK_SECRET        # secreto interno entre Meta-webhook y la lógica inbound
```

Si falta `N8N_BASE_URL`, `/api/n8n/trigger` responde `status: "simulated"` con
`reason: "n8n_base_url_missing"` y **no** intenta una llamada real.

## 2. Modelo de seguridad (hardening Fase 12)

Esta es la parte importante — no relajar:

1. **`/api/n8n/trigger` requiere sesión autenticada** (cookie Supabase). Llamadas
   anónimas reciben 401.
2. **El `webhook_url` o `endpoint` del body se ignora por completo**. Antes era
   posible que un cliente malicioso pasara su propia URL y NowCRM le mandase
   `N8N_WEBHOOK_SECRET`. Ya no.
3. La URL de destino se construye **server-side** como
   `${N8N_BASE_URL}/webhook/${slug}` donde `slug` viene de una **allowlist
   cerrada** en `src/app/api/n8n/trigger/route.ts` (mapa `EVENT_TO_WORKFLOW_SLUG`).
4. La URL se revalida contra `N8N_BASE_URL`:
   - mismo hostname y puerto,
   - protocolo `https://` (o `http://localhost` solo en desarrollo),
   - sin IPs privadas / link-local en producción.
5. `N8N_WEBHOOK_SECRET` y `N8N_API_KEY` se añaden **solamente** después de
   validar el destino, y nunca se logean.
6. La respuesta a n8n se **sanitiza**: nunca se devuelve el payload crudo, los
   headers ni los secretos del workflow.
7. `workspace_id` (si viene) debe coincidir con el workspace del usuario
   autenticado; si no, 403.

## 3. Allowlist server-side de slugs

Solo estos `event_type` son aceptados. Cada uno mapea a un slug fijo (sin
input del cliente):

| event_type                  | slug enviado a `${N8N_BASE_URL}/webhook/{slug}` |
| --------------------------- | ----------------------------------------------- |
| `new_lead`                  | `new-lead`                                      |
| `client_updated`            | `client-updated`                                |
| `client_deleted`            | `client-deleted`                                |
| `whatsapp_message`          | `whatsapp-message`                              |
| `assistant_message`         | `assistant-message`                             |
| `conversation_resolved`     | `conversation-resolved`                         |
| `appointment_booked`        | `appointment-booked`                            |
| `calendar_event_created`    | `calendar-event-created`                        |
| `invoice_created`           | `invoice-created`                               |
| `invoice_paid`              | `invoice-paid`                                  |
| `invoice_overdue`           | `invoice-overdue`                               |
| `reengagement_needed`       | `reengagement-needed`                           |
| `daily_summary`             | `daily-summary`                                 |
| `urgent_conversation`       | `urgent-conversation`                           |
| `test_flow`                 | `test-flow`                                     |

Para añadir slugs nuevos: actualizar `N8N_EVENT_TYPES` en
`src/lib/integrations.ts` **y** `EVENT_TO_WORKFLOW_SLUG` en
`src/app/api/n8n/trigger/route.ts`. No basta con cambiar Settings.

## 4. Endpoints

| Endpoint                            | Auth | Qué hace                                       |
| ----------------------------------- | ---- | ---------------------------------------------- |
| POST `/api/n8n/trigger`             | sesión Supabase | Dispara un slug allowlisted        |
| GET  `/api/automations/n8n/status`  | abierto         | Ping a n8n (read-only)             |
| POST `/api/automations/n8n/test`    | abierto         | Lanza `test-flow` server-side      |

### Respuesta sanitizada de `/api/n8n/trigger`

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
  "n8n_response": { "executionId": "abc123", "messagePreview": "ok" }
}
```

Nunca se devuelven headers, payload completo, secretos ni tokens.

## 5. Schema real `public.n8n_flows`

```
workspace_id         uuid    NOT NULL
name                 text    NOT NULL
trigger_event        text    NOT NULL
webhook_url          text                       -- visual only — el servidor lo ignora
status               text    NOT NULL           -- active | inactive | demo | pending_config | error
requires_supabase    bool    NOT NULL
requires_whatsapp    bool    NOT NULL
requires_payment_api bool    NOT NULL
```

Settings sigue permitiendo configurar paths a nivel de workspace, pero solo
cumplen función visual y de catálogo. La invocación real **siempre** pasa por
la allowlist server-side.

## 6. Activación de un flujo

1. Crear el workflow en n8n con el `path` igual al slug allowlisted
   (por ejemplo `/webhook/appointment-booked`).
2. Habilitarlo en n8n y verificar respuesta 200 desde un curl directo.
3. En NowCRM Settings → Automations marcar el flow como `active`.
4. La primera invocación real desde NowCRM lo despertará.

## 7. n8n MCP — fase posterior

La conexión n8n MCP (model-context-protocol) se hará **después** de validar
este hardening en producción. No conectar antes para no ampliar la superficie
de ataque mientras el flow es nuevo.

## 8. Riesgos / pendientes

- `n8n_trigger_logs`: si la tabla y los GRANTs existen, conviene logear cada
  trigger desde el route para auditoría. Esta fase no escribe en esa tabla por
  defecto; documentar antes de activar.
- En producción nunca exponer `N8N_API_KEY` ni `N8N_WEBHOOK_SECRET`.
- Cualquier nuevo slug requiere actualizar **dos** sitios en código
  (`N8N_EVENT_TYPES` + `EVENT_TO_WORKFLOW_SLUG`) — fallar al hacerlo es
  intencional: bloquea slugs no revisados.
