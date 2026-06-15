# Fase 2E-2 RT5.1 — Assistant confirmed actions (informe)

**Fecha:** 2026-06-15 · **Base:** `45c6957` · **Política:** [DATA_REALITY_POLICY.md](DATA_REALITY_POLICY.md)
Sigue a [PHASE_2E2_RT5_ASSISTANT_TOOLS_REPORT.md](PHASE_2E2_RT5_ASSISTANT_TOOLS_REPORT.md)

## 1. Objetivo
Extender el confirm-execute del asistente a las acciones CRM core de RT4.x
(operaciones, expedientes, tareas, eventos), manteniendo la regla de
confirmación explícita, RLS y sin service_role en frontend.

## 2. Qué se implementó (executor seguro — FASE F)
Se extendió el **executor** `/api/assistant/confirm`
([route.ts](../src/app/api/assistant/confirm/route.ts)) con 6 acciones nuevas,
siguiendo el patrón existente (sesión cookie-bound + `auth.getUser()` + RLS,
workspace desde `profiles`, `resolveActionClient` canónico, activity best-effort,
respuesta `{ ok, type, entityId, message }`):

| Acción | Tabla | Validación clave |
|--------|-------|------------------|
| `create_operation` | opportunities | clientId canónico + title; stage/value/probability/cierre/responsable opcionales |
| `move_operation_stage` | opportunities | opportunityId (UUID) + stage; `.eq(workspace_id)` |
| `create_service_case` | service_cases | clientId canónico + title; status/priority/venc/responsable |
| `update_service_case` | service_cases | caseId (UUID) + al menos un cambio |
| `update_task` | tasks | taskId (UUID) + al menos un cambio |
| `update_calendar_event` | calendar_events | eventId (UUID); reprogramar requiere date+time válidos; **sin Google** |

Tipos añadidos a `PreparedActionType` + `ALLOWED_TYPES`; campos a
`ConfirmableAction` (opportunityId/caseId/taskId/eventId/title/stage/status/
priority/value/probability/expectedCloseDate/assignedTo/caseType/location/
eventType). Cada handler:
- valida que la entidad pertenece al workspace (`.eq('workspace_id', …)` + RLS);
- `assigned_to` solo se acepta si es UUID (el trigger `enforce_member_refs`
  valida que sea miembro);
- registra `activity` best-effort ("Operación creada/movida", "Expediente
  creado/actualizado", "Tarea actualizada", "Evento actualizado") — naming
  "Operación", nunca "Oportunidad";
- nunca usa service_role (cliente de sesión, RLS).

## 3. Qué queda diferido (RT5.1b) — y por qué
**El lado conversacional (PREPARE + UI confirm) NO se cableó en este sprint.**
- `/api/assistant/v2` (NLP, 295 l) tendría que detectar las intenciones, resolver
  la entidad real (operación/expediente/tarea/evento) y emitir el `preparedAction`.
- `assistant/page.tsx` (3369 l) tendría que ampliar la **unión discriminada**
  `PreparedAction` + la card de confirmación type-specific + el ruteo en
  `confirmPreparedAction`.
- **Motivo (FASE N):** es la parte de mayor riesgo (NLP + unión discriminada +
  card en un archivo de 3369 l) y con créditos limitados se priorizó entregar el
  **executor seguro y verde** sin desestabilizar el asistente. No se finge que el
  asistente ya las dispara por chat.

Estado real hoy: el executor **acepta y ejecuta** estas 6 acciones de forma
segura cuando recibe el `preparedAction` correspondiente (vía el propio
`confirmPreparedAction` cuando se cablee, o vía un caller server/n8n). La
detección por lenguaje natural es RT5.1b.

## 4. Prepare flow (existente)
`/api/assistant/v2` prepara `preparedAction` (booking/task/invoice/report hoy);
el page muestra card y permite cancelar. Sin cambios en este sprint.

## 5. Confirm flow / executor
`confirmPreparedAction` (page) → POST `/api/assistant/confirm` con el
`preparedAction`. El executor revalida todo server-side (tipo permitido,
missingFields, cliente canónico, entidad en workspace) antes de escribir.

## 6. Seguridad
- `/api/assistant/confirm` usa **cliente de sesión (anon/publishable + cookies +
  `auth.getUser()`), RLS** — **no service_role**. Verificado: el route no
  contiene `service_role`.
- Ninguna acción se ejecuta sin `preparedAction` (POST explícito tras confirmar).
- Entidades validadas por workspace; `assigned_to` validado por trigger.

## 7. Demo mode
La confirmación real requiere sesión Supabase (auth.getUser). En demo (sin sesión
real) el executor devuelve 401/sin workspace → no escribe. El page ya bloquea/avisa
en demo. (El cableado UI de RT5.1b mantendrá el guard "Modo demo: no se guarda".)

## 8. Guardrails anti-invención
- El executor nunca confía en `clientName` del body: resuelve el cliente canónico
  (`resolveActionClient`), y si hay ambigüedad devuelve `candidates` para escoger;
  si no existe → `client_not_found`.
- IDs de entidad deben ser UUID reales del workspace; si no, error.
- Sin UUIDs en mensajes de respuesta (se usan títulos/nombres).

## 9. Validaciones
| Check | Resultado |
|-------|-----------|
| `npx tsc --noEmit` | ✅ |
| `npm run lint -- --max-warnings=0` | ✅ |
| `npm run build` | ✅ (46 rutas) |

## 10. Smoke test
- **Executor (API):** con sesión owner, un POST a `/api/assistant/confirm` con
  `{ preparedAction: { type:'move_operation_stage', opportunityId:<uuid real>,
  stage:'negotiation' } }` cambia la etapa y registra activity; con un id de otro
  workspace → 404 (RLS). (Pendiente de cableado conversacional para probar por chat.)
- **Pendiente (Oier):** smoke conversacional cuando se entregue RT5.1b.

## 11. Riesgos pendientes
- **RT5.1b:** PREPARE (v2 NLP) + UI confirm (unión discriminada + card) para
  disparar estas acciones desde el chat. Es el grueso de UX restante.
- Sin borrado de entidades desde el asistente.

## 12. Siguiente fase recomendada
**RT5.1b** — cablear v2 + page para que el chat prepare y confirme estas 6
acciones (el executor ya está listo). Alternativa: **2E-3 (Storage/documents)**.
