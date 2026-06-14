# Fase 2E-2 RT1 — Plan de integración runtime: Clients + Properties + Operaciones (read-only)

**Fecha:** 2026-06-14 · **Estado:** plan (NO implementar aún).
Ancla: [PHASE_2E2_RT0_RUNTIME_AUDIT.md](PHASE_2E2_RT0_RUNTIME_AUDIT.md).

## 1. Objetivo RT1
Conectar **clientes, inmuebles y operaciones (opportunities)** a Supabase real en **modo read-only primero**, con un login real del owner del workspace demo, **sin romper la demo offline** ni `demo-v1`. La capa de datos ya existe; RT1 es sobre todo **configuración + verificación + ajustes mínimos**.

## 2. Archivos que probablemente haya que tocar
- `.env.local` (**manual, fuera de git, sin pegar keys en docs**): `NEXT_PUBLIC_SUPABASE_URL` + publishable/anon key del proyecto nuevo `ylhdbawrllqygfvllhdo`.
- `src/app/(saas)/clients/page.tsx` — confirmar rama real (`getClients`) y gating `isDemo`.
- `src/app/(saas)/opportunities/page.tsx` — ya usa `listOpportunities/listProperties/listServiceCases`; revisar fallback offline y etiquetas "Operaciones".
- `src/app/(saas)/dashboard/page.tsx` — KPIs básicos desde `getWorkspaceFullOverview` cuando hay sesión.
- (Opcional) `src/lib/supabase-queries.ts` / `src/lib/vertical-queries.ts` — solo si falta una query/orden; **no reescribir**.
- (Opcional) `src/lib/types.ts` — si hace falta un tipo `Property`/`Opportunity` UI explícito.

## 3. Archivos que NO hay que tocar
`.env.local.backup_antiguo`, `.mcp.json`, `src/lib/agents/*` (contrato `runNowLabsAgent`/`NOWCRM_*`), `src/lib/supabase-admin.ts` (service_role), `mock-data.ts`/`demo/*` (fallback offline), migraciones aplicadas, n8n, Storage, Auth.

## 4. Helpers recomendados (si aportan; reutilizar antes de crear)
- **Reutilizar** lo existente: `getClients`, `getClientDetail`, `listProperties`, `listOpportunities`, `getResolvedWorkspaceContext`, `mapSupabaseClient`. Ya cubren RT1.
- Solo si hace falta: un `mapPropertyRowToUI` / `mapOpportunityRowToUI` para presentación (labels "Operaciones", stage→etiqueta vía `REAL_ESTATE_PIPELINE`).
- No introducir `service_role` en el cliente.

## 5. Queries necesarias (ya existen)
- Clientes: `getClients(workspaceId)` → `clients` (`CLIENT_COLUMNS`).
- Detalle cliente: `getClientDetail` + `getClientVerticalSummary` (RT2).
- Inmuebles: `listProperties(workspaceId)` → `properties`.
- Operaciones: `listOpportunities(workspaceId)` → `opportunities` (agrupar por `stage` con `REAL_ESTATE_PIPELINE`).
- Dashboard KPIs: `getWorkspaceFullOverview(workspaceId)`.

## 6. Mapping DB → UI
- **clients:** `lead_score`→`leadScore`; `avatar` derivado (iniciales); `lastInteraction` derivado (de `updated_at`/activities). Estados `active|lead|inactive|churned`.
- **properties:** `property_type`/`operation_type`/`status` texto; `metadata {rooms,baths,m2}` o columnas `bedrooms/bathrooms/area_m2`; precio `numeric`→formato EUR.
- **opportunities → "Operaciones":** `stage`→etiqueta visible (Nuevo lead/Contactado/Cualificado/Visita agendada/Oferta/Negociación/Cerrado ganado/Cerrado perdido); `value`/`probability`/`expected_close_date`. **UI: "Operaciones" / "Pipeline comercial"**, no "Oportunidades".

## 7. Fallback demo (preservar)
- Mantener el check `localStorage['nowcrm-demo-mode']` y `useCurrentUser().isDemo` **antes** de cualquier query real.
- En demo: seguir sirviendo `mock-data.ts` / `demo-real-estate.ts`.
- No cambiar el comportamiento de `demo-v1`. Probar ambos modos en cada página migrada.

## 8. Tests manuales
1. `.env.local` → nuevo Supabase; `npm run dev`.
2. Login real con el owner demo (email del bootstrap; contraseña en Proton Pass).
3. Dashboard: KPIs reales (8 clientes, etc.).
4. Clientes: carga **8**.
5. Inmuebles: carga **7**.
6. Operaciones: carga **7** repartidas por etapa.
7. Logout → vuelve a login (clones reales) o demo (si `demoData`).
8. Activar `localStorage nowcrm-demo-mode=true` → demo offline intacta.
9. (RLS) Confirmar que no aparecen datos de otro workspace.

## 9. Validaciones (si se tocó `src/*`)
- `npm run lint -- --max-warnings=0`
- `npx tsc --noEmit`
- `npm run build`
(Si solo se tocó `.env.local`, basta `npm run dev` + pruebas manuales.)

## 10. Criterios de bloqueo
- `.env.local` sigue apuntando a legacy → datos reales no cargan → BLOQUEAR hasta corregir.
- El login del owner no resuelve workspace (`profiles.workspace_id` nulo) → revisar bootstrap 2E-1U.
- Cualquier fuga cross-workspace (RLS) → PARAR.
- Romper la demo offline → PARAR y revertir el cambio del módulo.
- Errores de lint/tsc/build → no avanzar.
