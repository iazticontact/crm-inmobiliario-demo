# Fase 2E-2 RT4 — Mutaciones controladas (informe)

**Fecha:** 2026-06-15 · **Base:** `1b3a9c5` · **Política:** [DATA_REALITY_POLICY.md](DATA_REALITY_POLICY.md)
Roadmap: [PHASE_2E2_NEXT_PHASES_ROADMAP.md](PHASE_2E2_NEXT_PHASES_ROADMAP.md)

## 1. Objetivo
Pasar de CRM read-only a operativo: primeras **mutaciones reales controladas**
contra Supabase (RLS), empezando por **tareas** (Priority 1) + **selector de
responsable** (Priority 5) + **actividad automática**. Operaciones/expedientes/
eventos quedan para RT4.2 (ver §3).

## 2. Mutaciones implementadas (Tasks — Priority 1)
En la **ficha de cliente** ([clients/[id]/page.tsx](../src/app/(saas)/clients/[id]/page.tsx)),
pestaña **Tareas**:
- **Crear tarea real** ("Nueva tarea"): título (obligatorio), prioridad,
  vencimiento, **responsable** (selector de miembros) y descripción. Inserta en
  `tasks` con `workspace_id` resuelto y `client_id`/`client_name` del cliente.
- **Marcar completada / reabrir**: botón por fila → `updateTask` (status
  `completed`⇄`pending`).
- **Refresco**: actualización optimista con la fila real devuelta por Supabase
  (sin recargar toda la ficha, sin flash).
- **Actividad automática** (best-effort): al crear ("Tarea creada: …") y al
  completar ("Tarea completada: …") vía `createActivity`, y se inserta en el
  timeline al instante. Si la actividad falla, **no** rompe la operación
  principal.

## 3. Pendiente (diferido a RT4.2, con justificación)
- **Operaciones** (Priority 2): los helpers de escritura ya existen
  (`createOpportunity`/`updateOpportunityStage`/`updateOpportunity` en
  [vertical-queries.ts](../src/lib/vertical-queries.ts)) y el **pipeline**
  (`/opportunities`) ya permite crear y mover etapa. Falta el alta desde la
  ficha. Diferido para mantener este sprint verde y acotado.
- **Expedientes** (Priority 3): `createServiceCase`/`updateServiceCase*` ya
  existen; falta UI de alta en ficha.
- **Eventos** (Priority 4): el calendario ya crea/edita eventos reales; falta
  alta desde la ficha. (Sin Google OAuth.)
- Motivo: créditos limitados + regla "no dejar trabajo a medias". Tasks es un
  incremento completo y autónomo.

## 4. Arquitectura elegida
**Client-side Supabase (anon + RLS)**, sin `service_role` en frontend:
- `workspace_id` siempre resuelto desde la sesión (`getWorkspaceContext`).
- `client_id` del cliente de la ficha; `assigned_to` solo un miembro válido del
  workspace (lo garantiza el selector + el trigger `enforce_member_refs`).
- Helpers nuevos en [supabase-queries.ts](../src/lib/supabase-queries.ts):
  `updateTask(workspaceId, id, input)` y `listWorkspaceProfiles(workspaceId)`
  (devuelve `WorkspaceMember{id,name,email,role}`). `createTask`/`createActivity`
  ya existían.

## 5. Demo mode (cómo evita writes)
Cada handler comprueba `localStorage['nowcrm-demo-mode'] === 'true'` **antes** de
escribir: muestra "Modo demo (no se guarda)" y retorna sin tocar Supabase. El
selector de responsable en demo solo ofrece "Sin asignar" (sin miembros).

## 6. Modo real (cómo escribe)
Sesión Supabase real → insert/update con RLS sobre el workspace del usuario;
errores → toast de error (sin fallback a mock); éxito → toast + estado
actualizado con la fila real.

## 7. Activity logging
`createActivity(workspaceId, { type, description, clientName })`. Nota: el tipo
de actividad está acotado por el modelo (`ActivityType` = email/call/message/
deal/note); se usa **`note`** para tareas (la descripción aporta el detalle). Se
muestra en el feed por-cliente (`getClientActivityFeed`, que casa por
`client_name`).

## 8. Selector de responsables (RT2.5 efectivo)
`listWorkspaceProfiles` carga los perfiles del workspace; el formulario muestra
**nombre** (full_name → email-localpart → "Miembro"), nunca UUID; opción por
defecto "Sin asignar". En la fila de tarea se muestra el responsable resuelto
(`memberNameById`) o "Sin asignar". Hoy `profiles=1` (Demo Owner): aparece
"Demo Owner", no UUID.

## 9. Validaciones
| Check | Resultado |
|-------|-----------|
| `npx tsc --noEmit` | ✅ |
| `npm run lint -- --max-warnings=0` | ✅ |
| `npm run build` | ✅ (46 rutas) |

## 10. Smoke test (pendiente Oier — `npm run dev -- --webpack`)
Demo: "Ver demo inmobiliaria" → ficha → "Nueva tarea" / "Completar" muestran
"Modo demo (no se guarda)"; nada se escribe; demo navegable.
Real: login owner → ficha cliente → "Nueva tarea" (con responsable) → aparece en
la lista → "Completar" la cierra → la actividad "Tarea creada/completada"
aparece en Actividad reciente → sin errores RLS → el responsable muestra nombre,
no UUID. (Verificar opcional: `tasks` sube de 10 y nueva fila con `client_id`/
`assigned_to` correctos.)

## 11. Riesgos pendientes
- Operaciones/expedientes/eventos desde ficha (RT4.2).
- Edición avanzada de tarea (cambiar prioridad/fecha/responsable tras crearla)
  no incluida; solo crear + completar/reabrir.
- Smoke test navegador pendiente.

## 12. Siguiente fase recomendada
**RT4.2** — extender mutaciones a operaciones/expedientes/eventos desde la ficha
reutilizando los helpers existentes, con el mismo patrón (RLS + demo guard +
activity). Luego RT5 (assistant tools reales).
