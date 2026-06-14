# Fase 2E-2 RT4.2 — Mutaciones: Operaciones, Expedientes y Eventos (informe)

**Fecha:** 2026-06-15 · **Base:** `d81e6ef` · **Política:** [DATA_REALITY_POLICY.md](DATA_REALITY_POLICY.md)
Sigue a [PHASE_2E2_RT4_MUTATIONS_REPORT.md](PHASE_2E2_RT4_MUTATIONS_REPORT.md)

## 1. Objetivo
Extender el patrón seguro de RT4 (RLS + demo guard + activity) al alta de
**operaciones**, **expedientes** y **eventos** desde la ficha de cliente, con
selector de responsable real.

## 2. Implementado
Desde [clients/[id]/page.tsx](../src/app/(saas)/clients/[id]/page.tsx):
- **Operaciones** (Pipeline comercial): botón "Nueva operación" + formulario
  (título*, etapa del pipeline inmobiliario, valor, probabilidad, responsable,
  cierre estimado, notas) → `createOpportunity` (vertical/pipeline `real_estate`,
  `client_id`, `assigned_to`). Update optimista con la fila real.
- **Expedientes** (service_cases): botón "Nuevo expediente" + formulario
  (título*, tipo, estado, prioridad, vencimiento, responsable, notas) →
  `createServiceCase`. Update optimista.
- **Eventos** (calendario, sin Google): botón "Nuevo evento" + formulario
  (título*, tipo, fecha*, hora, duración, ubicación, notas) →
  `createCalendarEvent` (deriva `start_at`/`end_at`; `client_id`/`client_name`).
  **Sin Google OAuth, sin `google_event_id`.**
- **Responsable**: los tres formularios usan el selector de miembros
  (`listWorkspaceProfiles`); muestra nombre, nunca UUID; "Sin asignar" por
  defecto.

## 3. Diferido
- Cambiar etapa de operación / estado de expediente **desde la ficha**
  (los helpers `updateOpportunityStage`/`updateServiceCaseStatus` existen y el
  pipeline `/opportunities` ya permite mover etapa). UI inline en ficha → RT4.3.
- Edición avanzada de tareas (prioridad/fecha/responsable tras crear) → RT4.3.
- Vínculos opcionales evento↔property/opportunity/case y operación↔property:
  diferidos (requieren selectores adicionales).

## 4. Helpers nuevos / reutilizados
- Reutilizados: `createOpportunity`, `createServiceCase`, `createCalendarEvent`,
  `createActivity`, `listWorkspaceProfiles`, `getClientActivityFeed`.
- **Extendidos** ([vertical-queries.ts](../src/lib/vertical-queries.ts)):
  `createOpportunity` y `createServiceCase` ahora aceptan `assignedTo` (insert
  `assigned_to`); válido por el trigger `enforce_member_refs` (solo miembros).

## 5. Activity logging
- Operaciones y expedientes: `createOpportunity`/`createServiceCase` ya registran
  la actividad **internamente** (`logActivity`). Para evitar duplicados, tras el
  alta se **refresca el feed** (`getClientActivityFeed`) en lugar de loggear de
  nuevo.
- Eventos: `createCalendarEvent` no loggea solo → `createActivity` manual
  ("Evento creado: …"), insertado en el timeline al instante.
- Naming: se corrigieron los títulos internos de actividad de operaciones
  ("Oportunidad …" → "**Operación** …") en `vertical-queries.ts`. El feed muestra
  la `description` (no el `title`), así que no había "Oportunidad" visible; ahora
  además el dato persistido es consistente.

## 6. Demo guard
Cada handler llama `isDemoMode()` (localStorage `nowcrm-demo-mode`) **antes** de
escribir → toast "Modo demo (no se guarda)" y retorna sin tocar Supabase.

## 7. Modo real
Mutaciones client-side con anon + RLS sobre el workspace del usuario (sin
service_role); `workspace_id` desde sesión; errores → toast (sin fallback a
mock); éxito → toast + estado con la fila real.

## 8. Data Reality Policy
Real escribe solo Supabase; demo no escribe; sin fallback demo ante error real;
sin datos inventados; sin UUID visible (selector muestra nombre); sin
WhatsApp/Google real.

## 9. Validaciones
| Check | Resultado |
|-------|-----------|
| `npx tsc --noEmit` | ✅ |
| `npm run lint -- --max-warnings=0` | ✅ |
| `npm run build` | ✅ (46 rutas) |

## 10. Smoke test (pendiente Oier — `npm run dev -- --webpack`)
Demo: ficha → "Nueva operación/expediente/evento" → toast "Modo demo (no se
guarda)"; nada se escribe.
Real: login owner → ficha cliente →
1. "Nueva operación" (con responsable/etapa/valor) → aparece en Pipeline comercial; actividad "Operación creada" en Actividad reciente.
2. "Nuevo expediente" → aparece en Expedientes; actividad creada.
3. "Nuevo evento" (fecha+hora) → aparece en Visitas y citas; actividad "Evento creado".
4. Responsable muestra nombre (Demo Owner), nunca UUID. Sin errores RLS.
(Opcional: counts suben en opportunities/service_cases/calendar_events/activities.)

## 11. Riesgos pendientes
- Cambiar etapa/estado y edición avanzada desde ficha (RT4.3).
- Vínculos cruzados opcionales (evento↔inmueble/operación) diferidos.
- Smoke test navegador pendiente.

## 12. Siguiente fase recomendada
**RT4.3** (cambios de etapa/estado + edición desde ficha) o **RT5** (assistant
tools reales). Ver [PHASE_2E2_NEXT_PHASES_ROADMAP.md](PHASE_2E2_NEXT_PHASES_ROADMAP.md).
