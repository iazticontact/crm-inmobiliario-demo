# Checklist interno — Operador NowCRM: Google Calendar

Sigue este checklist cada vez que tengas que poner en marcha la integración de Google Calendar para un cliente nuevo o para un nuevo entorno de despliegue. El proceso tarda menos de 15 minutos cuando las credenciales ya están creadas.

---

## Parte 1 — Verificar que la plataforma está configurada (una vez por entorno)

### 1.1 Variables de entorno en Vercel

Entra en Vercel → proyecto NowCRM → Settings → Environment Variables. Comprueba que existen y tienen valor:

- [ ] `GOOGLE_CLIENT_ID`
- [ ] `GOOGLE_CLIENT_SECRET`
- [ ] `GOOGLE_REDIRECT_URI`
- [ ] `NEXT_PUBLIC_APP_URL`
- [ ] `SUPABASE_SERVICE_ROLE_KEY`

Si falta alguna, añádela antes de continuar. Recuerda que `GOOGLE_CLIENT_SECRET` y `SUPABASE_SERVICE_ROLE_KEY` son secretos — nunca deben aparecer en código cliente ni en logs.

### 1.2 Redirect URI registrada en Google Cloud Console

- [ ] Abre [console.cloud.google.com](https://console.cloud.google.com) → Credentials → el cliente OAuth del proyecto
- [ ] Comprueba que en "Authorized redirect URIs" está exactamente: `{NEXT_PUBLIC_APP_URL}/api/integrations/google/calendar/callback`
  - Ejemplo desarrollo: `http://localhost:3000/api/integrations/google/calendar/callback`
  - Ejemplo producción: `https://nowcrm.tudominio.com/api/integrations/google/calendar/callback`
- [ ] Si la URI no coincide exactamente (incluido el protocolo), añádela y guarda

### 1.3 OAuth consent screen

- [ ] Abre APIs & Services → OAuth consent screen
- [ ] El estado es "Published" (producción) o el cliente está en la lista de test users (desarrollo)
- [ ] Los scopes incluyen `calendar` y `calendar.events`

### 1.4 Google Calendar API habilitada

- [ ] APIs & Services → Library → busca "Google Calendar API" → confirma que está habilitada

---

## Parte 2 — Migraciones SQL en Supabase (una vez por base de datos)

Abre Supabase → SQL Editor y ejecuta:

```sql
-- Columna sync_enabled en google_calendar_connections
ALTER TABLE public.google_calendar_connections
  ADD COLUMN IF NOT EXISTS sync_enabled boolean NOT NULL DEFAULT false;

-- Columnas de sync en calendar_events
ALTER TABLE public.calendar_events ADD COLUMN IF NOT EXISTS google_event_id text;
ALTER TABLE public.calendar_events ADD COLUMN IF NOT EXISTS google_sync_status text;
ALTER TABLE public.calendar_events ADD COLUMN IF NOT EXISTS google_synced_at timestamptz;
ALTER TABLE public.calendar_events ADD COLUMN IF NOT EXISTS google_calendar_id text;
ALTER TABLE public.calendar_events ADD COLUMN IF NOT EXISTS sync_source text;
ALTER TABLE public.calendar_events ADD COLUMN IF NOT EXISTS last_synced_at timestamptz;
```

Verifica que las columnas aparecen en el schema antes de continuar.

---

## Parte 3 — Pedir al cliente que autorice Google

### 3.1 Entra al workspace del cliente

- [ ] Inicia sesión en NowCRM con la cuenta del cliente (o pídele que lo haga él)
- [ ] Navega a **Configuración → Google Calendar**

### 3.2 Verificar estado previo

- [ ] El badge muestra "No configurado" o "Pendiente OAuth" — si ya muestra "Conectado", la integración ya está activa y puedes ir a la Parte 4

### 3.3 Iniciar la autorización

- [ ] Pulsa **"Autorizar con Google"**
- [ ] Se abre la pantalla de inicio de sesión de Google en el mismo tab
- [ ] Selecciona la cuenta Google que quieres vincular con NowCRM
- [ ] Acepta los permisos (puede aparecer advertencia de "App no verificada" en desarrollo — pulsa "Avanzado" → "Ir a NowCRM")
- [ ] Google redirige automáticamente de vuelta a Configuración

### 3.4 Confirmar la conexión

- [ ] La página muestra el toast "Google Calendar conectado"
- [ ] El badge en la sección Google Calendar muestra "Conectado" (verde)
- [ ] El badge en el panel de Estado del sistema muestra "Google Calendar conectado"

Si aparece error, consulta la sección de troubleshooting al final.

---

## Parte 4 — Crear cita de prueba y verificar sincronización

### 4.1 Crear un evento en NowCRM

- [ ] Ve a **Calendario** → crea un evento nuevo con fecha futura
- [ ] Guarda el evento y copia su ID (puedes verlo en la URL o en Supabase)

### 4.2 Sincronizar el evento

Desde el terminal o desde el asistente NowLabs AI:

```bash
curl -X POST https://nowcrm.tudominio.com/api/integrations/google/calendar/sync-event \
  -H "Content-Type: application/json" \
  -H "Cookie: <sesion-del-usuario>" \
  -d '{"eventId": "<uuid-del-evento>"}'
```

Respuesta esperada:
```json
{ "ok": true, "synced": true, "googleEventId": "...", "calendarId": "primary" }
```

### 4.3 Verificar en Google Calendar

- [ ] Abre [calendar.google.com](https://calendar.google.com) con la cuenta vinculada
- [ ] Comprueba que el evento aparece en la fecha correcta

### 4.4 Verificar en Supabase

```sql
SELECT id, title, google_event_id, last_synced_at
FROM public.calendar_events
WHERE google_event_id IS NOT NULL
ORDER BY last_synced_at DESC
LIMIT 5;
```

- [ ] El evento tiene `google_event_id` no nulo y `last_synced_at` reciente

---

## Troubleshooting

### El botón "Autorizar con Google" no abre la pantalla de Google

**Causa probable**: `GOOGLE_CLIENT_ID` o `GOOGLE_REDIRECT_URI` no están configuradas en el servidor.

**Solución**: Verificar Parte 1. Si las variables faltan, la API redirige a `/settings?integration=google_calendar&status=error&reason=not_configured`.

### El callback devuelve `reason=no_refresh_token`

**Causa**: Google no emitió un `refresh_token`. Esto pasa cuando el usuario ya había autorizado la app antes y el consentimiento está en caché.

**Solución**: El cliente debe ir a [myaccount.google.com](https://myaccount.google.com) → Seguridad → Apps con acceso → buscar NowCRM → Revocar acceso. Después, volver a Configuración y pulsar "Autorizar con Google" de nuevo.

### El callback devuelve `reason=db_error`

**Causa**: El upsert en Supabase falló. Las causas más comunes son:
- `SUPABASE_SERVICE_ROLE_KEY` no configurada
- La tabla `google_calendar_connections` no existe
- La columna `sync_enabled` no existe (ejecutar SQL de la Parte 2)

**Solución**: Revisar logs en Vercel → Functions → `api/integrations/google/calendar/callback`. El error de Supabase aparece en `console.error`.

### sync-event devuelve `reason=token_refresh_failed`

**Causa**: Google revocó el acceso (el usuario lo quitó desde myaccount.google.com) o el `refresh_token` es inválido.

**Solución**: Desconectar en Configuración → Google Calendar → "Desconectar" y volver a autorizar.

### sync-event devuelve `reason=credentials_not_configured`

**Causa**: `GOOGLE_CLIENT_ID` o `GOOGLE_CLIENT_SECRET` no están en el servidor donde corre el API route.

**Solución**: Verificar variables en Vercel y hacer redeploy.

---

## Estado final esperado en Supabase — Google Calendar

```sql
SELECT workspace_id, calendar_id, status, sync_enabled, token_expiry, last_sync_at
FROM public.google_calendar_connections;
```

| Campo | Valor esperado |
|---|---|
| `status` | `connected` |
| `sync_enabled` | `true` |
| `calendar_id` | `primary` (o el ID elegido) |
| `refresh_token_enc` | valor no nulo (token cifrado/plaintext) |
| `token_expiry` | fecha futura |
| `last_sync_at` | timestamp reciente |

---

## Notas de hardening (rev. 2026-05)

- **cancel-event acepta 410 Gone**: si el evento ya no existe en Google (borrado por el dueño desde fuera), NowCRM marca local como cancelado y devuelve `ok:true, googleCancelled:true, googleAlreadyGone:true`. Antes fallaba con `google_api_error`.
- **Eventos read-only bloqueados**: cancel-event y update-event devuelven `ok:false, reason:'read_only_event'` si `calendar_events.is_read_only=true`. NowLabs AI también los rechaza con mensaje claro.
- **Calendar UI**: muestra badge "Solo lectura" + icono Lock; inputs deshabilitados.

## Hardening rev. 2026-05-17 — Cancelación NowCRM → Google sincronizada

**Bug que se arregló:** Cancelar/eliminar un evento desde el Calendar del CRM **no** eliminaba el evento en Google Calendar.

**Causa raíz:**
- La UI hacía `cancelCalendarEvent` (soft-cancel o hard-delete fallback) **antes** de llamar a la route Google.
- Luego llamaba Google con `void fetch(...)` (fire-and-forget): si Google fallaba, nadie se enteraba.
- En el fallback de HARD DELETE, el row local se borraba antes de que la route pudiera leer `google_event_id`.

**Reparación:**
- `cancel-event` ahora es **atómica**: hace Google DELETE primero (si procede) y luego soft-cancel local. Devuelve un contrato JSON estable.
- Calendar UI y Assistant page ahora **esperan** la respuesta y muestran toast honesto.
- Multi-calendar: incorporado `default_calendar_id` en la cadena de fallback en `cancel-event`, `update-event` y `sync-event`.

**Contrato de respuesta de `/api/integrations/google/calendar/cancel-event`:**

```jsonc
{
  "ok": true,                  // operación útil completa
  "localCancelled": true,      // status='cancelled' en Supabase
  "googleCancelled": true,     // DELETE OK en Google (o 404/410)
  "googleAlreadyGone": false,  // true si Google devolvió 404/410
  "calendarIdUsed": "primary",
  "reason": "cancelled",       // ver tabla abajo
  "message": "...",
  "synced": true               // alias legacy de googleCancelled
}
```

**Reasons posibles:**

| reason | local | google | acción operador |
|---|---|---|---|
| `cancelled` | ✓ | ✓ | nada — todo OK |
| `not_synced_to_google` | ✓ | — | nada — evento nunca tuvo google_event_id |
| `not_connected` | ✓ | — | reconectar Google desde Settings |
| `credentials_not_configured` | ✓ | — | añadir `GOOGLE_CLIENT_ID/SECRET` en Vercel |
| `read_only_event` | ✗ | ✗ | el usuario debe borrarlo desde Google |
| `event_not_found` | ✗ | ✗ | evento no pertenece al workspace |
| `needs_reconnect` | ✗ | ✗ | reconectar Google (refresh_token invalid_grant o 401) |
| `google_forbidden` | ✗ | ✗ | revisar permisos del calendario en Google |
| `rate_limited` | ✗ | ✗ | reintentar en unos minutos |
| `google_api_error` | ✗ | ✗ | revisar logs server, reintentar |
| `google_fetch_error` | ✗ | ✗ | problema de red, reintentar |
| `local_cancel_failed` | ✗ | depende | revisar RLS / GRANTs Supabase |

**Logs server seguros (sin tokens):**

```
[google/cancel-event:start] { localEventId, hasGoogleEventId, wasAlreadyCancelled }
[google/cancel-event:calendar-id] { calendarId, source }
[google/cancel-event:google-delete] { status, calendarId }
[google/cancel-event:result] { localOk, googleStatus, googleAlreadyGone }
```

---

# Checklist interno — Operador NowCRM: WhatsApp Business

---

## Parte 1 — Verificar que la plataforma está configurada (una vez por entorno)

### 1.1 Variables de entorno en Vercel

Entra en Vercel → proyecto NowCRM → Settings → Environment Variables. Comprueba que existen:

- [ ] `META_APP_SECRET` — App Secret de la App Meta (Settings → Basic en Meta Developers)
- [ ] `META_WEBHOOK_VERIFY_TOKEN` — token aleatorio generado por NowCRM (ej: UUID v4)
- [ ] `META_ACCESS_TOKEN` — System User Token de Meta Business Manager
- [ ] `NOWCRM_WEBHOOK_SECRET` — secreto interno entre webhook e inbound handler
- [ ] `NEXT_PUBLIC_APP_URL` — dominio público de NowCRM (ej: https://nowcrm.tudominio.com)

Si alguna falta, añádela y haz redeploy antes de continuar.

### 1.2 Verificar que el webhook responde al challenge

Simula el challenge GET de Meta:

```bash
curl "https://nowcrm.tudominio.com/api/integrations/meta/whatsapp/webhook\
?hub.mode=subscribe\
&hub.verify_token=TU_META_WEBHOOK_VERIFY_TOKEN\
&hub.challenge=test_challenge_123"
```

Respuesta esperada: `test_challenge_123` con status 200.

Si devuelve 503: `META_WEBHOOK_VERIFY_TOKEN` no está configurada.
Si devuelve 403: el token no coincide.

---

## Parte 2 — SQL en Supabase (una vez por base de datos)

Abre Supabase → SQL Editor y ejecuta:

```sql
-- Crear tabla si no existe
CREATE TABLE IF NOT EXISTS public.whatsapp_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'meta',
  meta_business_id text,
  whatsapp_business_account_id text,
  phone_number_id text,
  phone_number text,
  webhook_verify_token_configured boolean DEFAULT false,
  webhook_url text,
  status text NOT NULL DEFAULT 'not_configured',
  sync_enabled boolean NOT NULL DEFAULT false,
  last_webhook_at timestamptz,
  last_test_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (workspace_id, provider)
);

-- Añadir columnas faltantes si la tabla ya existe
ALTER TABLE public.whatsapp_connections ADD COLUMN IF NOT EXISTS phone_number_id text;
ALTER TABLE public.whatsapp_connections ADD COLUMN IF NOT EXISTS meta_business_id text;
ALTER TABLE public.whatsapp_connections ADD COLUMN IF NOT EXISTS webhook_verify_token_configured boolean DEFAULT false;
ALTER TABLE public.whatsapp_connections ADD COLUMN IF NOT EXISTS last_webhook_at timestamptz;
ALTER TABLE public.whatsapp_connections ADD COLUMN IF NOT EXISTS last_test_at timestamptz;
ALTER TABLE public.whatsapp_connections ADD COLUMN IF NOT EXISTS sync_enabled boolean NOT NULL DEFAULT false;
```

---

## Parte 3 — Pedir al cliente que configure su WhatsApp

### 3.1 El cliente completa los pasos de WHATSAPP_CLIENT_ONBOARDING.md

El cliente debe:
1. Crear su App en Meta Developers y añadir WhatsApp
2. Verificar su número de teléfono
3. Ir a **Settings → WhatsApp Business** en NowCRM
4. Introducir: número, Phone Number ID, WABA ID, Meta Business ID
5. Pulsar **"Guardar configuración"**

### 3.2 Tú registras el webhook en Meta

El cliente NO introduce el Verify Token. Eres tú quien lo hace:

1. App Dashboard del cliente → WhatsApp → Configuración → Webhook → "Editar"
2. URL de callback: `{NEXT_PUBLIC_APP_URL}/api/integrations/meta/whatsapp/webhook`
3. Verify token: el valor de `META_WEBHOOK_VERIFY_TOKEN` en el servidor
4. Pulsa "Verificar y guardar"
5. Suscribe a eventos: `messages`, `message_deliveries`, `message_reads`

### 3.3 Verificar el estado en Settings

- [ ] Badge muestra "Preparado · pendiente webhook" → IDs guardados, falta el webhook
- [ ] Después de registrar el webhook en Meta → badge debe cambiar tras primer mensaje real

---

## Parte 4 — Probar la conexión

### 4.1 Enviar mensaje de prueba real

Desde cualquier teléfono, envía un WhatsApp al número verificado del cliente.

### 4.2 Verificar en NowCRM Inbox

- [ ] El mensaje aparece en Inbox en menos de 10 segundos
- [ ] En Settings → WhatsApp, "último webhook" muestra timestamp reciente

### 4.3 Verificar en Supabase

```sql
SELECT workspace_id, phone_number, status, last_webhook_at, updated_at
FROM public.whatsapp_connections;
```

- [ ] `status` = `webhook_pending` o `connected`
- [ ] `last_webhook_at` tiene un timestamp reciente

### 4.4 Marcar como conectado

Una vez verificado que los mensajes llegan al Inbox, actualiza el estado manualmente si hace falta:

```sql
UPDATE public.whatsapp_connections
SET status = 'connected', updated_at = now()
WHERE workspace_id = 'UUID_DEL_WORKSPACE'
  AND provider = 'meta';
```

---

## Troubleshooting WhatsApp

### El webhook no se verifica en Meta

**Causa probable**: `META_WEBHOOK_VERIFY_TOKEN` no está en el servidor, o el token introducido en Meta no coincide.

**Verificación**:
```bash
curl "https://nowcrm.tudominio.com/api/integrations/meta/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=TU_TOKEN&hub.challenge=test"
```

### Los mensajes no llegan al Inbox

**Causas posibles**:
1. `NOWCRM_WEBHOOK_SECRET` no configurada → el webhook recibe pero no puede forwarding al inbound handler
2. `SUPABASE_SERVICE_ROLE_KEY` no configurada → el inbound handler no puede escribir en la DB
3. El `phone_number` en `whatsapp_connections` no coincide con el número que envió el mensaje → workspace no resuelto

**Logs**: Vercel → Functions → `api/integrations/meta/whatsapp/webhook` y `api/inbox/whatsapp/inbound`

### "Probar conexión" muestra "Test simulado"

**Causa**: `META_ACCESS_TOKEN` o `META_PHONE_NUMBER_ID` no están en el servidor.

**Solución**: Configurar las variables en Vercel. El test simulado no valida el webhook, solo la ruta del servidor.

---

## Estado final esperado en Supabase — WhatsApp

```sql
SELECT workspace_id, phone_number, phone_number_id, status, last_webhook_at
FROM public.whatsapp_connections;
```

| Campo | Valor esperado |
|---|---|
| `status` | `connected` o `webhook_pending` |
| `phone_number` | número con prefijo internacional |
| `phone_number_id` | ID numérico de Meta Developers |
| `last_webhook_at` | timestamp del último mensaje recibido |
