# Fase 2E-2 RT1 — Informe de implementación (runtime read-only sobre Supabase)

**Fecha:** 2026-06-14 · **Estado:** ✅ implementado y validado (lint/tsc/build verdes).
Ancla: [PHASE_2E2_RT0_RUNTIME_AUDIT.md](PHASE_2E2_RT0_RUNTIME_AUDIT.md), [PHASE_2E2_RT1_CLIENTS_PROPERTIES_OPERATIONS_PLAN.md](PHASE_2E2_RT1_CLIENTS_PROPERTIES_OPERATIONS_PLAN.md).

## 1. Resumen ejecutivo
La app ya está conectada al Supabase nuevo (`ylhdbawrllqygfvllhdo`) para lectura de **dashboard, clientes, ficha de cliente, inmuebles y operaciones**. La capa de datos ya consultaba Supabase con las columnas correctas de 2E-2, así que RT1 consistió en: (1) confirmar el cambio de `.env.local` al proyecto nuevo, (2) verificar el cableado de cada módulo, y (3) **alinear el naming visible a "Operaciones" / "Pipeline comercial"**. La demo offline se conserva intacta. Cero cambios de schema, env en git, secretos o service_role en frontend.

## 2. Precheck env (seguro, sin imprimir valores)
- `.env.local` existe y **NO está trackeado** por git. ✓
- Variable `NEXT_PUBLIC_SUPABASE_URL` contiene el ref nuevo `ylhdbawrllqygfvllhdo` (detectado por conteo). ✓
- Ref legacy de CostaDelSol **NO presente** (conteo 0). ✓
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` presentes y no vacíos (solo nombres/longitud; **valores nunca impresos**). ✓

## 3. Verificación Supabase (read-only)
workspaces=1, auth.users=1, profiles=1, workspace_members=1, clients=8, properties=7, opportunities=7, service_cases=5, tasks=10, calendar_events=8, activities=14. RLS ON en las 7 tablas CRM. Owner = profile `client_admin` + member `owner` sobre `d0000000-…-0001`. 0 filas fuera del workspace demo.

## 4. Auditoría runtime (hallazgo)
**La capa de datos ya estaba cableada a Supabase** (client-side + anon key + RLS, sin service_role en frontend). Cada página ya hacía: si `localStorage['nowcrm-demo-mode']==='true'` → mock; si sesión real → helpers reales (`getClients`, `listProperties`, `listOpportunities`, `getWorkspaceFullOverview`, `getResolvedWorkspaceContext`). RT1 no necesitó re-cablear datos; el gap real era `.env.local` (ya corregido) + naming.

## 5. Archivos tocados (solo texto visible / naming)
| Archivo | Cambio |
|---|---|
| `src/app/(saas)/opportunities/page.tsx` | Subtab "Seguimiento"→**"Operaciones"**; KPI "Seguimientos"→"Operaciones"; SectionCard "Seguimiento comercial"→**"Pipeline comercial"**; badge/empty/count/`Nueva operación`; toast `Operación → stage`; tooltip "Editar operación" |
| `src/components/VerticalForms.tsx` | Drawer "Nueva operación" / botón "Crear operación" / toasts "Operación creada" |
| `src/components/VerticalEditForms.tsx` | Drawer "Editar operación" / toasts "Operación actualizada" |
| `src/app/(saas)/clients/[id]/page.tsx` | "Pipeline comercial" / "Operaciones vinculadas" / "Sin operaciones activas" |
| `src/app/(saas)/inbox/page.tsx` | Botón "Crear operación desde esta conversación" |

**No** se renombró la tabla `opportunities`, ni variables internas, ni rutas (`/opportunities`), ni tipos (`OpportunityRow`). **No** se tocaron `src/lib/agents/*`, `assistant-tools.ts`, ni la capa de datos.

## 6. Cambios por módulo
- **Dashboard:** sin cambios de código (ya cableado). Muestra KPIs reales (clientes/operaciones/eventos/cobros) en sesión real; mock en demo.
- **Clientes:** sin cambios de código (ya cableado). Lista `clients` reales (8); crear/editar/borrar con guard demo.
- **Ficha de cliente:** naming ("Operaciones vinculadas"); ya carga cliente real + propiedades/operaciones/actividad vinculadas.
- **Inmuebles (pestaña Propiedades en /opportunities):** sin cambios de código; lista `properties` reales (7).
- **Operaciones (pestaña pipeline):** naming a "Operaciones"/"Pipeline comercial"; agrupa `opportunities` (7) por `stage` con `REAL_ESTATE_PIPELINE` (etiquetas Nuevo lead…Cerrado perdido).

## 7. Demo offline preservada
El cortocircuito `localStorage['nowcrm-demo-mode']` sigue **antes** de cualquier query en todas las páginas (verificado en dashboard/clients/opportunities). En demo se sirven `mock-data.ts` / `demo/demo-real-estate.ts`. El botón "Ver demo inmobiliaria" y `demo-v1` (`ca04af9`) no se han tocado. Las escrituras en demo siguen mostrando "Modo demo (solo lectura)".

## 8. Workspace / RLS
Workspace resuelto de la sesión (`getResolvedWorkspaceContext` / `getWorkspaceContext` → `profiles.workspace_id`; el owner demo ya apunta al workspace demo). Todas las queries filtran `workspace_id` y la RLS de 2E-2 es la segunda barrera. Sin `service_role` en frontend.

## 9. Qué sigue mock/offline (fuera de RT1)
- Facturas (billing) → 2E-4. · Documentos/Storage → 2E-3. · Inbox conversations/messages → 2E-3.
- Mutations finas (create/update) ya existen para clientes/operaciones/propiedades con guard demo; RT4 las endurecerá.
- Catálogo de automations y textos del Asistente IA conservan "oportunidad" (LLM/operador, fuera de alcance).

## 10. Validaciones
- `npx tsc --noEmit` → **OK**
- `npm run lint -- --max-warnings=0` → **OK** (exit 0)
- `npm run build` → **OK** (todas las rutas compilan; Next 16.2.4)

## 11. Smoke tests (manuales — pendientes de ejecutar en navegador)
> No ejecutables aquí (requieren navegador + contraseña del owner, que no se maneja). Checklist:
1. `npm run dev` → login real con el owner demo.
2. Dashboard carga KPIs reales (8 clientes, etc.).
3. Clientes muestra **8**.
4. Inmuebles (pestaña Propiedades) muestra **7**.
5. Operaciones (pestaña) muestra **7** repartidas por etapa, título "Pipeline comercial".
6. Ficha de cliente abre sin error; "Operaciones vinculadas".
7. Sin errores RLS en consola; no aparece CostaDelSol/NowLabs.
8. Logout. Entrar "Ver demo inmobiliaria" → demo offline intacta (dashboard/clientes/operaciones).

## 12. Riesgos pendientes
- `.env.local` es responsabilidad manual (keys en Proton Pass; nunca en git). 
- Advisor Auth `auth_leaked_password_protection` (opcional, dashboard).
- Activity titles en `vertical-queries.ts`/`vertical-server.ts` aún dicen "Oportunidad creada/…": son capa de datos + espejo del agente; se alinearán cuando se toque esa capa (no en RT1).
- Smoke test de navegador pendiente de Oier.

## 13. Siguiente fase recomendada
**RT2** — ficha de cliente en profundidad + tasks + activities (lectura) — ver [PHASE_2E2_RT2_TASKS_ACTIVITIES_PLAN.md](PHASE_2E2_RT2_TASKS_ACTIVITIES_PLAN.md). Luego RT3 (calendar).
