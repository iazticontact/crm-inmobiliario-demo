# Vertical Pack — Real Estate + Extranjería (v1)

> Esta fase añade a NowCRM una capa de producto para clientes que combinan
> **inmobiliaria** y **gestoría / extranjería**. La arquitectura es reutilizable
> para asesorías, consultoras y servicios profesionales en general.
> **Ningún dato del formulario del cliente se ha commiteado**: los catálogos son
> genéricos y los datos del workspace siguen siendo del workspace.

## 1. Qué pidió el cliente (en abstracto)

El formulario del cliente firmado mencionaba estos bloques operativos:

- Asesoría general y gestión de clientes.
- Captaciones inmobiliarias.
- Administración de propiedades.
- Inmobiliaria (ventas/alquileres).
- Extranjería y trámites administrativos.
- Atención multicanal (WhatsApp / Instagram / web).
- Propuestas comerciales, facturación, agenda y reportes.

Nada de esto está hardcodeado en el código: lo traducimos a **módulos
reutilizables** que cualquier futuro cliente del mismo perfil puede usar.

## 2. Traducción a módulos NowCRM

| Necesidad del cliente | Módulo NowCRM | Estado |
|---|---|---|
| Pipeline comercial inmobiliario | `opportunities` tabla + `/opportunities` con pipeline inmobiliario (Nuevo lead → Cerrado ganado) | Listo |
| Expedientes de extranjería | `service_cases` tabla + tipos preparados (NIE, arraigo, reagrupación, estudiante) | Listo |
| Captaciones / propiedades | `properties` tabla + lista por estado | Listo |
| Plantillas de mensajes/propuestas | Catálogo estático en `lib/demo/vertical-templates.ts` | Listo |
| Catálogo de automatizaciones | `AUTOMATION_TEMPLATES` (10 escenarios para n8n) | Catálogo listo, ejecución pendiente |
| Atención WhatsApp/Instagram | Inbox omnicanal (fases anteriores) | WhatsApp foundation listo, Instagram preparado, ambos pendientes de claves reales |
| Facturación, agenda, clientes | Módulos preexistentes (Billing, Calendar, Clients) | Sin cambios |
| Resúmenes / reportes | Asistente IA + dashboard | Sin cambios |

## 3. Qué se implementó esta fase

### Schema (Supabase)
Migración `vertical_pack_opportunities_cases_properties`, aplicada vía MCP.
Idempotente, no destructiva, sin cambios sobre datos existentes.

- `public.opportunities` — pipeline comercial multi-vertical.
- `public.service_cases` — expedientes/casos (extranjería, servicios).
- `public.properties` — captaciones inmobiliarias.

Cada tabla:
- RLS habilitada.
- Policy `*_workspace_access` para `authenticated` usando `user_has_workspace()`.
- Policy `service_role_full_access` con `qual=true` para writes server-side.
- GRANT SELECT/INSERT/UPDATE/DELETE a `authenticated` y `service_role`.
- Índices por `workspace_id + updated_at`, por `workspace_id + status/stage/vertical`
  y por `client_id` (parcial, WHERE NOT NULL).

### Catálogos estáticos
[src/lib/demo/vertical-templates.ts](../src/lib/demo/vertical-templates.ts):
- `VERTICALS` — descriptores con tono Tailwind, ejemplos, tagline.
- `REAL_ESTATE_PIPELINE`, `IMMIGRATION_PIPELINE`, `GENERAL_PIPELINE`.
- `CASE_TYPES` — 5 tipos con documentación recomendada y SLA.
- `MESSAGE_TEMPLATES` — 12 plantillas (WhatsApp, email) con variables `{{nombre}}`.
- `AUTOMATION_TEMPLATES` — 10 escenarios listos para conectar a n8n.

### Helpers
- [src/lib/vertical-queries.ts](../src/lib/vertical-queries.ts) — lecturas y
  creaciones workspace-scoped para las 3 tablas nuevas, vía el cliente
  Supabase del navegador.
- [src/lib/vertical-server.ts](../src/lib/vertical-server.ts) — espejo
  server-side que el agente y futuras API routes usan con el cliente SSR.
  Incluye además `updateServiceCaseStatusServer`, `updatePropertyStatusServer`
  y formatters reutilizables.

### NowLabs AI — tools verticales
[src/lib/agents/nowlabs-main-agent.ts](../src/lib/agents/nowlabs-main-agent.ts)
incorpora 9 tools nuevas para el Vertical Pack:

Lecturas (sin confirmación):
- `list_opportunities` — filtros `vertical`, `stage`, `limit`.
- `list_service_cases` — filtros `vertical`, `status`, `limit`.
- `list_properties` — filtros `status`, `city`, `limit`.

Escrituras (el agente confirma verbalmente en chat antes de disparar):
- `create_opportunity` (requiere `title`, `vertical`).
- `update_opportunity_stage` (requiere `opportunity_id`, `stage`).
- `create_service_case` (requiere `title`, `case_type`).
- `update_service_case_status` (requiere `case_id`, `status`).
- `create_property` (requiere `title`).
- `update_property_status` (requiere `property_id`, `status`).

Cada escritura confirmada deja un row en `activities` (best-effort) con
`type` = `opportunity_created` / `opportunity_stage_updated` /
`service_case_created` / `service_case_status_updated` / `property_created` /
`property_status_updated`, `metadata.source = 'nowlabs_agent'` y el
`workspace_id` y `client_id` resueltos.

Prompts soportados (ejemplos):
- "Crea un lead inmobiliario para Ana que quiere vender un piso en Málaga."
- "Crea una oportunidad para una asesoría que quiere automatizar WhatsApp."
- "Enséñame oportunidades abiertas." / "Qué oportunidades tengo frías esta semana."
- "Pasa la oportunidad de Ana a visita agendada."
- "Abre un expediente de extranjería para renovación de NIE."
- "Qué expedientes están pendientes de documentación."
- "Pasa este expediente a documentación pendiente."
- "Crea una propiedad en captación en Marbella."
- "Registra una propiedad para vender en Málaga por 320000."
- "Pasa esta propiedad a listed."

El agente NUNCA escribe sin confirmación verbal: describe la acción con los
datos extraídos y espera "sí" / "ok" / "créala" antes de llamar la tool.
Cuando el usuario da una orden inequívoca con todos los datos ("crea ya la
oportunidad de Ana, 250k, vertical inmobiliario") puede ejecutar sin doble
confirmación y reportar la creación en la respuesta.

### UI humana — Prompt B

La fase B (2026-05-18) convirtió el Vertical Pack en una superficie operable
sin chat. NowLabs AI y la UI escriben sobre las mismas tablas con activity
log paralelo; el `metadata.source` permite diferenciar
(`nowlabs_agent` vs `ui_manual`).

Componentes nuevos:

- [src/components/SideDrawer.tsx](../src/components/SideDrawer.tsx) —
  primitiva de drawer lateral reusable (escape, scroll-lock, overlay).
- [src/components/VerticalForms.tsx](../src/components/VerticalForms.tsx) —
  `NewOpportunityDrawer`, `NewServiceCaseDrawer`, `NewPropertyDrawer`.
  Cada uno usa los helpers de [vertical-queries.ts](../src/lib/vertical-queries.ts)
  con campos alineados a los args de las tools de NowLabs AI.
- [src/components/Client360Drawer.tsx](../src/components/Client360Drawer.tsx)
  — drawer agregador con oportunidades / expedientes / propiedades /
  conversaciones / facturas / próximas citas / actividad reciente del
  cliente, más sugerencia de "próxima acción".
- [src/components/VerticalPreferenceCard.tsx](../src/components/VerticalPreferenceCard.tsx)
  — selector de vertical del workspace. Tras Fase E persiste en
  `workspace_settings` con fallback `localStorage`. Badge honesto:
  "Guardado en workspace" / "Guardado localmente".
- [src/lib/workspace-settings.ts](../src/lib/workspace-settings.ts) —
  helpers `getWorkspaceSettings` / `upsertWorkspaceSettings` con caída
  silenciosa a local cuando Supabase no está disponible.
- [src/lib/workspace-templates.ts](../src/lib/workspace-templates.ts) +
  [src/components/WorkspaceTemplatesPanel.tsx](../src/components/WorkspaceTemplatesPanel.tsx)
  — plantillas editables por workspace (list/create/update/archive)
  conviviendo con el catálogo base `MESSAGE_TEMPLATES`.

Cambios en páginas:

- **/opportunities → "Operaciones"**: ruta sigue siendo `/opportunities`, label
  visual y sidebar cambian a "Operaciones". Subtabs Pipeline / Expedientes /
  Propiedades / Plantillas / Automatizaciones. Botones "Nueva oportunidad /
  expediente / propiedad" en el PageHeader. Inline `<select>` por fila para
  cambiar stage/status — usa `updateOpportunityStage`,
  `updateServiceCaseStatus`, `updatePropertyStatus` con actualización
  optimista y rollback en error.
- **/clients**: icono "Eye" por fila abre el Client 360 drawer. CTAs dentro
  del drawer abren los drawers de creación con cliente pre-cargado.
- **/inbox**: en el panel derecho de la conversación, botón "Crear
  oportunidad desde esta conversación" — abre el drawer con `client_id` /
  `client_name` / `source=channel` pre-rellenos.
- **/automations**: nueva sección "Automatizaciones verticales preparadas"
  arriba del aviso amarillo. Renderiza las 10 entradas de
  `AUTOMATION_TEMPLATES` con badge "Preparada" y botón disabled
  "Activar cuando n8n esté conectado".
- **/dashboard**: los 3 quick-link cards muestran contadores reales del
  workspace (oportunidades abiertas, calientes, valor pipeline; expedientes
  activos y con docs pendientes; propiedades en captación / publicadas).
- **/settings**: card "Vertical del workspace" con 5 opciones
  (General / Inmobiliaria / Extranjería / Servicios / Mixto). Persistencia
  real en `public.workspace_settings` con RLS workspace-scoped (Fase E);
  fallback `localStorage` honesto si la escritura cae. El badge indica el
  estado real: Cloud (workspace), HardDrive (local) o "Sin guardar".

### Fase C — edición avanzada y vinculación de cliente (2026-05-18)

Cierre del bloque pre-VPS: edición completa de las 3 entidades del Vertical
Pack y `client_id` real en el panel de Inbox.

- [src/components/ClientPicker.tsx](../src/components/ClientPicker.tsx) —
  selector de cliente debounced (ilike sobre `name`, `email`, `company`).
  Devuelve el `id` real, evitando matching frágil por nombre libre.
- [src/components/VerticalEditForms.tsx](../src/components/VerticalEditForms.tsx)
  — `EditOpportunityDrawer`, `EditServiceCaseDrawer`, `EditPropertyDrawer`.
  Patrón wrapper + inner-form con `key={entity.id}` y `useState(() => init)`
  para satisfacer `react-hooks/set-state-in-effect`. Reusan `SideDrawer` y
  `ClientPicker`; nunca hacen DELETE (las CTAs "Archivar" / "Cerrar
  expediente" / "Marcar perdida" sólo cambian `status` / `stage`).
- [src/lib/vertical-queries.ts](../src/lib/vertical-queries.ts) — añadidos
  `updateOpportunity`, `updateServiceCase`, `updateProperty` y `listClientsLite`.
  Cada update emite una `activities` row con
  `type` ∈ `{opportunity_updated, service_case_updated, property_updated}` y
  `metadata.source='ui_manual'`. Las escrituras del agente siguen marcando
  `metadata.source='nowlabs_agent'`.
- [src/app/(saas)/opportunities/page.tsx](../src/app/(saas)/opportunities/page.tsx)
  — click en título o icono ✎ de cualquier fila (Pipeline, Expedientes,
  Propiedades) abre el drawer de edición. `onUpdated` reemplaza la row en
  estado sin refetch completo.
- [src/app/(saas)/inbox/page.tsx](../src/app/(saas)/inbox/page.tsx) — el
  panel derecho ya no muestra `Vincular cliente →` deshabilitado: abre un
  `ClientPicker` inline. La selección hace PATCH a
  `/api/inbox/conversations/[id]` con `client_id`, que el endpoint valida
  como UUID y comprueba que pertenece al mismo workspace antes de aplicar.
  Hay también un "Quitar vínculo" para clientes mal vinculados.
- [src/app/api/inbox/conversations/[id]/route.ts](../src/app/api/inbox/conversations/[id]/route.ts)
  — PATCH ampliado para aceptar `client_id` (null o UUID). Devuelve también
  `client_name` para que el listado del Inbox se refresque limpio sin un
  GET extra.

### UI
- Nueva ruta `/opportunities`:
  - Tabs por vertical: Todos / Inmobiliaria / Extranjería / Servicios.
  - KPI strip (oportunidades · expedientes · propiedades).
  - Lista de pipeline agrupada por etapa.
  - Sección de expedientes con tipos preparados.
  - Sección de propiedades con empty state inteligente.
  - Catálogo de plantillas y catálogo de automatizaciones.
- Sidebar: entrada nueva **"Oportunidades"** entre Clientes y Automatizaciones.
- Dashboard: 3 quick-links a `/opportunities` (pipeline, expedientes, propiedades).

## 4. Qué quedó preparado pero no se ejecutó

- **Workflows reales en n8n**. Los 10 catálogos están listos como contrato y
  como tarjetas; visibles en `/operaciones` y `/automations`, sin ejecutarse.
- ~~**Editor de plantillas**~~ — Fase E: `public.workspace_templates`
  con RLS workspace-scoped y `WorkspaceTemplatesPanel` cubren CRUD
  (create / update / archive, sin DELETE). El catálogo base de
  `MESSAGE_TEMPLATES` sigue siendo la fuente de inspiración.
- ~~**Persistencia multi-dispositivo del vertical del workspace**~~ —
  Fase E: `public.workspace_settings` (RLS workspace-scoped, unique por
  workspace) sustituye al localStorage como fuente principal. El badge
  refleja qué camino tomó la última escritura.
- ~~**CRUD inline avanzado**~~ — Fase C: drawers de edición para
  oportunidades, expedientes y propiedades. Cliente vinculado vía
  `ClientPicker` (id real, no string libre).
- **Detalle "drilled" por entidad**: timeline + tareas + cliente vinculado
  desde dentro de la oportunidad/expediente/propiedad. Cliente 360 cubre el
  caso desde el otro lado.

## 5. Qué NO se hizo todavía

- ❌ Ningún workflow real en n8n.
- ❌ Ningún envío real por WhatsApp / Instagram.
- ❌ Ningún seed con datos del cliente firmado.
- ❌ Ningún cambio en Auth / Calendar / Google Sync / Billing.

## 6. Roadmap por fases

### Antes del VPS (lo que se puede cerrar en NowCRM solo)
1. ~~**Tools del agente NowLabs**~~ — Prompt A: `list_opportunities`,
   `list_service_cases`, `list_properties`, `create_opportunity`,
   `update_opportunity_stage`, `create_service_case`,
   `update_service_case_status`, `create_property`, `update_property_status`.
   Confirmación verbal en chat, activity log workspace-scoped, RLS al fondo.
2. ~~**CRUD inline desde UI**~~ — Prompt B: drawers de creación en
   `/operaciones`, inline status edit, Client 360 con CTAs de creación.
3. ~~**Cliente 360**~~ — Prompt B: drawer con oportunidades / expedientes /
   propiedades / conversaciones / facturas / próximas citas y CTAs de
   creación con cliente pre-cargado.
4. ~~**Dashboard accionable**~~ — Prompt B: 3 cards con counts y métricas
   reales del Vertical Pack.
5. ~~**Settings vertical**~~ — Prompt B: selector visual. Fase E:
   persistencia real en `workspace_settings` con fallback local.
6. ~~**Edición avanzada**~~ — Fase C: drawers para editar título, valor,
   probabilidad, fecha de cierre, notas y cliente vinculado de las 3 entidades.
7. ~~**Vincular cliente desde Inbox**~~ — Fase C: el panel derecho ya
   ofrece selector real de cliente; el PATCH valida UUID + ownership.
8. **Catálogo de automatizaciones** — pasar las 10 tarjetas estáticas a un
   selector real cuando exista n8n.
9. ~~**Persistencia multi-dispositivo del vertical**~~ — Fase E: tabla
   `workspace_settings` creada, RLS workspace-scoped, fallback local
   honesto si la escritura cae. El siguiente paso es leer `ai_tone` /
   `default_language` / `auto_reply_enabled` desde NowLabs AI v2.

### Tras tener VPS + n8n
1. Migrar workflows del n8n antiguo o crear los 10 del catálogo, uno a uno.
2. Activar `whatsapp_lead_inbound` → `create_opportunity` server-side desde
   `processInboundWhatsAppMessage`.
3. Recordatorio de cita / post-visita / lead frío 48h.
4. Resumen diario al operador.
5. Recordatorio de factura vencida.

### Tras tener Meta WhatsApp real
1. Primer mensaje real → debería crear oportunidad en estado "Nuevo lead".
2. Validar dedupe por `externalMessageId`.
3. Validar phone → client linking.
4. Activar auto-reply solo con validación manual previa.

### Tras tener Instagram real
1. Igual que WhatsApp pero con `instagram_messaging_api` como source.

## 7. Privacidad y multi-tenancy

- Todas las tablas tienen RLS por `workspace_id`.
- Las policies usan `user_has_workspace()` que valida que la sesión
  Supabase pertenece al workspace.
- No hay ningún `select('*')` cross-workspace.
- `service_role` solo se usa server-side (webhooks, helpers); nunca llega al
  cliente.
- Los catálogos no contienen datos personales — son ejemplos genéricos.

## 8. Riesgos restantes

- El agente confía en la confirmación verbal del usuario. Si alguien escribe
  una orden inequívoca ("crea ya la oportunidad de Ana, 250k") la ejecuta sin
  doble confirmación: ese es el diseño, pero hay que avisarlo en el onboarding
  del operador.
- El editor de plantillas es estático; el cliente no puede crear plantillas
  propias todavía.
- Los workflows de automatización están como contrato visual; no se disparan.
- La edición avanzada se hace desde drawers (Fase C). El borrado físico
  sigue reservado a Supabase Studio: las CTAs UI sólo cambian
  `status='archived'`, `stage='lost'` o `status='closed'`.
- Cualquier dato realmente sensible (NIE, pasaporte) debería gestionarse con
  más cuidado de privacidad antes de operar con clientes reales.
