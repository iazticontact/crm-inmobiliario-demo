# Fase 2E-2 RT5.1b — Assistant end-to-end (informe + diseño)

**Fecha:** 2026-06-15 · **Base:** `c93e32a` · **Política:** [DATA_REALITY_POLICY.md](DATA_REALITY_POLICY.md)
Sigue a [PHASE_2E2_RT5_1_ASSISTANT_CONFIRMED_ACTIONS_REPORT.md](PHASE_2E2_RT5_1_ASSISTANT_CONFIRMED_ACTIONS_REPORT.md)

## 1. Objetivo
Cerrar el ciclo conversacional para que el chat **prepare** (con confirmación) las
6 acciones CRM que el executor ya ejecuta (RT5.1): create_operation,
move_operation_stage, create_service_case, update_service_case, update_task,
update_calendar_event.

## 2. Estado tras auditoría — qué ya existe
El asistente **ya es un agente real, no un chatbot if/else**:
- **Cerebro:** `src/lib/agents/nowlabs-main-agent.ts` (~2018 l) — *"OpenAI Responses
  API + 28 tools sobre Supabase real. Sin n8n, sin service_role, sin SQL libre."*
  Resuelve entidades reales con tools y emite `PreparedActionDraft`.
- **Fallback determinista:** `src/lib/agents/deterministic-fallback.ts` (~232 l) —
  red de seguridad por reglas para task/booking/invoice (sin inventar; sin DB).
- **PREPARE route:** `/api/assistant/v2` — auth + RLS, llama al agente, clasifica
  errores, devuelve `preparedAction` (nunca texto OpenAI crudo al browser).
- **CONFIRM executor:** `/api/assistant/confirm` — auth.getUser + RLS, ejecuta
  booking/task/invoice/report **y (RT5.1) las 6 acciones CRM nuevas**.
- **Page:** unión discriminada `PreparedAction` + confirm-cards type-specific +
  `confirmPreparedAction`/`cancelPreparedAction`.

## 3. Qué se hizo en este sprint
**No se modificó el código del agente/página** (decisión de riesgo, ver §5).
Se entregó:
- **Auditoría end-to-end** del flujo PREPARE→CONFIRM y del contrato de tipos.
- **Verificación de seguridad:** sin `service_role` en frontend (en `settings`
  y comentarios solo aparece el *nombre*; uso real solo server).
- **Documentación de arquitectura futura** ([AI_ASSISTANT_LONG_TERM_ARCHITECTURE.md](AI_ASSISTANT_LONG_TERM_ARCHITECTURE.md))
  y **readiness pre-Hostinger** ([PRE_HOSTINGER_PRODUCTION_READINESS.md](PRE_HOSTINGER_PRODUCTION_READINESS.md)).
- Build/tsc/lint verdes.

## 4. Diseño preciso de RT5.1b (pendiente de implementar)
El executor ya acepta las 6 acciones; falta **emitirlas** desde el cerebro y
**renderizarlas** en la card. Plan por acción:

### 4.1 create_operation / create_service_case (riesgo BAJO — vía fallback)
Solo requieren `clientName` (texto) + título; el executor resuelve el cliente
canónico. Implementación:
1. `PreparedActionDraft` (agente): añadir `'create_operation' | 'create_service_case'`
   al union + campos `stage?/value?/probability?/caseType?/status?/priority?/title?`.
2. `deterministic-fallback.ts`: triggers `crea/abre una operación|expediente para X`
   → extraer clientName + título → `PreparedActionDraft` con `missingFields`.
3. Page: variante en la unión `PreparedAction`, mapeo en la respuesta v2, confirm
   card (Operación/Expediente, cliente, campos) y ruteo en `confirmPreparedAction`
   → POST `/api/assistant/confirm` (executor ya listo).

### 4.2 move_operation_stage / update_task / update_service_case / update_calendar_event (riesgo MEDIO-ALTO — vía agente OpenAI)
Requieren **resolver el ID real** de la entidad (operación/tarea/expediente/
evento) → debe vivir en el agente OpenAI (tiene tools de lectura). Implementación:
1. Añadir tools `prepare_move_operation_stage`, `prepare_update_task`,
   `prepare_update_service_case`, `prepare_update_calendar_event` al agente
   (`nowlabs-main-agent.ts`): buscan la entidad real, si hay varias devuelven
   candidatos, mapean etapa/estado es-ES→interno, emiten `PreparedActionDraft`.
2. Mapeo de etapas (es→interno): nuevo→new, contactado→contacted,
   cualificado→qualified, visita programada→visit_scheduled, oferta→offer,
   negociación→negotiation, ganada→won, perdida→lost.
3. Page: variantes + cards + ruteo (igual que 4.1).

## 5. Por qué se difirió la implementación (FASE P)
- El cerebro (2018 l, agente OpenAI con 28 tools) y la página (3369 l, unión
  discriminada + cards type-specific) son el subsistema más complejo y **en
  funcionamiento**. Extenderlo end-to-end es multi-archivo y de riesgo medio-alto.
- Con créditos limitados, forzar esa cirugía arriesgaba dejar el asistente en
  estado parcial/roto — contra las reglas ("no fuerces, deja parcial seguro, no
  commit si parcial roto"). Se priorizó **executor seguro (ya hecho) + docs +
  readiness** y un diseño accionable.

## 6. Guardrails anti-invención (vigentes)
- El agente trabaja sobre Supabase real (tools), no inventa; el prompt incluye la
  regla "No encuentro datos reales en este workspace".
- El executor nunca confía en `clientName` del body (resuelve canónico; ambigüedad
  → `candidates`; inexistente → error).
- Sin UUIDs en la UI; sin mocks en real.

## 7. Demo mode
La confirmación real exige sesión (auth.getUser); en demo no hay sesión real →
no escribe. Las cards de RT5.1b deben mantener el guard "Modo demo: no se guarda".

## 8. Validaciones
| Check | Resultado |
|-------|-----------|
| `npx tsc --noEmit` | ✅ (sin cambios de código) |
| `npm run lint -- --max-warnings=0` | ✅ |
| `npm run build` | ✅ (46 rutas) |

## 9. Smoke test
- READ por chat ya funciona (RT5): "qué operaciones abiertas tengo", "tareas
  pendientes", "resumen del CRM".
- PREPARE→CONFIRM por chat de las 6 acciones CRM: **pendiente** (RT5.1b code).
- Executor (API) de las 6 acciones: listo (RT5.1).

## 10. Riesgos pendientes / siguiente fase
- **RT5.1b-impl:** implementar §4 (empezar por create_operation/create_service_case
  vía fallback — bajo riesgo; luego move/update vía agente). El executor ya está.
- Smoke conversacional pendiente.
