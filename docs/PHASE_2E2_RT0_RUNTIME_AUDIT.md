# Fase 2E-2 RT0 — Auditoría runtime para integración Supabase real

**Fecha:** 2026-06-14 · **Estado:** auditoría. **No se editó `src/*`.**
Ancla: [PHASE_2_CODE_SUPABASE_AUDIT.md](PHASE_2_CODE_SUPABASE_AUDIT.md), [PHASE_2E2_REMOTE_APPLY_REPORT.md](PHASE_2E2_REMOTE_APPLY_REPORT.md).

## 0. Hallazgo principal
La capa de datos **ya está construida para Supabase y apunta a las tablas/columnas correctas** de 2E-2. La "integración" NO es reescribir queries, sino:
1. Apuntar `.env.local` al proyecto nuevo (`ylhdbawrllqygfvllhdo`) — **manual, en RT1, no ahora**.
2. Iniciar sesión con el owner demo (su `profiles.workspace_id` ya apunta al workspace demo seedeado).
3. Verificar que cada módulo renderiza datos reales y que la demo offline sigue intacta.

Riesgo técnico bajo: el código ya usa cliente Supabase con RLS, mapea snake_case→camelCase, deriva `avatar`/`lastInteraction`, y tiene fallback ante columnas faltantes (`removeMissingSchemaColumn`).

## 1. Estado actual
- **Demo offline:** intacta. `useCurrentUser()` ([current-user.ts](../src/lib/current-user.ts)) cortocircuita a `demoUser` si `localStorage['nowcrm-demo-mode']==='true'` o (sin sesión) si `featureFlags.demoData`. Las páginas sin fallback Supabase usan `mock-data.ts` / `demo/demo-real-estate.ts`.
- **Supabase ya poblado:** workspace demo con 8/7/7/5/10/8/14 filas.
- **Acceso a datos:** **client-side** vía `getSupabaseBrowserClient()` (anon/publishable key + sesión en cookies) con RLS. `proxy.ts` refresca sesión server-side. **No hay `service_role` en el browser.**
- **Resolver de workspace:** `getResolvedWorkspaceContext()` ([supabase-queries.ts](../src/lib/supabase-queries.ts)) → `profiles.workspace_id` (modelo 1:1). El owner demo ya tiene `workspace_id = d0000000-…-0001`.

## 2. Problema `.env.local` (NO tocar en esta fase)
- Hoy `.env.local` (y `.env.local.backup_antiguo`) apuntan a un proyecto **legacy** (`ktsgfukjgldeylfzrayr`, costadelsol).
- Por tanto, en "modo real" la app conectaría al legacy, no a `ylhdbawrllqygfvllhdo`.
- **En RT1, manualmente** (Oier), habrá que poner: `NEXT_PUBLIC_SUPABASE_URL=https://ylhdbawrllqygfvllhdo.supabase.co` y la **publishable/anon key** del proyecto nuevo. **Nunca** escribir keys en docs ni en git. El `service_role` solo en variables server (`SUPABASE_SERVICE_ROLE_KEY`), nunca `NEXT_PUBLIC_*`.

## 3. Auditoría por módulo
> mock = `mock-data.ts`/`demo-real-estate.ts` offline · SB = ya consulta Supabase vía helpers · tabla real = la de 2E-2.

| Módulo / archivo | Datos hoy | Fuente | Tabla real | Columnas/joins clave | Riesgo demo | Orden |
|---|---|---|---|---|---|---|
| Dashboard `app/(saas)/dashboard` | KPIs + timeline | mock si `isDemo`; SB si sesión (`getWorkspaceFullOverview`) | clients, invoices, calendar_events, activities, tasks, opportunities | counts + `created_at`/`start_at`/`status` | Medio (mantener gating isDemo) | RT1/RT2 |
| Clients `app/(saas)/clients` | lista | mock / `getClients` | clients | `CLIENT_COLUMNS` | Bajo | **RT1** |
| Client detail `app/(saas)/clients/[id]` | ficha 360 | mock / `getClientDetail` + `getClientVerticalSummary` | clients + opportunities + service_cases + properties + activities (+ invoices/docs futuras) | `client_id` joins | Medio | RT2 |
| Operaciones `app/(saas)/opportunities` | pipeline + props + expedientes | SB `listOpportunities`/`listProperties`/`listServiceCases` (mock offline `demo-real-estate`) | opportunities, properties, service_cases | `stage`/`pipeline`, `workspace_id` | Medio | **RT1** |
| Calendar `app/(saas)/calendar` | agenda | mock / `getCalendarEvents` | calendar_events | `start_at`/`end_at`/`status` | Medio (sync Google aparte) | RT3 |
| Tasks (dashboard/ficha) | tareas | SB `listTasks`/`getPendingTasks` | tasks | `status`/`due_date` | Bajo | RT2 |
| Activities (timeline) | log | SB `getActivities` | activities | `(workspace_id, created_at desc)` | Bajo | RT2 |
| Assistant `app/(saas)/assistant` | tools CRM | SB readers/tools (`agent-tool-readers`, `assistant-tools`) | todas | lecturas + `prepared_actions` (futuro) | Alto (contrato agente) | RT5 |
| Settings `app/(saas)/settings` | integraciones | SB integrations/connections | integrations, *_connections | tokens solo backend | Alto (secretos) | RT6+ |
| Inbox `app/(saas)/inbox` | conversaciones | SB conversations/messages | conversations, messages | `body`/`is_ai` | Alto | RT8 (2E-3) |
| Billing `app/(saas)/billing` | facturas | mock / `getInvoices` | invoices (no en 2E-2) | — | Alto | RT7 (2E-4) |
| API `app/api/*` | server ops | SSR/service_role | varias | derivan workspace de sesión | Alto | por módulo |

**Tablas de 2E-2 que el runtime ya sabe consultar:** clients, properties, opportunities, service_cases, tasks, calendar_events, activities. **Diferidas (no en 2E-2):** invoices (2E-4), documents/Storage (2E-3), conversations/messages (2E-3).

## 4. Arquitectura runtime recomendada
- **Workspace-scoped siempre:** toda query filtra `workspace_id` resuelto de la sesión; RLS como segunda barrera. Nunca aceptar `workspace_id` del body.
- **Client-first con RLS (estado actual) → opcional server-first por módulo:** el patrón actual (browser client + RLS) es seguro y suficiente para lecturas. Donde se necesite privilegio (invitar usuarios, borrar Storage, leer tokens) seguir usando `service_role` **solo en rutas API server** (`supabase-admin.ts`), nunca en el browser.
- **Nunca exponer secretos:** `service_role` jamás en `NEXT_PUBLIC_*` ni en el cliente; tokens de integración solo backend.
- **Usuario actual:** vía Supabase (`auth.getUser()` validado server-side en `proxy.ts`; browser para UI).
- **Resolver workspace:** hoy `profiles.workspace_id` (1:1). Evolución opcional a `workspace_members` (N:N) sin romper la firma de `getResolvedWorkspaceContext` (cambiar solo la fuente). Para el demo (1 workspace) el modelo actual basta.

## 5. Estrategia demo/offline vs real (no romper demo-v1)
- `localStorage['nowcrm-demo-mode']==='true'` → **demo offline** (mock), antes de tocar Supabase. **Inalterable.**
- Sesión Supabase real → datos reales del workspace resuelto.
- Sin sesión y `featureFlags.demoData` on → `demoUser` (placeholder demo). En clones reales (`demoData` off) → `null` y AuthGate redirige a login.
- Regla de oro: el cortocircuito `isDemo` va **antes** de cualquier query. `demo-v1` (`ca04af9`) no cambia de comportamiento.

## 6. Orden RT recomendado
- **RT1:** clients + properties + opportunities (Operaciones) **read-only** + `.env.local` al proyecto nuevo.
- **RT2:** client detail (ficha 360) + activities + tasks.
- **RT3:** calendar_events (lecturas; sync Google se conecta aparte).
- **RT4:** mutations controladas (create/update con guard demo).
- **RT5:** assistant tools sobre Supabase real (+ `prepared_actions`).
- **RT6:** documents/Storage (requiere 2E-3).
- **RT7:** billing/invoices (requiere 2E-4).
- **RT8:** inbox/conversations/messages (requiere 2E-3).

## 7. Riesgos
- `.env.local` legacy (bloquea datos reales hasta actualizar; manual).
- Tipos TS: mapear snake_case↔camelCase (ya cubierto en mappers; revisar `opportunities` UI = "Operaciones").
- RLS y workspace: validar que el owner resuelve su workspace y ve solo lo suyo.
- Selected workspace: con N:N futuro, elegir workspace activo.
- Roles: probar owner vs comercial vs solo_lectura (RLS distinta).
- Preservar demo offline en cada módulo migrado.

## 8. Criterios de éxito RT1
- Con `.env.local` → nuevo Supabase y login del owner: dashboard, clientes (8), inmuebles (7) y Operaciones (7) cargan datos **reales**.
- Demo offline (`nowcrm-demo-mode`) sigue idéntica a `demo-v1`.
- `npm run lint -- --max-warnings=0`, `npx tsc --noEmit`, `npm run build` en verde.
- Un usuario solo ve su workspace (RLS).
