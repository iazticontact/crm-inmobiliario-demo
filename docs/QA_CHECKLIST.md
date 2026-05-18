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

---

## Hardening checks (sesión nocturna 2026-05-17) — Calendar cancel sync

Cubre el bug crítico: "cancelar desde el Calendar del CRM no eliminaba el evento en Google Calendar".

### Causa raíz reparada

- La UI hacía soft-cancel local (o DELETE en fallback) ANTES de llamar a la route Google.
- La llamada a Google se hacía como `void fetch(...)` (fire-and-forget): los errores nunca llegaban al usuario.
- Si el fallback hacía HARD DELETE, el row se eliminaba y la route no podía leer `google_event_id` → Google nunca recibía DELETE.
- Toast siempre decía "Evento cancelado correctamente" aunque Google fallase.

### Reparación

- `POST /api/integrations/google/calendar/cancel-event` ahora es atómica: hace Google DELETE y soft-cancel local en la misma transacción lógica.
- Devuelve un contrato JSON estable: `{ ok, localCancelled, googleCancelled, googleAlreadyGone, reason, message, synced }`.
- Calendar UI y Assistant page ahora llaman esta route con `await` y muestran toast según el resultado real.
- Multi-calendar: cancel-event/update-event/sync-event ahora consideran `default_calendar_id` antes del fallback a `primary`.

### Checklist Calendar UI

- [ ] Crear evento desde NowCRM en el calendario por defecto. Aparece en Google.
- [ ] Cancelar el mismo evento desde el botón Trash. Toast: "Evento cancelado: ... También se eliminó en Google Calendar."
- [ ] Verificar en Google: el evento ha desaparecido del calendario por defecto.
- [ ] Crear evento desde NowCRM cuando el usuario tiene **default_calendar_id** distinto de primary. Verificar que se crea en el calendario correcto en Google.
- [ ] Cancelar ese evento desde NowCRM. Verificar que desaparece del calendario correcto (no del primary).
- [ ] Borrar manualmente un evento en Google → cancelarlo desde NowCRM → toast: "Evento cancelado: ... En Google ya no existía." y no aparece error 500.
- [ ] Importar evento read-only (festivos) → intentar cancelar desde Trash → toast: "Este evento es solo lectura. Cancélalo desde Google Calendar."
- [ ] Forzar token inválido (rotar refresh_token en Google) → cancelar → toast: "Google requiere reconexión. Reconecta Google Calendar desde Configuración." y el evento NO debe quedar cancelado en NowCRM.
- [ ] Desconectar Google → cancelar evento que tenía `google_event_id` → toast: "Evento cancelado: ... Google Calendar no está conectado — reconéctalo..."
- [ ] Doble click sobre Trash: el segundo click debe estar bloqueado por `deleting=true`.

### Checklist Assistant cancel sync

- [ ] Crear cita con NowLabs AI → Google la recibe.
- [ ] Cancelar con NowLabs AI ("cancela esa cita") → confirmar → mensaje: "Cita ... cancelada (también en Google)."
- [ ] Cancelar cita ya borrada en Google → mensaje: "... cancelada (en Google ya no existía)."
- [ ] Pedir cancelar todas las citas del día con read-only entre medias → resumen: "X canceladas correctamente (Y sincronizada(s) con Google, Z omitida(s) por solo lectura)".
- [ ] Cleanup duplicates con read-only entre los duplicados → resumen incluye "N omitida(s) por solo lectura".
- [ ] Si Google requiere reconexión, ninguna cita queda cancelada localmente y se reporta `needs_reconnect`.

### Reasons que la route puede devolver

| reason | significado | acción esperada |
|---|---|---|
| `cancelled` | Google + local OK | success completo |
| `not_synced_to_google` | sin google_event_id | success local |
| `not_connected` | sin connection activa | success local + sugerir reconectar |
| `credentials_not_configured` | faltan GOOGLE_CLIENT_* en server | success local + alerta operador |
| `read_only_event` | is_read_only=true | bloqueo claro |
| `event_not_found` | no existe en workspace | 404 informativo |
| `needs_reconnect` | invalid_grant o 401 Google | NO cancela local; pedir reconectar |
| `google_forbidden` | 403 Google | NO cancela local; problema de permisos |
| `rate_limited` | 429 Google | NO cancela local; reintentar |
| `google_api_error` | otros 5xx Google | NO cancela local; reintentar |
| `google_fetch_error` | fallo de red al llamar Google | NO cancela local |
| `local_cancel_failed` | UPDATE Supabase falló | error 500 honesto |

---

## Hardening checks (sesión nocturna 2026-05-17) — Inbox WhatsApp + Agent + n8n foundation

### Webhook Meta

- [ ] `GET /api/integrations/meta/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=<correct>&hub.challenge=abc` → devuelve `abc`.
- [ ] Mismo GET con token incorrecto → 403.
- [ ] `POST` en `NODE_ENV=production` sin `META_APP_SECRET` → 503.
- [ ] `POST` con firma válida → 200, mensaje encolado a `/api/inbox/whatsapp/inbound`.

### Inbox UI

- [ ] `/inbox` carga sin 500.
- [ ] Sidebar muestra "Inbox" entre Dashboard y Asistente IA.
- [ ] Filtro de status filtra correctamente.
- [ ] Filtro de canal filtra correctamente.
- [ ] Click en conversación carga mensajes en orden cronológico.
- [ ] Empty state si no hay conversaciones (no flash mock).
- [ ] Cambiar status desde el dropdown se persiste.
- [ ] Botón "Archivar" mueve a archived y refresca lista.

### NowLabs WhatsApp Agent

- [ ] Botón "Sugerir respuesta" rellena el composer con texto en español.
- [ ] Botón "Resumir" con persist=true actualiza `ai_summary` (visible en lista).
- [ ] Botón "Clasificar intención" actualiza `intent` y muestra confidence.
- [ ] Botón "Detectar sentimiento" actualiza badge en la lista.
- [ ] Botón "Análisis completo" hace los 3 (summary+intent+sentiment) en una sola llamada.
- [ ] Si `OPENAI_API_KEY` falta → toast "Falta OPENAI_API_KEY en el servidor".
- [ ] Si conversación vacía → toast "No hay mensajes para analizar".
- [ ] Sentimiento `negative` o `urgent` → la decisión marca `needs_human=true` automáticamente.

---

## Vertical Pack v1 — NowLabs AI tools (2026-05-18)

Cubre las 9 tools verticales (3 reads + 6 writes) sobre `opportunities`,
`service_cases` y `properties`. Todas son workspace-scoped y RLS-aware.
Las escrituras requieren confirmación verbal en chat.

### /opportunities (UI)

- [ ] `/opportunities` carga sin 500 con usuario real.
- [ ] Tabs (Todos / Inmobiliaria / Extranjería / Servicios) cambian el filtrado.
- [ ] KPI strip muestra contadores reales (no `—` ni `0` con datos).
- [ ] Empty states aparecen cuando no hay rows del workspace.
- [ ] Refrescar (botón) recarga las 3 listas.
- [ ] Catálogos de plantillas y automatizaciones se muestran como estáticos.

### NowLabs — lecturas verticales

- [ ] `Enséñame oportunidades abiertas` → lista numerada, sin asteriscos.
- [ ] `Qué oportunidades tengo en negociación` → filtra por stage.
- [ ] `Qué expedientes están pendientes de documentación` → filtra por status.
- [ ] `Propiedades activas en Marbella` → filtra por city.
- [ ] Si no hay rows, responde "Sin … en ese filtro."

### NowLabs — escrituras (con confirmación verbal)

- [ ] `Crea un lead inmobiliario para Ana que quiere vender un piso en Málaga` →
      el agente describe la oportunidad y pregunta "¿la creo?" antes de
      llamar la tool.
- [ ] Tras "sí" / "ok" / "créala" → ejecuta `create_opportunity` y confirma
      con el título, vertical y etapa creados.
- [ ] Tras "no" / "espera, cambia X" → no llama la tool.
- [ ] Orden inequívoca ("crea ya la oportunidad de Ana, 250k, vertical inmobiliario")
      → puede crear sin doble confirmación y reporta la creación.
- [ ] `Pasa la oportunidad de Ana a visita agendada` → si no tiene UUID,
      llama primero `list_opportunities` y luego `update_opportunity_stage`.
- [ ] `Abre un expediente de extranjería para renovación de NIE de Ana` →
      pregunta confirmación → `create_service_case` con `case_type=nie_renewal`
      y `vertical=immigration` por defecto.
- [ ] `Pasa este expediente a documentación pendiente` → `update_service_case_status`
      con `status=documentation_pending`.
- [ ] `Crea una propiedad en captación en Marbella` → `create_property`
      con `status=prospecting` y `city=Marbella`.
- [ ] `Pasa esta propiedad a listed` → `update_property_status`.

### Multi-tenant y RLS

- [ ] El agente NUNCA devuelve rows de otro workspace en `list_*`.
- [ ] Crear una oportunidad desde NowLabs deja un row en `activities` con
      `type=opportunity_created`, `workspace_id` del usuario y
      `metadata.source='nowlabs_agent'`.
- [ ] Cambiar stage de una oportunidad deja un row con
      `type=opportunity_stage_updated`.
- [ ] Los mismos tipos existen para `service_case_*` y `property_*`.
- [ ] Si Supabase no está configurado, el agente degrada con mensaje
      controlado, sin lanzar 5xx.

### Lo que NO se prueba aquí

- Ejecución real de los workflows n8n del catálogo (requiere VPS).
- Edición avanzada de oportunidades/expedientes ya creados (hoy solo
  cambia stage/status inline).

---

## Vertical Pack v1 — UI humana (Prompt B, 2026-05-18)

Cubre la fase B: creación/edición desde UI, Cliente 360 y operaciones
vinculadas a entidades verticales sin pasar por NowLabs AI. Las acciones
UI y las del agente convergen sobre las mismas tablas con activity log
paralelo (`metadata.source` = `ui_manual` vs `nowlabs_agent`).

### /operaciones (antes /opportunities)

- [ ] Sidebar muestra "Operaciones" (no "Oportunidades").
- [ ] PageHeader: "Operaciones". Subtítulo menciona pipeline, expedientes y
      propiedades.
- [ ] Subtabs Pipeline / Expedientes / Propiedades / Plantillas /
      Automatizaciones cambian la sección visible.
- [ ] Botones "Nueva oportunidad / Nuevo expediente / Nueva propiedad"
      visibles en el header.
- [ ] Drawer Nueva oportunidad: crea fila, refresca lista, dispara toast.
- [ ] Drawer Nuevo expediente: crea fila, registra activity
      `service_case_created`.
- [ ] Drawer Nueva propiedad: crea fila, registra activity
      `property_created`.
- [ ] Inline `<select>` por fila cambia stage/status — optimista, rollback
      en error, toast de éxito.
- [ ] Tab Plantillas muestra los mensajes según vertical activo.
- [ ] Tab Automatizaciones lista las 10 entradas del catálogo.

### Cliente 360

- [ ] Click en el icono "Eye" de un cliente abre el drawer.
- [ ] Header del drawer muestra nombre, empresa, email, canal, status,
      lead_score, sugerencia de próxima acción.
- [ ] StatPill row: oportunidades / expedientes / propiedades / facturas
      con detalle correcto.
- [ ] Sección Oportunidades lista las del cliente con etapa, vertical y
      valor.
- [ ] Sección Expedientes lista con tipo y estado.
- [ ] Sección Propiedades lista con tipo, operación, ciudad, precio.
- [ ] Sección Conversaciones muestra los hilos vinculados.
- [ ] Sección Facturas muestra número, importe y estado.
- [ ] Sección Próximas citas muestra fecha + hora derivada de
      startHour/startMinute.
- [ ] Sección Actividad reciente muestra los últimos 8 logs.
- [ ] Botón "Crear oportunidad/expediente/propiedad" abre el drawer
      correspondiente con `defaultClientId` y `defaultClientName`
      pre-rellenos; al guardar, la entidad nueva aparece vinculada al
      cliente.

### /inbox

- [ ] En el panel derecho de cualquier conversación seleccionada, aparece
      el bloque "Acciones manuales".
- [ ] El botón "Crear oportunidad desde esta conversación" abre el drawer
      de Nueva oportunidad con `defaultClientId` (si existe) y `source =
      channel` pre-rellenos.
- [ ] La oportunidad creada aparece luego en /operaciones y en el Cliente
      360 del cliente vinculado.

### /automations

- [ ] Sección "Automatizaciones verticales preparadas" arriba del banner
      amarillo.
- [ ] 10 cards con badge "Preparada", vertical, canal y dependencias.
- [ ] Botón "Activar cuando n8n esté conectado" disabled.

### /dashboard

- [ ] Las 3 quick-link cards (Pipeline · Expedientes · Propiedades)
      muestran contadores reales del workspace cuando hay sesión real.
- [ ] Pipeline card incluye valor total en pipeline si existe.
- [ ] Expedientes card señala los que están en documentation_pending.
- [ ] Propiedades card distingue captación vs publicadas.

### /settings

- [ ] Nueva card "Vertical del workspace" con 5 opciones (General,
      Inmobiliaria, Extranjería, Servicios, Mixto).
- [ ] Seleccionar y pulsar Guardar persiste en `localStorage`
      (`nowcrm.workspaceVertical`).
- [ ] Tras recargar `/settings`, la opción guardada queda marcada.
- [ ] Toast confirma el guardado y advierte que es persistencia local.

### Activity log paralelo

- [ ] Crear oportunidad desde UI deja `activities.metadata.source =
      'ui_manual'` y `type = 'opportunity_created'`.
- [ ] Crear oportunidad desde NowLabs AI deja `metadata.source =
      'nowlabs_agent'` y mismo `type`.
- [ ] Cambiar stage desde UI registra `opportunity_stage_updated`.
- [ ] Cambiar stage vía agente registra el mismo type con otro source.
- [ ] Dashboard / Cliente 360 muestran las dos clases de actividad sin
      duplicar.

### Inbox API

- [ ] `GET /api/inbox/conversations?status=open` solo devuelve abiertas del workspace.
- [ ] `GET /api/inbox/conversations/<otro-workspace-id>` devuelve 404 (workspace guard).
- [ ] `PATCH /api/inbox/conversations/<id>` con body `{ status: 'resolved' }` actualiza solo si pertenece al workspace.
- [ ] `POST /api/inbox/conversations/<id>/messages` con `mode:'draft'` inserta `metadata.mode='draft'` y NO llama a Meta.
- [ ] `POST .../messages` con `mode:'send'` sin token configurado → guarda como borrador con `metadata.simulated=true` y `send.reason='token_missing'`.
- [ ] `POST .../messages` con `mode:'send'` y cliente sin teléfono → 400 con `reason:'invalid_recipient'`.

### Outbound Meta helper

- [ ] `META_GRAPH_VERSION` override funciona (default v21.0).
- [ ] Respuesta nunca contiene el JSON crudo de Meta ni `Authorization` header.
- [ ] Reasons documentadas: sent, simulated, pending_config, token_missing, phone_number_id_missing, invalid_recipient, meta_api_error, rate_limited, network_error.

### Performance indices

- [ ] `EXPLAIN ANALYZE` de `SELECT FROM conversations WHERE workspace_id=X ORDER BY updated_at DESC LIMIT 50` usa `conversations_workspace_updated_idx`.
- [ ] Listado de mensajes de una conv usa `messages_conversation_created_idx`.

### Regression

- [ ] `/calendar` sigue funcionando.
- [ ] Cancel-event sigue cancelando en Google.
- [ ] `/assistant` sigue funcionando.
- [ ] `/settings` sin 500.
- [ ] `/automations` sin 500.

---

## Vertical Pack v1 — edición avanzada y vínculo Inbox (Fase C, 2026-05-18)

Cierre pre-VPS del Vertical Pack: edición completa de las 3 entidades y
`client_id` real en Inbox sin matching frágil por nombre.

### /operaciones — edición avanzada

- [ ] Pipeline: click en el título de una oportunidad abre el
      `EditOpportunityDrawer` con los datos rellenos.
- [ ] Icono ✎ en cada fila también abre el drawer.
- [ ] Editar título, vertical, etapa, valor, probabilidad, origen, fecha de
      cierre, notas y cliente vinculado → "Guardar cambios" persiste y
      cierra el drawer.
- [ ] Cambiar vertical reajusta la lista de etapas; si la etapa actual no
      existe en el nuevo vertical, se selecciona la primera disponible.
- [ ] CTA "Marcar perdida" deja `stage='lost'` sin DELETE.
- [ ] Expedientes: click en título o ✎ abre `EditServiceCaseDrawer`.
- [ ] CTA "Cerrar expediente" deja `status='closed'` sin DELETE.
- [ ] Propiedades: click en título o ✎ abre `EditPropertyDrawer`.
- [ ] CTA "Archivar" deja `status='archived'` sin DELETE.
- [ ] La fila editada se reemplaza en sitio sin refetch global (callback
      `onUpdated`).
- [ ] Cada edición registra `activities.type` ∈
      `{opportunity_updated, service_case_updated, property_updated}` con
      `metadata.source='ui_manual'`.

### ClientPicker

- [ ] Sin workspace activo el input está deshabilitado y muestra "Sin
      workspace activo".
- [ ] Escribir filtra por `name`, `email` o `company` con debounce ~180ms.
- [ ] Seleccionar un cliente lo muestra como pill con avatar inicial; el
      botón "x" lo quita.
- [ ] Sin resultados muestra "Sin resultados. Crea el cliente desde
      /clients."

### Inbox — vincular cliente

- [ ] Conversación sin `client_id`: aparece bloque "Sin vincular" con CTA
      "Vincular cliente →" (ya no disabled).
- [ ] Click abre un `ClientPicker` inline en el panel derecho.
- [ ] Seleccionar un cliente hace `PATCH /api/inbox/conversations/[id]`
      con `client_id` (UUID).
- [ ] El listado de conversaciones se refresca; la cabecera ya no muestra
      "Sin vincular".
- [ ] El endpoint devuelve 404 si el `client_id` no pertenece al
      workspace (validación server-side aparte del RLS).
- [ ] CTA "Quitar vínculo de cliente" envía `client_id: null` y el
      endpoint nulea `client_name` también.
- [ ] Crear oportunidad desde Inbox después de vincular usa el
      `client_id` real (no string libre).

---

## Hardening checks (cierre WhatsApp/Inbox/n8n — 2026-05-17 night)

Estos cubren los fixes críticos del cierre: n8n trigger seguro, Meta webhook
sin fire-and-forget, dedupe inbound, outbound persistido, config server-side.

### n8n trigger seguro

- [ ] `POST /api/n8n/trigger` sin sesión → **401** (antes era 200 simulado).
- [ ] `POST /api/n8n/trigger` con sesión válida + `webhook_url: 'https://attacker.example.com/x'` en el body → **el servidor IGNORA el body** y resuelve internamente. La respuesta indica `workflow_slug` real y nunca llama a attacker.
- [ ] `POST /api/n8n/trigger` con `event_type` que no está en la allowlist → **400** "event_type no reconocido".
- [ ] Sin `N8N_BASE_URL` → respuesta `status:'simulated'` con `reason:'n8n_base_url_missing'` y no se hace fetch.
- [ ] Con `N8N_BASE_URL=https://n8n.tu-dominio.com` y workflow inexistente → respuesta `status:'error'` con `http_status:404`. **No** se filtran headers ni payload de n8n.
- [ ] `workspace_id` distinto del workspace del usuario → **403**.
- [ ] Inspeccionar log servidor: NUNCA debe aparecer `N8N_WEBHOOK_SECRET` ni `N8N_API_KEY`.

### Meta webhook fiable (sin fire-and-forget)

- [ ] Logs servidor: `[meta/webhook] persisted batch { received: N, inserted: N, deduped: 0, failed: 0 }` después de un POST real.
- [ ] Dejar de configurar `NEXT_PUBLIC_APP_URL` → el webhook **sigue funcionando** (ya no depende de él).
- [ ] Quitar `SUPABASE_SERVICE_ROLE_KEY` → el webhook responde 200 con `persisted:false, reason:'service_role_missing'` y log de error claro. **Restaurar inmediatamente.**

### Dedupe inbound

- [ ] Enviar el mismo `messages[].id` dos veces (manualmente con curl) → segundo POST devuelve `deduped:true`, **no** inserta un mensaje duplicado.
- [ ] Si el schema NO tiene `messages.metadata`, el dedupe degrada a best-effort: la doble inserción es posible pero solo dentro de la misma race.

### Phone-based client linking

- [ ] Crear cliente con teléfono `+34 600 000 001`. Enviar inbound desde `34600000001`. Verificar que la conversación queda vinculada al cliente (panel derecho del Inbox muestra el cliente).
- [ ] Crear dos clientes con el mismo número → inbound desde ese número **no** vincula automáticamente (match ambiguo).
- [ ] Inbound de número sin cliente → conversación se crea sin `client_id` y NO se crea cliente automáticamente.

### Outbound persistence

- [ ] Pulsar "Borrador" → `messages.metadata.send_status = 'draft'`, badge "Borrador" en la burbuja.
- [ ] Pulsar "Enviar" sin `META_WHATSAPP_ACCESS_TOKEN` → toast "Guardado como borrador", `send_status:'pending_config'`, badge "Pendiente config".
- [ ] Pulsar "Enviar" con token configurado y `phone_number_id` válido → `send_status:'sent'`, `provider_message_id` presente, badge "Enviado".
- [ ] Pulsar "Enviar" con número inválido → `send_status:'failed'`, badge "Fallido".
- [ ] Response JSON nunca contiene `Authorization` header ni el JSON crudo de Meta.

### Config status

- [ ] `GET /api/config/status` sin sesión → 401.
- [ ] Con sesión → devuelve booleans (`hasAccessToken`, `hasAppSecret`, …) y `missingVariables: ['NAMES_ONLY']`. **Ningún valor.**
- [ ] Quitar `OPENAI_API_KEY` → Inbox muestra banner "NowLabs AI no está activo", botones IA disabled, toggle de auto-reply bloqueado en Settings.
- [ ] Quitar `META_APP_SECRET` → Settings/WhatsApp muestra "Pendiente en servidor: META_APP_SECRET".
- [ ] Cuando todo está ready, los banners desaparecen.

### Webhook URL pública

- [ ] Probar en local con `cloudflared tunnel --url http://localhost:3000` o `ngrok http 3000`.
- [ ] Pegar `https://TUNEL/api/integrations/meta/whatsapp/webhook` en Meta Developers → Verify → OK.
- [ ] Enviar mensaje real al test number → aparece en `/inbox` en ≤ 5 segundos.

### Lo que NO se debe probar todavía

- ❌ Auto-reply activo enviando mensajes reales (sigue OFF por defecto).
- ❌ Workflows n8n nuevos sin haber actualizado primero `EVENT_TO_WORKFLOW_SLUG`.
- ❌ Conexión n8n MCP — fase posterior, no abrir esa superficie aún.

