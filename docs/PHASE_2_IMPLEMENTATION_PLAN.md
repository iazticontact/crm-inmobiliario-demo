# Fase 2E — Plan de implementación incremental

> Cómo construir el backend real **por cortes pequeños y seguros**, cada uno commiteable y reversible. Nada de «toda la Fase 2 de golpe».
> Anclado en [PHASE_2_CODE_SUPABASE_AUDIT.md](PHASE_2_CODE_SUPABASE_AUDIT.md), [PHASE_2_SCHEMA_DESIGN.md](PHASE_2_SCHEMA_DESIGN.md), [PHASE_2_STORAGE_PLAN.md](PHASE_2_STORAGE_PLAN.md), [PHASE_2_BILLING_DESIGN.md](PHASE_2_BILLING_DESIGN.md).
> **Aún no se ha ejecutado nada.** Este plan se ejecuta solo tras aprobar el diseño y crear el proyecto Supabase nuevo (ver §«Cortes de seguridad»).

---

## Reglas que aplican a TODAS las subfases

- **Demo offline intacta:** cada corte verifica que `DEMO_MODE_KEY` sigue cortocircuitando antes de Supabase. La ruta demo nunca debe romperse.
- **RLS desde el primer corte:** ninguna tabla de negocio entra sin su policy de aislamiento por `workspace_id`.
- **Migraciones versionadas** en `supabase/migrations/` (orden por timestamp). Seeds **separados** del schema.
- **service_role solo backend.** Nunca en el cliente ni en variables `NEXT_PUBLIC_`.
- **Validación si toca runtime:** `npm run lint` + `npx tsc --noEmit` + `npm run build` antes de cada commit que modifique `src/`.
- **Commits pequeños por corte.** Un corte = un commit (o pocos). Nada de un commit gigante.
- **No tocar contratos internos protegidos** (`NOWCRM_*`, `NOWLABS_*`, `x-nowcrm-*`, `runNowLabsAgent`, `nowlabs_admin`).
- **No datos reales de clientes** en seeds ni pruebas. Solo el seed demo coherente con `demo-v1`.
- **Rollback definido** en cada corte (cómo deshacer si algo sale mal).

---

## Cortes de seguridad (antes de empezar a ejecutar)

1. **Diseño aprobado** por Oier (estos 5 docs de Fase 2).
2. **Proyecto Supabase NUEVO** creado y confirmado vacío (ver [Fase 2F](#fase-2f) / abajo). No reutilizar el viejo.
3. **`.env.local` nuevo** desde `.env.example` con las keys nuevas (anon en `NEXT_PUBLIC_*`, service_role solo server). Secrets en vault, nunca en chat/repo.
4. Solo entonces empieza **2E-1**.

---

## 2E-1 · Core multi-tenant
**Objetivo:** cimientos. `workspaces`, `profiles`, `workspace_members`, RLS básica, helper de aislamiento, seed del workspace demo.

- **Migraciones:** extensiones (`pgcrypto`); `workspaces`; `profiles` (FK a `auth.users`); `workspace_members`; función `current_workspace_ids()`; trigger `set_updated_at()`; RLS + policies de estas 3 tablas.
- **Seed:** workspace «Demo Inmobiliaria» + 1 usuario admin demo (en proyecto de staging, no en prod de cliente).
- **Archivos probables:** `supabase/migrations/0001_core.sql`, `supabase/seed/00_demo_workspace.sql`. (Runtime: ninguno todavía.)
- **Validación:** crear usuario de prueba, confirmar que `getResolvedWorkspaceContext` resolvería su workspace; probar que un usuario sin profile no ve datos.
- **Manual tests:** registrar usuario → login → `profiles` se resuelve; RLS: usuario A no ve workspace B.
- **Commit:** `feat(db): core multi-tenant schema (workspaces, profiles, members) + RLS`.
- **Rollback:** `drop` de las 3 tablas + función (proyecto nuevo, sin datos reales → seguro).

## 2E-2 · CRM tables
**Objetivo:** `clients`, `properties`, `opportunities`, `service_cases`, `tasks`, `activities` + RLS + seed inmobiliario.

- **Migraciones:** las 6 tablas con columnas de [2B], FKs, índices, soft delete donde aplica, triggers `updated_at`, RLS por `workspace_id`. Opcional `opportunity_stage_history`.
- **Seed:** clientes/propiedades/oportunidades/expedientes/tareas/actividades coherentes con `demo-real-estate.ts` (fechas relativas).
- **Archivos probables:** `0002_crm.sql`, `seed/10_crm_demo.sql`.
- **Validación:** queries de `vertical-queries.ts` devuelven filas reales para el workspace demo.
- **Manual tests:** crear/editar cliente real persiste; cambiar etapa de oportunidad persiste; RLS aislada.
- **Commit:** `feat(db): CRM tables (clients, properties, opportunities, cases, tasks, activities) + RLS`.
- **Rollback:** `drop` de las tablas del corte.

## 2E-3 · Calendar / conversations / messages
**Objetivo:** `calendar_events`, `conversations`, `messages` + RLS + seed.

- **Migraciones:** las 3 tablas; `messages` con **`body`/`is_ai`** (respetar nombres del código); unicidad `google_event_id`; índices; RLS.
- **Seed:** eventos de la semana, conversaciones/mensajes de ejemplo.
- **Archivos probables:** `0003_calendar_comms.sql`, `seed/20_calendar_comms_demo.sql`.
- **Validación:** calendario carga eventos reales; inbox/assistant leen conversaciones.
- **Manual tests:** crear/editar/borrar evento persiste; RLS aislada.
- **Commit:** `feat(db): calendar, conversations, messages + RLS`.
- **Rollback:** `drop` de las 3 tablas.

## 2E-4 · Documents + Storage
**Objetivo:** buckets + tabla `documents` + signed URLs + guards de subida.

- **Storage:** crear buckets `client-files`, `facturas-pdf`, `informes-pdf` (nombres exactos del código), `property-media`, `branding`. Policies por `workspace_id` (primer segmento del path).
- **Migraciones:** tabla `documents` (+ `property_media` si entra), RLS.
- **Archivos probables:** `0004_documents.sql`, policies de storage.
- **Validación:** subir documento en ficha cliente persiste y se descarga con signed URL; borrado atómico.
- **Manual tests (crítico):** usuario del workspace A **no** puede leer/borrar objeto del workspace B.
- **Commit:** `feat(db): documents table + storage buckets and policies`.
- **Rollback:** `drop` tabla + vaciar/borrar buckets (proyecto nuevo).

## 2E-5 · Billing core
**Objetivo:** facturación real persistente.

- **Migraciones:** `invoices` (ampliada), `invoice_items`, `invoice_sequences`, `billing_settings` + RLS. Lógica de numeración atómica (función o transacción backend).
- **Storage:** PDFs a `facturas-pdf` + registro en `documents`.
- **Archivos probables:** `0005_billing.sql`; runtime: ruta/UI de facturación (si se conecta aquí).
- **Validación:** crear factura → numeración correlativa → PDF guardado → descarga; marcar pagada.
- **Manual tests:** numeración sin duplicados (crear 2 facturas seguidas); totales recalculados en servidor; RLS aislada.
- **Commit:** `feat(db): billing core (invoices, items, sequences, settings)`.
- **Rollback:** `drop` de las tablas del corte.

## 2E-6 · Conectar frontend a Supabase real
**Objetivo:** que las páginas dejen de usar mock (en modo real) y usen datos reales — **sin romper la demo**.

- **Runtime:** revisar dashboard, clients, client detail, opportunities, calendar, documents, billing para que en modo real lean Supabase (ya lo hacen vía `supabase-queries`/`vertical-queries`; aquí se valida con datos reales). La rama `DEMO_MODE_KEY` se mantiene intacta.
- **Archivos probables:** páginas en `src/app/(saas)/*`, `src/lib/*-queries.ts` (ajustes menores si el schema difiere).
- **Validación:** `lint` + `tsc` + `build`. Con usuario real: cada módulo carga datos reales; con `DEMO_MODE_KEY`: sigue offline.
- **Manual tests:** recorrer la checklist de [DEMO_V1_SALES_GUIDE] en **modo real** (datos persistentes) y en **demo** (efímero).
- **Commit(s):** `feat(app): wire <módulo> to real Supabase` (uno por módulo si conviene).
- **Rollback:** revertir el commit del módulo (la demo sigue funcionando porque su rama no cambia).

## 2E-7 · Assistant: read tools reales
**Objetivo:** el asistente lee datos reales del workspace (solo lectura), sin hardcodear workspace.

- **Runtime:** `assistant-tools.ts`, `agent-tool-readers.ts`, `api/assistant/v2` — validar que filtran por `workspace_id` de la sesión. Configurar `OPENAI_API_KEY` (server).
- **Validación:** `lint`/`tsc`/`build`. El asistente responde con datos reales del workspace; en demo, respuestas de muestra.
- **Manual tests:** preguntas de lectura («¿qué visitas tengo esta semana?») devuelven datos reales del workspace; RLS aislada.
- **Commit:** `feat(assistant): real read-only tools scoped by workspace`.
- **Rollback:** revertir; el asistente vuelve a muestra.

## 2E-8 · Prepared actions
**Objetivo:** la IA prepara acciones que el humano confirma; el backend ejecuta validando.

- **Migraciones:** `prepared_actions` + RLS.
- **Runtime:** flujo `prepare → confirm → execute` en `api/assistant/confirm` para `create_task`, `create_event`, `create_invoice` (draft), `update_opportunity`. **Siempre confirmación**; validación rol/workspace server-side; log en `agent_action_logs`.
- **Validación:** `lint`/`tsc`/`build`. Una acción preparada no escribe nada hasta confirmar.
- **Manual tests:** preparar cita/tarea/factura → confirmar → se crea; cancelar → no se crea; RLS aislada.
- **Commit:** `feat(assistant): prepared actions with human confirmation`.
- **Rollback:** revertir runtime + `drop prepared_actions`.

## 2E-9 · Integraciones
**Objetivo:** n8n, Google Calendar, Meta WhatsApp, email — cada una su mini-corte, ninguna bloquea el CRM.

- **Migraciones/Storage:** `automation_workflows`, `google_calendar_connections`, `whatsapp_connections`, `integration_settings` + RLS; tokens solo backend.
- **Runtime:** rutas `api/integrations/*` ya existen; validar contra schema nuevo. Configurar secrets por integración (server, vault).
- **Validación:** cada integración degrada con elegancia si no está configurada.
- **Manual tests:** Google Calendar sincroniza; WhatsApp inbound entra (tras aprobación Meta); n8n dispara.
- **Commit(s):** `feat(integrations): <google|whatsapp|n8n|email>`.
- **Rollback:** desactivar la integración (flag) + revertir su corte; el CRM sigue.

---

## Orden recomendado y dependencias

```
2E-1 core  →  2E-2 CRM  →  2E-3 calendar/comms  →  2E-4 documents/storage
                                                  →  2E-5 billing
2E-6 wire frontend (tras 2E-1..2E-5)
2E-7 assistant read  →  2E-8 prepared actions
2E-9 integraciones (en paralelo, según alcance/cliente)
```

**Mínimo vendible-real (MVP persistente):** 2E-1 → 2E-6 (CRM + calendar + documents + billing conectados). El asistente real (2E-7/8) e integraciones (2E-9) llegan después o según el pack del cliente.

---

## Fase 2F — Estado de Supabase MCP (diagnóstico)

Ver el bloque de diagnóstico en la entrega de esta fase. Resumen de la regla:
- Si Supabase MCP está conectado: **solo diagnóstico** (listar proyectos, confirmar cuál es el NUEVO). **No** ejecutar SQL, **no** crear tablas, **no** tocar policies/datos.
- Si no está conectado: lo que hará falta para arrancar (sin pegar claves en el chat): **project ref** del proyecto nuevo, confirmación de que es **nuevo y vacío** (no el Supabase antiguo), y autorización explícita para ejecutar SQL en el siguiente paso.

---

## Checklist de «listo para ejecutar Fase 2 real»

- [ ] Diseño (2A–2E) revisado y aprobado por Oier.
- [ ] Respuestas a las preguntas críticas (módulos prioritarios, multiempresa, roles, facturación visible, IA por voz v1/v1.5, seed).
- [ ] Proyecto Supabase **nuevo** creado y confirmado vacío.
- [ ] `.env.local` nuevo con keys nuevas (service_role solo server, secrets en vault).
- [ ] Rama de trabajo creada (no `main` directo para los cortes grandes).
- [ ] Demo offline verificada antes de empezar (punto de retorno: tag `demo-v1`).
