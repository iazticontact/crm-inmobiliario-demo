# NowCRM QA Checklist

## Auth

- Abrir `/login`.
- Entrar con usuario real confirmado.
- Comprobar overlay de carga.
- Cerrar sesion real y volver a `/login`.
- Probar forgot password y `/reset-password`.

## Modo demo

- Entrar en modo demo desde `/login`.
- Comprobar `/dashboard`.
- Comprobar que Sidebar muestra modo demo.
- Cerrar sesion demo y volver a `/login`.

## Clients

- Cargar `/clients` con usuario real.
- Crear cliente con notas.
- Editar cliente y notas.
- Eliminar cliente con confirmacion.
- Recargar y verificar persistencia.
- Repetir en modo demo y confirmar fallback local.

## Billing

- Cargar `/billing`.
- Crear factura.
- Editar factura.
- Marcar pagada.
- Eliminar factura.
- Recargar y verificar persistencia.
- Revisar metricas: total, pendiente, cobrado y vencidas.

## Calendar

- Cargar `/calendar`.
- Crear evento.
- Confirmar que eventos creados desde Assistant aparecen tras recargar.
- Editar evento.
- Eliminar evento.
- Recargar y verificar persistencia.
- Revisar vista semanal y panel de proximos eventos.

## Assistant

- Cargar `/assistant`.
- Verificar que no aparece flash demo con usuario real.
- Verificar badges: `Mensajes reales`, `NowLabs AI backend activo`, `Workspace real`.
- Seleccionar `Conversaciones / Inbox Assistant`.
- Crear conversacion real Inbox.
- Enviar `Hola, quiero saber precios`.
- Ir a `/dashboard`, volver a `/assistant` y confirmar que la conversacion Inbox sigue.
- Recargar `/assistant` y confirmar que los mensajes Inbox siguen.
- Seleccionar `Copilot CRM / Asistente interno`.
- Crear consulta real Copilot.
- Enviar `Qué puedes hacer?`.
- Ir a `/settings`, volver a `/assistant` y confirmar que la consulta Copilot sigue.
- Recargar `/assistant` y confirmar que los mensajes Copilot siguen.
- Confirmar que Inbox y Copilot no comparten conversacion activa ni lista filtrada.
- Enviar `Hola buenas, ¿con quién hablo?`.
- Enviar `Soy una peluquería y quiero que la IA gestione reservas`.
- Verificar respuesta corta y operativa sobre reservas.
- Enviar `Reserva a Ana mañana a las 10 para corte`.
- Verificar card `Acción preparada` con datos faltantes y confirmacion bloqueada si falta duracion.
- Enviar `30 minutos`, confirmar card y comprobar evento en `/calendar`.
- Enviar `Crea una factura a Ana de 299€ por Plan Pro`.
- Verificar card de factura y confirmacion bloqueada si falta vencimiento.
- Con NowLabs AI en modo real, verificar respuesta desde `/api/assistant/chat` y mensaje assistant guardado.
- Si n8n falla, verificar fallback seguro sin cambiar la pantalla a demo.
- Probar quick action `Resumen cliente`.
- Probar quick action `Proxima accion`.
- Probar quick action `Crear cita`.
- Probar quick action `Buscar hueco`.
- Probar quick action `Crear factura`.
- Probar quick action `Revisar cobros`.
- Probar quick action `Buscar cliente`.
- Probar quick action `Probar n8n`.
- Recargar y verificar mensajes persistentes con usuario real.
- Confirmar que modo demo no escribe en Supabase.
- Marcar conversacion como resuelta.

## AI Agent Tools

- Probar `POST /api/agent/tool` con `get_workspace_summary`.
- Probar `search_clients`.
- Probar `get_next_best_actions`.
- Probar una tool de escritura en fallback demo.
- Si hay service role y secreto, probar `create_client` desde n8n con `x-nowcrm-secret`.

## Settings

- Cargar `/settings`.
- Revisar estado de modulos.
- Inicializar flujos n8n con usuario real.
- Activar `NowCRM - Assistant Agent`.
- Probar `Probar Assistant Agent`.
- Editar endpoint de flujo.
- Guardar flujo.
- Probar flujo.
- Cambiar estado de una integracion.
- Recargar y verificar persistencia si RLS/schema lo permiten.

## n8n Trigger

- Probar desde Settings con URL por defecto: debe simular.
- Probar con endpoint localhost/HTTPS si existe n8n real.
- Verificar respuesta `ok`, `simulated`, `skipped` o `error`.
- Probar `assistant_message` contra `NowCRM - Assistant Agent`.
- Probar `new_lead`.
- Probar flujo inactivo: debe devolver `skipped`.
- Copiar payload de ejemplo desde docs si hace falta.

## Automations

- Cargar `/automations`.
- Probar una automatizacion.
- Activar/pausar una automatizacion.
- Verificar badge `n8n demo` o `n8n active`.
- Confirmar que los tests pasan por `/api/n8n/trigger`.

## Dashboard

- Comprobar KPIs con usuario real.
- Comprobar activities recientes si existen.
- Confirmar badges de datos reales, NowLabs AI backend y n8n externo preparado.

## Lockdown antes de demo

- No tocar `.env.local`.
- No cambiar el webhook real de n8n.
- No editar RLS ni redirects de Supabase si todo funciona.
- No instalar paquetes.
- Revisar `docs/DEMO_LOCKDOWN.md`.

## Deploy

- Ejecutar `npm run lint`.
- Ejecutar `npm run build`.
- Configurar variables en proveedor.
- Configurar URLs de callback/reset en Supabase.
- Activar Confirm email ON cuando exista dominio + Resend.

---

## Hardening checks (fase final 2026-05)

Estos checks cubren los fixes del último hardening. **Ejecutarlos antes de cualquier demo o deploy.**

### Google Calendar — read-only y 410 Gone

- [ ] Conectar Google Calendar con cuenta que tenga al menos un calendario **compartido en solo lectura** (e.g. festivos de España).
- [ ] Importar y verificar que aparece con badge "Solo lectura" en `/calendar`.
- [ ] Abrir un evento read-only: el modal lo abre como "Ver evento", inputs deshabilitados, botón Guardar oculto.
- [ ] Intentar borrar un evento read-only desde el botón Trash: debe mostrar toast informativo, no borrar.
- [ ] Desde NowLabs AI: `cancela esa cita de los festivos` → debe responder algo como "viene de un calendario de solo lectura...".
- [ ] Desde NowLabs AI: `muévela a otra hora` sobre un evento read-only → mismo bloqueo claro.
- [ ] Cancelar un evento **propio** desde NowLabs AI → confirmar que aparece como cancelado en NowCRM y en Google.
- [ ] Cancelar dos veces el mismo evento (segunda vez ya está borrado en Google): debe responder `ok:true, synced:true` o `ok:true, synced:false, reason:'google_api_error'` solo si fue otro fallo. **No debe fallar con 5xx** por el 410 Gone.

### NowLabs AI — bloqueos read-only

- [ ] `search_calendar_events` devuelve `[solo lectura]` en la línea de eventos importados read-only.
- [ ] `prepare_cancel_multiple_bookings` ejecutada sobre una lista mixta (read-only + escribibles): debe cancelar solo las escribibles y avisar `No incluyo N cita(s) de calendarios de Google de solo lectura`.
- [ ] `prepare_cleanup_duplicates` ejecutada cuando hay <2 eventos escribibles: responde `Solo encuentro X cita(s) editable(s)...`.

### n8n — sanitización de respuesta

- [ ] Configurar un workflow real en n8n y disparar `/api/n8n/trigger` (real_mode).
- [ ] Verificar respuesta JSON: contiene `ok`, `status`, `event_type`, `mode`, `http_status`, `duration_ms`, opcionalmente `execution_id`, `n8n_response: { executionId?, messagePreview? }`.
- [ ] **Asegurar que NO** aparece: headers de n8n, payload completo de workflow, tokens, ni respuesta cruda.

### n8n — schema real

- [ ] Activar un flow desde `/settings` con `webhookUrl` real.
- [ ] Verificar en Supabase Studio que el row de `n8n_flows` tiene columnas `name`, `trigger_event`, `requires_supabase`, `requires_whatsapp`, `requires_payment_api` populadas.
- [ ] Modificar el toggle del flow desde `/automations`: no debe lanzar 500.

### Integrations — provider y config

- [ ] Cambiar el estado de cualquier integración desde `/settings`.
- [ ] Verificar en Supabase Studio que el row de `integrations` tiene `provider` (no `key`) y `config` jsonb con `description/category/info`.

### WhatsApp Meta — HMAC y production guard

- [ ] `GET /api/integrations/meta/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=<correct>&hub.challenge=abc` → devuelve `abc` con status 200.
- [ ] Mismo GET con token incorrecto → 403.
- [ ] `POST` con `META_APP_SECRET` configurado y sin header `X-Hub-Signature-256` → 401.
- [ ] `POST` con `META_APP_SECRET` configurado y header inválido → 401.
- [ ] `POST` con firma válida → 200, mensaje encolado a `/api/inbox/whatsapp/inbound`.
- [ ] **Producción** (`NODE_ENV=production`) sin `META_APP_SECRET` configurado → POST debe devolver **503** ("Webhook signing not configured"). En dev/local solo logguea warning.
- [ ] `GET /api/integrations/meta/whatsapp/status` resuelve usando `connection_status` y devuelve estado coherente.

### Inbox Agent Settings

- [ ] Activar/desactivar auto-reply desde `/settings` → persiste tras recargar.
- [ ] Verificar en Supabase Studio que el row de `inbox_agent_settings` tiene `enabled` y `auto_reply_enabled` (no `status`).

### Service role GRANTs (Supabase)

- [ ] `/api/debug/google-calendar-connection?probe=write` (sin conexión real existente) → `probe.ran:true` y todas las operaciones devuelven ok.
- [ ] Disparar `/api/agent/tool` con `create_client` (si secret configurado) → no falla por `42501` permission denied.
- [ ] `/api/inbox/whatsapp/inbound` con un payload de prueba → crea conversation+message en Supabase sin error de grant.

### Build & lint

- [ ] `npm run lint -- --max-warnings=0` ✅ sin warnings.
- [ ] `npx tsc --noEmit` ✅ sin errores.
- [ ] `npm run build` ✅ todas las páginas generadas.

