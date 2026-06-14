# Fase 2E-2 RT4.3 — Edición controlada (informe)

**Fecha:** 2026-06-15 · **Base:** `cb7d2dc` · **Política:** [DATA_REALITY_POLICY.md](DATA_REALITY_POLICY.md)
Sigue a [PHASE_2E2_RT4_2_MUTATIONS_REPORT.md](PHASE_2E2_RT4_2_MUTATIONS_REPORT.md)

## 1. Objetivo
Cerrar el ciclo operativo con **edición inline** desde la ficha de cliente:
cambiar etapa/estado/prioridad, reasignar responsable, reprogramar y editar
campos, con actividad automática y bajo el mismo patrón seguro (RLS + demo
guard + optimista).

## 2. Ediciones implementadas (todas desde la ficha, botón "Editar" por fila)
- **Operaciones**: etapa, valor, probabilidad, responsable, fecha de cierre,
  notas → `updateOpportunity`.
- **Expedientes**: estado, prioridad, responsable, vencimiento, notas →
  `updateServiceCase`.
- **Tareas**: prioridad, fecha de vencimiento, responsable, descripción →
  `updateTask` (se mantiene Completar/Reabrir de RT4).
- **Eventos**: reprogramar (título, tipo, fecha, hora, duración, ubicación,
  notas) → `updateCalendarEvent`. **Sin Google OAuth ni `google_event_id`.**

Cada fila muestra el valor actual + un botón "Editar" que abre un formulario
compacto inline (prefilled); update optimista con la **fila real devuelta**.

## 3. Helpers usados/creados
- Reutilizados: `updateTask` (RT4), `updateOpportunity`, `updateServiceCase`,
  `updateCalendarEvent`, `createActivity`, `getClientActivityFeed`,
  `listWorkspaceProfiles`.
- **Extendidos** ([vertical-queries.ts](../src/lib/vertical-queries.ts)):
  `UpdateOpportunityInput` y `UpdateServiceCaseInput` ahora aceptan `assignedTo`
  (patch `assigned_to`), validado por el trigger `enforce_member_refs`.

## 4. Activity logging
- Operaciones/expedientes: `updateOpportunity`/`updateServiceCase` registran la
  actividad **internamente** ("Operación editada" / "Expediente editado") → tras
  guardar se **refresca el feed** (sin duplicar). Naming ya en "Operación".
- Tareas/eventos: `updateTask`/`updateCalendarEvent` no loggean solo →
  `createActivity` manual ("Tarea actualizada" / "Evento actualizado", type
  `note`), insertado en el timeline al instante.

## 5. Demo guard
Cada handler de edición llama `isDemoMode()` **antes** de escribir → toast
"Modo demo (no se guarda)" y retorna sin tocar Supabase.

## 6. Modo real / RLS
Updates client-side con anon + RLS sobre el workspace del usuario (sin
service_role); `.eq('workspace_id', …)` + `.eq('id', …)`; errores → toast (sin
fallback a mock); responsable se elige del selector de miembros (nombre, nunca
UUID).

## 7. Validaciones
| Check | Resultado |
|-------|-----------|
| `npx tsc --noEmit` | ✅ |
| `npm run lint -- --max-warnings=0` | ✅ |
| `npm run build` | ✅ (46 rutas) |

## 8. Smoke test (pendiente Oier — `npm run dev -- --webpack`)
Demo: ficha → "Editar" en operación/expediente/tarea/evento → toast "Modo demo
(no se guarda)"; nada cambia en Supabase.
Real: login owner → ficha →
1. Editar operación: cambiar etapa/valor/responsable → se refleja; actividad "Operación editada".
2. Editar expediente: estado/prioridad → se refleja; actividad "Expediente editado".
3. Editar tarea: prioridad/fecha/responsable → se refleja; actividad "Tarea actualizada"; Completar/Reabrir sigue OK.
4. Reprogramar evento: fecha/hora → se refleja; actividad "Evento actualizado".
5. Responsable siempre por nombre (Demo Owner), nunca UUID. Sin errores RLS.

## 9. Riesgos pendientes
- Borrado de entidades desde la ficha (no incluido; fuera de alcance RT4.3).
- Vínculos cruzados opcionales (operación↔inmueble, evento↔operación/caso).
- Smoke test navegador pendiente.

## 10. Siguiente fase recomendada
**RT5 — Assistant tools reales** (lecturas/escrituras con confirmación,
guardrail anti-invención), o 2E-3 (Storage/documents). Ver
[PHASE_2E2_NEXT_PHASES_ROADMAP.md](PHASE_2E2_NEXT_PHASES_ROADMAP.md).
