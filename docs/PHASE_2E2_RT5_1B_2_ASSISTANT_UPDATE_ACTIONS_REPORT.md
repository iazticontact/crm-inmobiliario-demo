# Fase 2E-2 RT5.1b-2 — Assistant update actions end-to-end (informe)

**Fecha:** 2026-06-15 · **Base:** `8cdcebd` · **Política:** [DATA_REALITY_POLICY.md](DATA_REALITY_POLICY.md)
Sigue a [PHASE_2E2_RT5_1B_IMPL_REPORT.md](PHASE_2E2_RT5_1B_IMPL_REPORT.md)

## 1. Objetivo
Que el chat prepare y confirme acciones de **edición** que necesitan el ID real
de la entidad: mover etapa de operación, actualizar tarea y actualizar expediente.

## 2. Acciones implementadas (end-to-end)
- **`move_operation_stage`** ("mueve/pasa/cambia/marca la operación de X a
  negociación/oferta/ganada/…").
- **`update_task`** ("marca/pon/cambia la tarea de X como completada / alta /
  pendiente / en curso / cancelada"): estado y/o prioridad.
- **`update_service_case`** ("marca/pon el expediente de X como resuelto / en
  revisión / alta prioridad"): estado y/o prioridad.

## 3. Acciones diferidas
- **`update_calendar_event`** (reprogramar): requiere parsing robusto de
  fecha/hora + resolución de evento → RT5.1b-3. El executor (RT5.1) ya lo soporta.
- Edición de `due_date`/`assigned_to` de tarea/expediente por chat (assigned_to
  necesita resolver miembro por nombre vía profiles) → RT5.1b-3.

## 4. Arquitectura — resolver DB-aware
Nuevo módulo `src/lib/agents/deterministic-db-actions.ts` (`resolveDbAction`),
invocado desde `/api/assistant/v2` **solo** cuando ni el agente OpenAI ni el
fallback de texto produjeron acción. A diferencia del fallback de texto, este
**consulta Supabase** (cliente cookie-bound del route, RLS) para resolver el ID
real de la entidad. **No se tocó el agente OpenAI (2018 l).**

## 5. Resolución de entidades / ambigüedad
1. Detecta intención (operación/tarea/expediente + verbo de cambio) + el
   cambio (etapa/estado/prioridad, mapeado es→interno).
2. Resuelve cliente por nombre (ilike, workspace-scoped): 0 → "No encuentro a X";
   ≥2 → lista nombres y pide elegir; 1 → continúa.
3. Resuelve la entidad abierta del cliente: 0 → "No encuentro …"; ≥2 → lista
   títulos reales y pide el título; 1 → prepara la acción con el **ID real**.
4. Nunca inventa IDs/fechas; si falta el cambio, lo pregunta; sin UUIDs visibles.

## 6. Confirm-cards
Nuevas cards: **Mover operación** (operación, etapa actual → nueva etapa),
**Actualizar tarea** y **Actualizar expediente** (entidad, nuevo estado/prioridad),
con Confirmar/Cancelar. Sin botón Editar (se confirman/cancelan). Sin UUIDs.

## 7. Executor compatibility
Sin reescribir el executor. El page construye `confirmPayload` con
`opportunityId/stage` (move), `taskId/status/priority` (task),
`caseId/status/priority` (case) — exactamente lo que validan los handlers RT5.1.
Para evitar resolución de cliente innecesaria en updates, el payload **no** envía
clientId/clientName (el handler usa el id de la entidad + `.eq(workspace_id)` + RLS).
No rompe booking/task/invoice/report/create_*.

## 8. Demo mode
El guard de `confirmPreparedAction` (RT5.1b) sigue: en demo no escribe y muestra
"Modo demo: acción no guardada".

## 9. Guardrails
Sin datos/IDs/fechas inventados; resolución real server-side (RLS); ambigüedad →
opciones reales; sin mocks en real; sin escritura sin confirmación; sin
service_role en frontend (el resolver usa el cliente de sesión).

## 10. Validaciones
| Check | Resultado |
|-------|-----------|
| `npx tsc --noEmit` | ✅ |
| `npm run lint -- --max-warnings=0` | ✅ |
| `npm run build` | ✅ (46 rutas) |

## 11. Smoke test (pendiente Oier — `npm run dev -- --webpack`)
Real (copilot, login owner):
1. "qué operaciones abiertas tengo".
2. "mueve la operación de [cliente real] a negociación" → card → Cancelar (no escribe).
3. Repetir → Confirmar → cambia etapa + actividad.
4. "marca la tarea de [cliente] como completada" → Confirmar → cambia.
5. "marca el expediente de [cliente] como resuelto" → Confirmar → cambia.
6. Cliente/entidad inexistente → "No encuentro…"; varios → lista y pide elegir.
7. Sin UUIDs, sin datos inventados, sin errores RLS.
Demo: preparar → Confirmar → "Modo demo: acción no guardada".

## 12. Archivos tocados
- `src/lib/agents/deterministic-db-actions.ts` (nuevo) — resolver DB.
- `src/lib/agents/nowlabs-main-agent.ts` — `PreparedActionDraft` (+3 tipos, +ids).
- `src/app/api/assistant/v2/route.ts` — invoca el resolver tras el fallback.
- `src/app/(saas)/assistant/page.tsx` — unión + V2Response local + mapeo + payload
  + finalización + confirm-cards.

## 13. Riesgos / siguiente fase
- **RT5.1b-3:** `update_calendar_event` (reprogramar) + due_date/assigned_to por chat.
- Smoke navegador pendiente.
- Tras esto: parar features del asistente y hacer smoke completo + staging.
