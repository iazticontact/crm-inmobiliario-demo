# NowCRM Functional Audit

## Estado general

NowCRM ya no es solo una demo visual. Auth, usuario/workspace, clientes, facturacion, calendario y parte del assistant estan conectados a Supabase cuando existe una sesion real y un workspace. El modo demo sigue disponible y mantiene mock data para poder ensenar el producto sin cuenta real.

La app sigue usando fallbacks prudentes: si Supabase no devuelve workspace, RLS bloquea una consulta o una tabla no coincide con el schema esperado, la pantalla cae a demo/local state y muestra feedback sin romper la UI.

## Matriz de estado

| Modulo | Estado actual | Real / Mock / Mixto | Problemas | Siguiente accion |
| --- | --- | --- | --- | --- |
| Auth | Login, signup, callback, reset password y logout usan Supabase. Demo mode sigue entrando a `/dashboard`. | Real + demo | Confirm email puede estar OFF en local; middleware server no implementado. | Activar confirm email con dominio/Resend y cerrar proteccion server. |
| Usuario/workspace | Sidebar, Topbar, Dashboard y Settings usan usuario/workspace real con fallback a metadata/demo. | Mixto | Si profile/workspace falta por RLS, usa fallback. | Tipos DB generados y helper server compartido. |
| Dashboard | Lee clientes, facturas, eventos, conversaciones y activities si hay workspace real. | Mixto | Insights/grafica semanal siguen mock. | KPIs historicos reales y analytics por fecha. |
| Assistant | Carga conversations/messages reales, guarda mensajes y genera respuesta IA mock inteligente. | Mixto | La IA no llama proveedor externo. Schema `messages` debe aceptar `sender` o ajustarse. | API route de IA real con contexto Supabase. |
| Clients | CRUD real de clients, notas incluidas, confirmacion de borrado y fallback demo. | Real + demo | Falta detalle avanzado y importacion. | Vista detalle, tags y pipeline. |
| Automations | UI premium con estados visuales y helper n8n preparado. | Mock | No persiste automations reales. | Migrar `automations` y `n8n_flows`. |
| Calendar | CRUD real de `calendar_events`, modal, loading, empty state y fallback demo. | Real + demo | Semana demo fija para vista principal. | Calendario por fecha actual y sincronizacion externa. |
| Billing | CRUD real de `invoices`, marcar pagada, eliminar, metricas reales y fallback demo. | Real + demo | No hay Stripe ni pagos reales. | Stripe/checkout y recordatorios. |
| Settings | Control center actualizado: Supabase, Auth, Clients, Billing, Calendar, Assistant, n8n y canales. | Mixto | Toggles n8n/integraciones aun no persisten en Supabase. | Persistir settings por workspace. |
| Supabase | Browser client, helpers por entidad y escritura real en varias tablas. | Mixto | No hay tipos generados de Supabase. | Generar `database.types.ts`. |
| n8n | API route `/api/n8n/trigger`, payload base y helper cliente preparados. | Preparado | No hay n8n real, firma ni secretos server. | Guardar endpoints y autenticar webhooks. |
| IA | Mock inteligente por intencion comercial/soporte/cobro/demo. | Mock preparado | Sin OpenAI/Anthropic/n8n agent. | Endpoint IA real y evaluacion. |

## Que funciona ya

- Modo demo completo para entrar, navegar y salir.
- Auth real con Supabase: login, signup, callback, reset password y logout.
- Personalizacion de usuario/workspace en Sidebar, Topbar, Dashboard y Settings.
- CRUD real de clientes con notas.
- CRUD real de facturas y metricas basicas reales.
- CRUD real de eventos de calendario.
- Persistencia de conversations/messages en Assistant con respuesta IA mock.
- Activities best-effort para acciones importantes.
- API route interna para probar/disparar n8n sin exponer secretos.
- Dashboard mezcla datos reales disponibles con widgets demo.
- Lint y build pasan.

## Que es solo demo/mock

- IA real con proveedor externo.
- n8n real con workflows productivos.
- WhatsApp/Meta/Instagram/SMTP/Slack reales.
- Stripe o pagos reales.
- Automations persistentes completas.
- Analytics historico del dashboard.
- Vista avanzada de pipeline/deals.
- Emails transaccionales con dominio propio.

## Que esta roto o incompleto

- Nada critico detectado tras `npm run lint` y `npm run build`.
- Algunas tablas dependen de que el schema de Supabase tenga las columnas esperadas. Si no, hay fallback/documentacion en `SUPABASE_SCHEMA_NOTES.md`.
- Settings todavia no persiste toggles ni endpoints n8n en `n8n_flows`.
- La vista semanal de calendario conserva fechas demo fijas; los eventos reales se listan y persisten, pero el grid principal no es calendario dinamico completo.
- Assistant guarda mensajes, pero la IA sigue siendo mock local.

## Prioridad antes de n8n

1. Verificar columnas reales de `invoices`, `calendar_events`, `conversations`, `messages` y `activities`.
2. Generar tipos Supabase y ajustar helpers a schema definitivo.
3. Persistir `n8n_flows` e `integrations` desde Settings.
4. Definir auth/firma para webhooks internos.
5. Conectar primer workflow n8n con un evento real: nuevo lead o factura vencida.

## Plan recomendado para hacer todo funcional

### Fase 1: Auth estable

- Activar Confirm email con dominio real y Resend.
- Anadir URLs finales de callback/reset en Supabase.
- Implementar guard server si se necesita proteccion mas fuerte.

### Fase 2: Supabase CRUD

- Consolidar schema y tipos generados.
- Completar automations, integrations y activities.
- Anadir detalle de cliente y relaciones entre cliente/factura/evento/conversacion.

### Fase 3: Assistant persistente

- Mantener persistence actual de messages.
- Crear API route IA real.
- Construir contexto con clients, billing, calendar y conversations.

### Fase 4: n8n webhooks

- Guardar URL base y endpoints por workspace.
- Disparar `/api/n8n/trigger` desde acciones reales.
- Anadir firma/retries/logs.

### Fase 5: IA real

- Conectar OpenAI/Anthropic/n8n agent.
- Guardar outputs y actividades.
- Evaluar intencion, sentimiento y acciones sugeridas reales.

## Validacion

- `npm run lint`: OK.
- `npm run build`: OK.
