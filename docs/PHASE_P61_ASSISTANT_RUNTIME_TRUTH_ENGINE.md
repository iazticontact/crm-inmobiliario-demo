# P61 — ASSISTANT RUNTIME TRUTH ENGINE & END-TO-END CLOSURE

**Estado:** ✅ CODE COMPLETE / ⛔ MANUAL UI E2E BLOCKED (falta sesión autenticada de staging)
**Fecha:** 2026-07-09

> Enfoque honesto (según el propio spec: «la prioridad es el comportamiento real, no construir arquitectura
> sin integrar»): se atacan las **clases estructurales** del incidente con fixes reales y se demuestran con
> un test multi-turn contra el **motor real** (`tryLocalAnswer`) + un mock de Supabase que refleja los
> datos reales. No se añaden abstracciones no integradas (planner/registry vacíos) que no cambien conducta.

## 1. Baseline
`main` limpio, HEAD `4b277b2` (P60). Strict activo, n8n bajo contrato, 32 suites verdes.

## 2-3. Transcript real + causa raíz
`P61_INCIDENT_ROOT_CAUSE.md`. Datos reales: **0 citas próximas, 0 tareas pendientes, 9 clientes, David
existe** → «no hay citas» era correcto; el fallo era de forma/estructura. Causa estructural clave:
`getClient360` con `Promise.all` consultaba **`conversations`/`messages` (tablas inexistentes)** → una
sección rechazaba y **tiraba abajo toda la ficha** → «no puedo acceder a los datos de clientes».

## 4-9. Fixes (comportamiento real)
1. **Ficha con degradación parcial** (`getClient360`): core primero y por separado; secciones opcionales
   (tareas, citas, documentos, actividad) leídas de forma **independiente y resiliente** (una que falle →
   vacío, no rompe la ficha). Eliminadas las tablas inexistentes `conversations`/`messages`.
2. **Detalle local de cliente** (`handleClientDetail` + `extractDetailName`): «ficha completa de David
   Iglesias» → resuelve el cliente (único/parcial/varios/ninguno) y compone la ficha **localmente**; nunca
   «no puedo acceder» si el cliente existe. Lista→detalle resuelto sin depender de n8n.
3. **Agenda multi-fuente + answer-first** (`handleAgenda`): «¿tengo citas o tareas?» consulta calendar_events
   **y** tasks (tablas distintas) y responde **sí/no por cada una**. «¿tengo citas próximas?» → «Citas
   próximas: **no**…» (nunca «no hay citas para mostrar»).
4. **Confirmación de vacío**: «¿no tengo nada?/me quieres decir?» tras una agenda vacía → **re-afirma** el
   resultado (no smalltalk social). Se guarda el vacío como vacío del módulo, no como «nada en el CRM».
5. **Resumen de módulo con datos** (`handlePortfolioSummary`): «resumen de **mi** cartera» → conteo por
   estado en vivo. Corrige la **regresión P60**: el posesivo «mi/mis» + módulo = datos, no «¿entender o
   tus datos?».
6. **Saludo coloquial**: «hola que hay», «qué tal» → social (antes «hay» lo leía como consulta y caía a
   n8n); «hola + comando» sigue leyendo datos.

## 10-14. Datos vivos / workspace / errores
Todas las lecturas usan `crmReadQuery`/readers con **RLS del workspace de sesión** (sin hardcode). Agenda,
cartera y ventas leen **en vivo** (no `lastResults`). **Fallback parcial** en agenda y ficha: si una fuente
falla y otra responde, se da la parcial; nunca «fallo temporal total» cuando hay datos.

## 15. n8n (auditoría)
No requería cambios para estas clases: todas se resuelven **localmente** (`handled:true`) → n8n **no se
invoca** en ellas, así que no puede alucinar «no consta» ni reinterpretar el objetivo. n8n sigue bajo
contrato (turnPolicyToken + allowedTools + strict). Strict re-verificado 7/7 en vivo. (No se modificó el
workflow; los fixes son de readers/route, que el propio n8n consume vía el endpoint.)

## 16-20. Tests
- **`scripts/p61-incident-conversation-check.mts`**: reproduce el transcript completo (7 turnos) contra
  `tryLocalAnswer` con un **mock realista** (0 citas, 0 tareas, 9 clientes, David con ficha). **TODO PASS**:
  saludo social, citas answer-first NO, confirmación no-social, dos fuentes, resumen cartera con datos,
  9 clientes, ficha David sin «no puedo acceder».
- **`assistant-conversation-engine.evals.ts`**: saludo coloquial, resumen posesivo→datos, extracción de
  ficha, no-regresión P53/P56/P58/P60.
- **33 suites TODO VERDE** · tsc/lint/build/gate ✅ · **strict 7/7 en vivo** · scans limpios (documents=0,
  invoices agents=0, sin secretos).

## 21-26. Archivos / migraciones / qué NO / riesgos
**Modificados:** `agent-tool-readers.ts` (client360 resiliente), `local-answers.ts` (handleAgenda/
handlePortfolioSummary/handleClientDetail + gates + confirm-followup), `summary-intent.ts` (posesivo),
`assistant-pragmatics.ts` (saludo coloquial). **Nuevos:** eval + incident script + 2 docs.
**0 migraciones.** No se tocó: n8n workflow, strict, Facturación, arquitectura del contrato.
**Riesgos:** el estado conversacional del follow-up de vacío se infiere de `recentContext` (heurística);
la UI E2E con Playwright queda **BLOCKED por falta de sesión autenticada** (no invento PASS). El
incident-check cubre el motor real con datos realistas, no el render del navegador.

## 27-28. Cómo validar en UI
`P60_FINAL_ASSISTANT_UI_QA_CARD.md` + el transcript del incidente. Críticos: «tengo citas próximas?»
(answer-first NO), «no tengo nada?» (no social), «citas o tareas?» (dos fuentes), «resumen de mi cartera»
(datos), «ficha completa de David» (ficha, sin «no puedo acceder»).

---

**P61 CODE COMPLETE — FICHA CON DEGRADACIÓN PARCIAL (client360 ya no cae por tablas inexistentes), DETALLE
LOCAL LISTA→FICHA, AGENDA MULTI-FUENTE ANSWER-FIRST, CONFIRMACIÓN DE VACÍO SIN PERDER CONTEXTO, RESUMEN DE
MÓDULO CON DATOS (regresión P60 corregida) Y SALUDO COLOQUIAL. INCIDENT MULTI-TURN + 33 SUITES + STRICT 7/7
VERDES. / UI E2E BLOCKED: TEST_SESSION_MISSING.**
