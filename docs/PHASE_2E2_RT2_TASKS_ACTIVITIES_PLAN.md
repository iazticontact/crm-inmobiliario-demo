# Fase 2E-2 RT2 — Plan: ficha de cliente en profundidad + tasks + activities (read-only)

**Fecha:** 2026-06-14 · **Estado:** plan (NO implementar aún). Sigue a [PHASE_2E2_RT1_IMPLEMENTATION_REPORT.md](PHASE_2E2_RT1_IMPLEMENTATION_REPORT.md).

## 1. Objetivo
Profundizar la **ficha de cliente** (relaciones completas) y conectar **tasks** y **activities** en lectura sobre Supabase real, preservando la demo offline. La mayoría ya está cableada (RT0/RT1); RT2 es verificación + pulido + cualquier hueco de lectura.

## 2. Alcance
- **Ficha de cliente** (`src/app/(saas)/clients/[id]/page.tsx`): confirmar carga real de propiedades, operaciones, tasks, activities, eventos vinculados; estados de carga/empty/error; naming "Operaciones".
- **Tasks**: lecturas vía `listTasks`/`getPendingTasks` (dashboard ya las usa); si hay una vista/tab de tareas, conectarla; prioridad `low/normal/high`.
- **Activities (timeline)**: `getActivities` (dashboard ya lo usa); revisar mapeo de `type` (email/call/message/deal/note) e iconos; alinear títulos si se decide tocar la capa de datos (`vertical-queries`/`vertical-server` "Oportunidad…"→"Operación…") — **decisión pendiente** (afecta también al espejo del agente).

## 3. Archivos candidatos
- `src/app/(saas)/clients/[id]/page.tsx` (deeper).
- `src/lib/supabase-queries.ts` (`listTasks`, `getActivities`, `getClientFullContext`) — reutilizar; no reescribir.
- (Opcional) `src/lib/vertical-queries.ts` / `vertical-server.ts` solo si se decide alinear los títulos de activity a "Operación".

## 4. No tocar
Rutas, tabla/tipos, `src/lib/agents/*`, Storage/Auth/billing/inbox, `.env*`, `.mcp.json`.

## 5. Tests manuales
Login owner → abrir varias fichas: ver operaciones, propiedades, tareas y actividad reales; demo offline intacta; sin errores RLS.

## 6. Validaciones
`npm run lint -- --max-warnings=0`, `npx tsc --noEmit`, `npm run build`.

## 7. Siguiente
RT3 (calendar_events lecturas), RT4 (mutations endurecidas). Storage/billing/inbox quedan para 2E-3/2E-4.
