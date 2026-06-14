# Fase 2E-2 — Plan de integración runtime (de demo offline a Supabase real)

**Fecha:** 2026-06-14
**Estado:** plan. **NO se toca `src/*` en 2E-2 PREP.** Esto guía las fases de integración posteriores (2E-2 RT y siguientes).

Anclado en [PHASE_2_CODE_SUPABASE_AUDIT.md](PHASE_2_CODE_SUPABASE_AUDIT.md), [PHASE_2E2_SCHEMA_REVIEW.md](PHASE_2E2_SCHEMA_REVIEW.md), [PHASE_2_IMPLEMENTATION_PLAN.md](PHASE_2_IMPLEMENTATION_PLAN.md).

## 0. Principio rector
El esquema CRM ya existe en Supabase tras 2E-2 APPLY. La integración runtime consiste en hacer que cada módulo **lea/escriba Supabase real cuando hay sesión**, y **siga sirviendo mock offline cuando `isDemo`**. No se reescribe la UI; se cambia la **capa de datos**.

## 1. Cómo funciona hoy el gating (no romper)
- `src/lib/current-user.ts` decide `isDemo`: sin sesión Supabase o con `DEMO_MODE_KEY` → modo demo.
- Las páginas (`dashboard`, `clients`, `calendar`, …) cortocircuitan a `mock-data.ts` cuando `isDemo`, **antes** de tocar Supabase. Los helpers de Supabase degradan a `null`/`[]` si no está configurado.
- El workspace **se deriva de la sesión** (`getResolvedWorkspaceContext` en `supabase-queries.ts`, hoy vía `profiles.workspace_id`).
- **Regla de oro:** este cortocircuito demo debe permanecer **antes** de cualquier query real. `demo-v1` (tag `ca04af9`) no debe cambiar de comportamiento.

## 2. Orden recomendado de integración (server-first, módulo a módulo)
1. **Clients** — la base; casi todo enlaza a `client_id`. Validar listado, ficha, crear/editar.
2. **Properties** — inmuebles; pestaña de propiedades y relación con oportunidades.
3. **Opportunities** — pipeline; usar `property_id` real (en vez de `metadata.property_id`). **Naming (2E-2N):** tabla `opportunities` sin cambios; en esta fase RT, unificar la UI a **"Operaciones" / "Pipeline comercial"** (nav hoy "Gestión", sección "Seguimiento comercial") y sustituir los literales residuales "oportunidad" (drawers, toasts, ficha cliente, inbox, contador de columna, títulos de actividad). Ver sección Naming en [PHASE_2E2_SCHEMA_REVIEW.md](PHASE_2E2_SCHEMA_REVIEW.md).
4. **Tasks / Calendar** — operativa y agenda (el sync Google ya tiene columnas; conectar OAuth aparte).
5. **Activities** — timeline; `logActivity` best-effort en cada escritura de negocio.
6. **Documents / Billing / Inbox** — requieren 2E-3 (Storage + comms) y 2E-4 (facturación).
7. **Assistant tools** — `agent-tool-readers`/`assistant-tools` leyendo datos reales y `prepared_actions` (fase IA).

Criterio de corte por módulo: leer real → escribir real (con guard demo) → quitar dependencia mock → QA.

## 3. Resolver de workspace (cambio clave de 2E-1 → multi-tenant)
- Hoy: `profiles.workspace_id` (1:1).
- Objetivo: `getResolvedWorkspaceContext` debe resolver el workspace vía `workspace_members` (N:N) — el usuario puede tener varios; elegir el activo (o el único). El owner demo ya está en `workspace_members` (`owner`).
- Hacerlo **sin romper el frontend**: mantener la firma del contexto; cambiar solo la fuente. Documentar el corte (ya señalado en el diseño 2B).

## 4. Capa de datos a tocar (después, no ahora)
- `src/lib/supabase-queries.ts` — lecturas/escrituras genéricas + `getResolvedWorkspaceContext`.
- `src/lib/vertical-queries.ts` — queries de opportunities/properties/service_cases + `logActivity`.
- Páginas en `src/app/(saas)/*` (clients, opportunities, calendar, dashboard) — ya tienen el patrón demo/real; cambiar la rama real.
- Rutas API en `src/app/api/*` (clients/documents, reports, agent/tool, integrations) — derivan workspace de sesión; respetar.
- Tipos en `src/lib/types.ts` — mapear columnas snake_case ↔ camelCase (p.ej. `lead_score`↔`leadScore`); derivar `avatar` (iniciales) y `lastInteraction` (de `activities`).

> **Nota 2E-2R (integridad de asignación):** el selector de `assigned_to` (tareas/expedientes/oportunidades/clientes) debe ofrecer **solo miembros del workspace** (de `workspace_members`/`profiles`). La BD lo refuerza con el trigger `enforce_member_refs`: asignar a un `user_id` que no sea miembro falla con `check_violation`. `created_by` debe rellenarse con el `auth.uid()` de la sesión (no validado en BD, pero es lo correcto).

## 5. Qué NO tocar todavía
- `src/lib/agents/nowlabs-main-agent.ts` y el contrato `runNowLabsAgent` / `NOWCRM_*` / `x-nowcrm-*` (protegidos).
- Tokens de integraciones (WhatsApp/Google): siguen en backend/service_role; no exponer vía anon.
- La ruta/flag demo (`DEMO_MODE_KEY`) y `mock-data.ts`: se mantienen como fallback offline.
- Billing/Storage/Inbox runtime hasta tener 2E-3/2E-4 aplicadas.
- `.env.local`, `.mcp.json`, n8n.

## 6. Estrategia de fallback demo/offline vs sesión real
- `isDemo === true` → mock offline (sin Supabase). Sin cambios.
- Sesión real → queries Supabase con RLS; el `workspace_id` viene del contexto resuelto.
- Guards de escritura en demo (toast "Modo demo", cambios optimistas locales) se conservan: en sesión real, ejecutan la mutación; en demo, no tocan Supabase.
- Helpers que degradan a `[]`/`null` si Supabase no está configurado → la app nunca crashea por falta de backend.

## 7. Cómo NO romper `demo-v1`
- No modificar el comportamiento de la ruta demo ni de `mock-data.ts`.
- Mantener el cortocircuito `isDemo` antes de cualquier query.
- QA por módulo en dos modos: (a) demo offline (debe verse idéntico a `demo-v1`), (b) sesión real (datos del workspace demo Supabase, ya seedeado).
- El tag `demo-v1` (`ca04af9`) permanece intacto como referencia/rollback.

## 8. Checklist de "listo para integrar un módulo"
- [ ] 2E-2 APPLY hecho (tablas + seed presentes).
- [ ] Resolver de workspace migrado a `workspace_members` (o confirmado 1:1 suficiente).
- [ ] Mapeo de columnas snake_case↔camelCase del módulo.
- [ ] Rama real implementada detrás del guard `isDemo`.
- [ ] RLS verificada (un usuario solo ve su workspace).
- [ ] QA demo offline sin regresiones vs `demo-v1`.

## 9. Fases siguientes (dependencias)
- **2E-3:** Storage (buckets + policies) + `documents` + `conversations`/`messages` (inbox).
- **2E-4:** facturación (`invoices`, `invoice_items`, `invoice_sequences`, `billing_settings`) + numeración atómica + PDF.
- **2E-5+:** IA real (`prepared_actions`, `agent_action_logs`), integraciones (tokens), automatización.
