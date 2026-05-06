# NowCRM Functional Audit

## Estado general

NowCRM esta en un estado solido como demo SaaS premium: la navegacion principal compila, el modo demo funciona y Supabase Auth esta integrado para login, registro, callback, logout y reset password. La personalizacion basica de usuario/workspace se lee desde `user_metadata`.

El CRM operativo sigue siendo mayoritariamente mock/local state. Las tablas reales de Supabase existen en el proyecto, pero las pantallas internas todavia no hacen CRUD contra `clients`, `conversations`, `messages`, `invoices`, `calendar_events`, `automations`, `integrations`, `n8n_flows` ni `activities`. n8n e IA estan preparados visualmente y como helpers simulados, pero no hay endpoints reales ni API routes internas.

## Matriz de estado

| Modulo | Estado actual | Real / Mock / Mixto | Problemas | Siguiente accion |
| --- | --- | --- | --- | --- |
| Auth | Login, signup, callback, reset password y logout usan Supabase client. El modo demo entra a `/dashboard` y hace signOut previo. | Mixto | Si email confirm esta OFF, el copy de signup sigue diciendo que confirme email aunque Supabase puede crear sesion inmediata. No hay middleware de proteccion de rutas. | Cerrar UX de signup segun confirm email ON/OFF y decidir proteccion de rutas reales. |
| Usuario/workspace | `useCurrentUser()` lee `supabase.auth.getUser()` y usa `user_metadata` para nombre, email, workspace, iniciales y trial. | Mixto | No consulta tablas `profiles`/`workspaces`; si metadata no refleja el trigger real, la UI puede mostrar fallback. Modo demo se infiere por ausencia de usuario, no por flag persistente. | Crear helper server/client de workspace real con fallback a metadata. |
| Dashboard | Metricas, insights, actividad, grafica y acciones IA funcionan visualmente. Personaliza saludo con usuario/workspace. | Mock | Datos vienen de `mock-data.ts`; acciones llaman a `triggerN8nWebhook()` simulado y actividad se actualiza solo en estado local. | Leer KPIs, actividades e insights desde Supabase. |
| Assistant | Chat usable, respuestas generadas por funcion local, quick actions y panel IA funcionan. | Mock | No hay API route de IA, no guarda mensajes en Supabase, conversaciones salen de `mock-data.ts`. Respuestas son reglas locales, no modelo real. | Crear persistencia `conversations/messages` y endpoint IA. |
| Clients | Tabla, filtros y modal "Nuevo cliente" funcionan en local state. | Mock | Crear cliente no inserta en Supabase; no hay editar, borrar ni detalle real. Validacion minima. | Implementar CRUD real contra `clients` con RLS por workspace. |
| Automations | Cards, toggles, ejecutar, copiar URLs y seccion n8n funcionan visualmente. | Mock | Estados quedan en memoria; `triggerN8nWebhook()` no hace POST real; no guarda `n8n_flows` ni automations reales. | Migrar automations/n8n_flows a Supabase y crear API route para disparos. |
| Calendar | Calendario semanal, modal nuevo evento y agendar llamada funcionan en local state. | Mock | Eventos no se guardan en `calendar_events`; fechas demo estan fijas en mayo 2026. | CRUD real de eventos y normalizar fechas actuales. |
| Billing | Facturas, nueva factura, filtros y marcar pagada funcionan en local state. | Mock | No actualiza `invoices` real; importes/metrica total son mock; no hay Stripe ni actividad persistente. | CRUD real de facturas y estados de pago. |
| Settings | Control center muy completo: Supabase status por env, n8n flows editables, integraciones demo, WhatsApp simulado, trial/demo visual. | Mixto | Supabase status solo detecta variables; no prueba conexion ni tablas. n8n URL/flows/integraciones se guardan solo en memoria. | Conectar settings a `integrations` y `n8n_flows`; anadir health checks seguros. |
| Supabase | Cliente browser configurado con `flowType: 'pkce'`, persistencia y variables publicas. Auth real funciona a nivel cliente. | Mixto | No hay capa de datos para tablas reales ni tipos generados de DB. No hay middleware/session server. | Crear `database.types.ts` y repositorios por entidad. |
| n8n | Existe `src/lib/integrations.ts` con catalogo de flujos, requisitos y simuladores. UI permite probar/toggle/copy. | Mock | `triggerN8nWebhook()` solo hace `console.log` y delay; no hay endpoint interno, firma, auth ni retries. | Crear API route `/api/n8n/trigger` y guardar configs en Supabase. |
| IA | Assistant simula IA con reglas locales; dashboard muestra insights mock. | Mock | No hay API route, proveedor IA, streaming, memoria, guardado ni evaluacion de conversaciones reales. | Implementar endpoint IA con contexto desde Supabase y persistencia. |

## Que funciona ya

- `/login` carga como entrada principal y `/` redirige a `/login`.
- Modo demo entra a `/dashboard` y mantiene datos mock.
- Login real usa `supabase.auth.signInWithPassword({ email, password })`.
- Registro real usa Supabase `signUp` con `emailRedirectTo` absoluto a `/auth/callback`.
- Registro envia metadata: `full_name`, `workspace_name`, `company_name`, `trial_status`, `onboarding_completed`.
- `/auth/callback` lee `code`, ejecuta `exchangeCodeForSession(code)` y redirige a `/dashboard` si hay sesion.
- Forgot password usa `resetPasswordForEmail` con redirect absoluto a `/reset-password`.
- `/reset-password` intercambia `code`, valida sesion y ejecuta `updateUser({ password })`.
- Logout en sidebar ejecuta `supabase.auth.signOut()` y vuelve a `/login`.
- Sidebar, Topbar, Dashboard y Settings muestran identidad desde `user_metadata` cuando existe sesion.
- Clientes: buscar, filtrar y crear cliente local.
- Assistant: enviar mensaje local, recibir respuesta simulada y ejecutar quick actions.
- Automatizaciones: activar/pausar visualmente y ejecutar webhook simulado.
- Calendario: crear evento local y agendar llamada visual.
- Facturacion: crear factura local y marcar pagada visual.
- Settings: explica arquitectura demo y muestra Supabase/n8n/WhatsApp/integraciones como control center.

## Que es solo demo/mock

- Datos de dashboard: `dashboardMetrics`, `aiInsights`, `recentActivity`, `weeklyLeads`.
- Busqueda global de Topbar y notificaciones.
- Clientes y alta de clientes.
- Conversaciones, mensajes y respuestas del Assistant.
- Lead score, sentimiento, intencion y recomendaciones IA.
- Automatizaciones, emails enviados, webhooks y estados.
- Calendario y eventos.
- Facturas, estados de pago, metricas y graficas.
- WhatsApp Business y lead entrante simulado.
- Integraciones externas y toggles de Settings.
- n8n: URLs, toggles, pruebas y triggers.
- IA real: no hay llamada a modelo ni API route.

## Que esta roto o incompleto

- No hay CRUD real contra las tablas Supabase creadas.
- No hay API routes internas para IA, n8n, WhatsApp, billing o integraciones.
- No hay middleware de proteccion de rutas; `/dashboard` y rutas SaaS son accesibles aunque no haya usuario real.
- `useCurrentUser()` no consulta `profiles` ni `workspaces`; solo `user_metadata`.
- Si el trigger de Supabase crea workspace/profile pero no actualiza metadata, la UI no vera esos datos.
- El modo demo se basa en ausencia de sesion; no existe un estado explicito de demo persistente.
- Signup siempre muestra mensaje de confirmar email, incluso si confirm email esta temporalmente OFF.
- Los helpers de n8n hacen `console.log` y delay; no ejecutan POST real.
- Assistant no guarda mensajes ni actividad.
- Acciones como "Marcar pagada", "Nuevo cliente", "Agendar llamada" o "Activar secuencia" no persisten al recargar.
- Hay texto con caracteres mojibake en algunas cadenas heredadas (`ConfiguraciÃ³n`, `FacturaciÃ³n`, etc.). No rompe build, pero conviene normalizar antes de demo publica.

## Prioridad antes de n8n

1. Consolidar Auth y sesion: decidir confirm email ON/OFF, rutas protegidas y flujo post-signup.
2. Implementar lectura real de `profiles` y `workspaces` con fallback a metadata.
3. Crear capa de datos Supabase por workspace: clients, invoices, calendar_events, conversations/messages, activities.
4. Migrar las acciones demo principales a CRUD real.
5. Registrar `activities` reales para cada accion importante.
6. Solo despues conectar n8n, usando datos reales y webhooks autenticados.

## Plan recomendado para hacer todo funcional

### Fase 1: Auth estable

- Mantener login/signup/reset/callback con Supabase.
- Anadir middleware o guard client para rutas privadas.
- Leer perfil/workspace desde tablas reales.
- Resolver UX distinta para email confirmation ON/OFF.
- Definir modo demo explicito separado de sesion real.

### Fase 2: Supabase CRUD

- Generar tipos de base de datos.
- Crear helpers/repositorios por entidad.
- Migrar `/clients` a CRUD real.
- Migrar `/billing` a CRUD real de facturas.
- Migrar `/calendar` a CRUD real de eventos.
- Guardar actividades en `activities`.

### Fase 3: Assistant persistente

- Leer `conversations` y `messages` desde Supabase.
- Guardar cada mensaje enviado/recibido.
- Vincular conversaciones a clientes/workspace.
- Registrar acciones IA como activities.

### Fase 4: n8n webhooks

- Guardar `n8n_flows` e `integrations` en Supabase.
- Crear API route interna para disparar webhooks sin exponer secretos.
- Validar URL, payload, estado y permisos por workspace.
- Sustituir `triggerN8nWebhook()` simulado por llamada controlada al backend.

### Fase 5: IA real

- Crear API route de Assistant.
- Construir contexto desde clientes, conversaciones, facturas y calendario.
- Guardar respuesta IA en `messages`.
- Anadir streaming si compensa.
- Registrar recomendaciones y acciones sugeridas.

## Validacion

- `npm run lint`: OK.
- `npm run build`: OK.
