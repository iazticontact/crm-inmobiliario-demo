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

- **Drawers de detalle por entidad** (oportunidad / expediente / propiedad).
  En `/opportunities` se muestran como lista; el modal/drawer con timeline,
  tareas y cliente vinculado queda para Prompt B.
- **Workflows reales en n8n**. Los 10 catálogos están listos como contrato y
  como tarjetas, sin ejecutarse.
- **Editor de plantillas**. Las plantillas son estáticas; se podrán mover a
  `proposal_templates` cuando se quiera personalización por workspace.
- **Vincular cliente desde una oportunidad sin client_id**. Está como CTA
  disabled.
- **Vista cliente 360**. Mostrar oportunidades / expedientes / propiedades de
  un cliente en su ficha — queda para Prompt B.

## 5. Qué NO se hizo todavía

- ❌ Ningún workflow real en n8n.
- ❌ Ningún envío real por WhatsApp / Instagram.
- ❌ Ningún seed con datos del cliente firmado.
- ❌ Ningún cambio en Auth / Calendar / Google Sync / Billing.

## 6. Roadmap por fases

### Antes del VPS (lo que se puede cerrar en NowCRM solo)
1. ~~**Tools del agente NowLabs**~~ — hecho: `list_opportunities`,
   `list_service_cases`, `list_properties`, `create_opportunity`,
   `update_opportunity_stage`, `create_service_case`,
   `update_service_case_status`, `create_property`, `update_property_status`.
   Confirmación verbal en chat, activity log workspace-scoped, RLS al fondo.
2. **Detalle por entidad** — drawer/modal con timeline + cliente + tareas para
   oportunidades, expedientes y propiedades.
3. **CRUD inline** desde `/opportunities` (crear/editar sin pasar por el chat).
4. **Cliente 360** — mostrar oportunidades / expedientes / propiedades en la
   ficha de cliente y permitir vincular desde ahí.
5. **Preferencia de vertical por workspace** — Settings → tabla
   `workspace_settings` o JSONB en `workspaces.metadata`.
6. **Dashboard accionable** — KPIs y CTAs sobre oportunidades calientes,
   expedientes vencidos y propiedades estancadas.
7. **Catálogo de automatizaciones** — pasar las 10 tarjetas estáticas a un
   selector real cuando exista n8n.

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
- No hay UI para editar / archivar una oportunidad ya creada — sólo cambiar
  etapa o estado. El borrado se reserva a Supabase Studio mientras tanto.
- Cualquier dato realmente sensible (NIE, pasaporte) debería gestionarse con
  más cuidado de privacidad antes de operar con clientes reales.
