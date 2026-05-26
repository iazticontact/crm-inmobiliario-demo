# n8n — Assistant automation workflows

Esta guía describe cómo montar los 4 workflows n8n que reciben los eventos
`assistant.*` emitidos por NowLabs AI después de que el operador confirma una
acción en el copiloto.

**El cerebro sigue siendo el CRM.** El flujo es:

```
NowLabs AI chat → /api/assistant/confirm (Supabase write) → assistant-n8n-hook → n8n webhook
```

Si n8n está apagado o falla, **la acción en el CRM ya se ha guardado** y el
operador la ve igualmente. El hook es fire-and-forget y registra una nota en
`activities` si la entrega falla.

> NO conectar todavía estos workflows a WhatsApp real, a Meta, ni a acciones
> destructivas. La superficie segura hoy es: registrar el evento, mandar
> notificación interna (Slack, email del operador), preparar borradores.

---

## 1. Variables de entorno necesarias

Configurar en el deploy de NowCRM:

```
N8N_BASE_URL=https://n8n.tudominio.com
N8N_WEBHOOK_SECRET=<secreto fuerte; guarda en Proton Pass>
```

Opcional pero recomendado:

```
N8N_API_KEY=<solo si quieres usar /api/automations/n8n/status como ping a la API>
N8N_DEFAULT_TIMEOUT_MS=8000
N8N_LOG_TRIGGERS=0
```

Y para el endpoint server-to-server inverso (`/api/agent/tool`, ver §7):

```
AGENT_TOOL_SECRET=<secreto distinto del de webhooks; guardar en Proton Pass>
```

En n8n:

- Crear una credencial **Header Auth** con el header `x-nowcrm-secret` y valor
  exactamente igual a `N8N_WEBHOOK_SECRET`.
- Cada workflow debe rechazar (responder 401) los requests sin ese header.

No commitear valores reales. `.env.local` no se sube a git.

---

## 2. Los 4 eventos `assistant.*`

| Evento                          | Slug en n8n                       | Cuándo se dispara                                                         |
| ------------------------------- | --------------------------------- | ------------------------------------------------------------------------- |
| `assistant.task_created`        | `assistant-task-created`          | Tras crear una tarea desde el copiloto.                                   |
| `assistant.booking_created`     | `assistant-booking-created`       | Tras crear una cita (calendar_event). Google Calendar se sincroniza aparte. |
| `assistant.invoice_prepared`    | `assistant-invoice-prepared`      | Tras crear una factura en estado `pending`.                               |
| `assistant.report_prepared`     | `assistant-report-prepared`       | Tras dejar un informe registrado como activity.                           |

URL final que NowCRM golpea:

```
POST ${N8N_BASE_URL}/webhook/<slug>
```

La URL se construye server-side desde `N8N_BASE_URL` + slug del **allowlist**.
El cliente no puede inyectarla. Implementación:
[src/lib/assistant-n8n-hook.ts](../src/lib/assistant-n8n-hook.ts).

---

## 3. Contrato de payload

Body que llega a n8n (idéntico para los 4 eventos):

```jsonc
{
  "eventType":   "assistant.task_created",   // o uno de los otros 3
  "source":      "nowcrm",
  "timestamp":   "2026-05-26T18:00:00.000Z", // ISO 8601 UTC, server-side

  "workspaceId": "8c1b…",                    // uuid del workspace dueño
  "entityId":    "f4d2…",                    // uuid de la fila creada (task/calendar_event/invoice/activity)
  "clientId":    "a7c3…" | null,             // uuid del cliente, si aplica
  "clientName":  "Patricia Romero" | null,   // nombre CANÓNICO (de clients.name, no del body)
  "summary":     "Llamar mañana a Patricia"  // resumen humano, ≤ ~120 chars
}
```

Garantías que NowCRM mantiene:

- Nunca incluye tokens, claves de Supabase, OpenAI, Meta o cualquier secreto.
- Nunca incluye el contenido completo del chat ni emails/teléfonos a menos que
  un workflow lo requiera explícitamente (ahora mismo, ninguno).
- `clientName` siempre es el nombre canónico de `clients.name` — el endpoint de
  confirm lo resuelve antes de invocar el hook. Un atacante que manipule el
  body de confirm no puede inyectar nombres falsos.
- El header `x-nowcrm-secret` solo se envía si `N8N_WEBHOOK_SECRET` está
  configurado.

Headers:

```
Content-Type: application/json
x-nowcrm-secret: <N8N_WEBHOOK_SECRET>
```

Timeout: 5 segundos. Si n8n tarda más, NowCRM aborta y registra el fallo en
`activities` (`type='note'`, descripción `Webhook n8n no entregado (...): <reason>`).

---

## 4. Respuesta esperada de n8n

n8n solo necesita responder rápido:

```
HTTP/1.1 200 OK
Content-Type: application/json

{ "ok": true }
```

Cualquier 2xx vale. NowCRM **no** lee el body de respuesta — solo el código.

- Si responde 4xx/5xx → fail-soft (warning + activity log). La acción CRM
  permanece intacta.
- Si tarda > 5s → fail-soft.
- Si la entrega es exitosa → nada visible en el CRM (silencio = éxito).

---

## 5. Workflows propuestos (versión segura inicial)

Para los 4, el esqueleto es el mismo. Recomendado para esta primera fase:

```
1. Webhook node
   - Path: assistant-task-created   (o el slug que toque)
   - Authentication: Header Auth ("x-nowcrm-secret")
   - HTTP Method: POST
   - Response Mode: When Last Node Finishes

2. Function / IF node
   - Validar que body.eventType empieza por "assistant." y coincide con el slug.
   - Si no coincide → Set Response to 400 y terminar.

3. Set node
   - Construir un mensaje legible: "[Nuevo {eventType}] Cliente: {clientName} — {summary}"

4. Acción externa (elige UNA, ninguna destructiva):
   - Slack: post a un canal interno (#nowlabs-assistant).
   - Email: a la dirección del operador.
   - Google Sheet: append row con eventType, workspaceId, entityId, timestamp.
   - Notion: append item a una base interna.

5. Respond to Webhook
   - Status 200
   - Body: { "ok": true }
```

### 5.1 `assistant-task-created`

Sugerencia: notificación interna ("Nueva tarea creada por NowLabs AI: {summary}").
No tocar al cliente todavía.

### 5.2 `assistant-booking-created`

Sugerencia: notificación interna. Google Calendar ya se sincroniza por la ruta
`/api/integrations/google/calendar/sync-event`, así que n8n **no** debe crear
otro evento — duplicaría.

Futuro (cuando esté validado): preparar borrador de email/WhatsApp de
confirmación pero **sin enviar** automáticamente.

### 5.3 `assistant-invoice-prepared`

Sugerencia: registrar la factura en una hoja externa de control de cobros, o
notificar a contabilidad. No emitir PDF ni mandar al cliente aún.

### 5.4 `assistant-report-prepared`

Sugerencia: enviar el `summary` por email al operador, o crear una tarjeta en
Notion/Trello. No publicar nada al cliente.

---

## 6. Cómo probar end-to-end (sin tocar producción)

### 6.1 Probar sin n8n configurado

Con `N8N_BASE_URL` vacío:

- `/api/automations/n8n/status` → `pending_config`, no rompe.
- Confirmar una acción en NowLabs AI → la acción se crea en Supabase, el hook
  retorna `{ ok: false, reason: 'n8n_base_url_missing' }` y se ignora
  silenciosamente. El CRM no muestra ningún error.

### 6.2 Probar con n8n local

1. Levantar n8n local (`docker run -p 5678:5678 n8nio/n8n`).
2. Crear los 4 webhooks (paths exactos).
3. Configurar `N8N_BASE_URL=http://localhost:5678` y un `N8N_WEBHOOK_SECRET`.
4. En NowCRM Settings → Automations → "Probar conexión n8n" (POST a
   `/api/automations/n8n/test`).
5. Confirmar una acción en NowLabs AI y ver llegar el payload.

### 6.3 Probar un solo webhook con curl

```bash
curl -i -X POST "$N8N_BASE_URL/webhook/assistant-task-created" \
  -H "Content-Type: application/json" \
  -H "x-nowcrm-secret: $N8N_WEBHOOK_SECRET" \
  -d '{
    "eventType": "assistant.task_created",
    "source": "nowcrm",
    "timestamp": "2026-05-26T18:00:00.000Z",
    "workspaceId": "00000000-0000-0000-0000-000000000000",
    "entityId":   "00000000-0000-0000-0000-000000000001",
    "clientId":   null,
    "clientName": null,
    "summary":    "Smoke test"
  }'
```

Esperado: `200 { "ok": true }`. Comprobar la ejecución en el panel de n8n.

---

## 7. Llamadas inversas n8n → NowCRM (opcional)

Si un workflow necesita **leer** datos del CRM (por ejemplo, KPIs del
workspace o un resumen de cliente), debe usar `/api/agent/tool` con el header
`x-nowcrm-secret: $AGENT_TOOL_SECRET`. **Es un secreto distinto** del de los
webhooks — no reciclarlos.

Tools permitidas hoy (read + log):

- `get_workspace_summary` — KPIs del workspace.
- `get_client_summary` — un cliente + 5 invoices/events recientes.
- `log_external_automation_event` — registrar una nota en `activities`
  prefijada con `[n8n:<event_type>]`.

Todo lo demás (mutar clientes, emitir facturas, cancelar citas) está
**retirado** con 410 Gone. Esas operaciones deben pasar por
`/api/assistant/confirm` con sesión de usuario.

Detalles y schema completos en [src/app/api/agent/tool/route.ts](../src/app/api/agent/tool/route.ts).

---

## 8. Checklist de seguridad antes de activar

- [ ] `N8N_BASE_URL` apunta a un host **propio** sobre HTTPS (en dev se admite
      `http://localhost` solo si `NODE_ENV !== 'production'`).
- [ ] `N8N_WEBHOOK_SECRET` configurado y verificado dentro del workflow n8n.
- [ ] Cada uno de los 4 webhooks responde 401 si falta el header.
- [ ] Cada workflow valida que `body.eventType` empieza por `assistant.` y
      coincide con su slug.
- [ ] Ningún workflow toca WhatsApp ni email externo del cliente todavía.
- [ ] Si el workflow loguea, **no** loguea el body completo ni los headers —
      solo `eventType`, `workspaceId` y `entityId`.
- [ ] `AGENT_TOOL_SECRET` configurado por separado y guardado en Proton Pass.
- [ ] Los secretos NO aparecen en commits, en logs ni en mensajes de error
      del CRM (la respuesta del trigger ya está sanitizada server-side).
- [ ] Probado el flujo end-to-end con un workspace de prueba antes de
      activarlo en el workspace real.

---

## 9. Qué NO hacer (todavía)

- ❌ NO enviar WhatsApp / SMS / email al cliente final desde estos workflows.
- ❌ NO crear, modificar o borrar filas en Supabase desde n8n; usa
  `/api/assistant/confirm` o las rutas REST con sesión.
- ❌ NO usar el secreto de webhook como `AGENT_TOOL_SECRET` ni viceversa.
- ❌ NO conectar n8n MCP todavía; primero validar este pipeline en
  producción durante al menos una semana.
- ❌ NO enviar tokens de Meta, Supabase service-role o OpenAI dentro del
  body — NowCRM nunca los envía y los workflows tampoco deben necesitarlos.
- ❌ NO reintentar automáticamente desde n8n hacia NowCRM en bucle si una
  acción del CRM falla; el CRM tiene su propio estado.

---

## 10. Diferencias con `/api/n8n/trigger`

`/api/n8n/trigger` es el **bridge interno general** para los eventos
declarados en `EVENT_TO_WORKFLOW_SLUG` (lead, factura pagada, etc.), llamado
desde la UI con sesión Supabase. Está documentado en
[N8N_AUTOMATIONS_SETUP.md](N8N_AUTOMATIONS_SETUP.md) y
[N8N_PAYLOAD_CONTRACT.md](N8N_PAYLOAD_CONTRACT.md).

Los hooks `assistant.*` viven en un canal aparte
([assistant-n8n-hook.ts](../src/lib/assistant-n8n-hook.ts)) que dispara
[/api/assistant/confirm](../src/app/api/assistant/confirm/route.ts) tras
escribir en Supabase. No comparten allowlist ni payload con
`/api/n8n/trigger`, así que añadir un evento `assistant.*` no requiere tocar
ese mapa.

Resumen:

| Necesidad                                       | Endpoint que llamas                  |
| ----------------------------------------------- | ------------------------------------ |
| Evento generado tras una confirmación NowLabs AI | (automático) `assistant-n8n-hook`    |
| Evento general (lead nuevo, factura cobrada…)   | `/api/n8n/trigger`                   |
| Comprobar que n8n responde                      | `/api/automations/n8n/status`        |
| Ping `test-flow` desde la UI                    | `/api/automations/n8n/test`          |
| n8n quiere leer datos seguros del CRM           | `/api/agent/tool` con secret         |
