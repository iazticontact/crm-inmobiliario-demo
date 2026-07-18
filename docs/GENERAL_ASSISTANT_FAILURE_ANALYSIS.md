# GENERAL ASSISTANT — Failure analysis (forensics)

> Entrega OBLIGATORIA previa a cualquier cambio arquitectónico. Objetivo: demostrar POR QUÉ una conversación
> humana nueva e imprevista puede malinterpretarse, y si la causa es arquitectónica. No propone «añadir
> intents/regex/frases». Base: `main`=`origin/main`=`ad3c06e` (V1 `v1.0.0-rc1`), árbol limpio. Fecha 2026-07-18.
> No se ha tocado producción para producir este documento (solo lectura + inspección n8n GET + soak QA previo).

## 1. Arquitectura real actual (trazada del código, no conceptual)
`POST /api/assistant/v2` (`src/app/api/assistant/v2/route.ts`):
1. Supabase (sesión, RLS) → auth → workspace del perfil (nunca del body).
2. Guards: crisis, rate-limit (10/min), input-guard. `uiAction` (botón) → `executeUiAction` → **fin** (protocolo).
3. `loadConversationState` (v2; upgrade v1).
4. **`tryLocalAnswer`** (LOCAL-FIRST) — intenta resolver el turno SIN LLM. Si `handled` → responde y termina.
5. Si no: `decideTurn` (router de turno) firma una turn-policy y llama a **n8n** (LangChain agent + tools).
6. n8n `ok` → respuesta; persiste entidad/módulo en el MISMO ConversationState. n8n caído → error honesto.
7. Legacy V1 (`runNowLabsAgent`) solo con `ALLOW_LEGACY_ASSISTANT` (blindado).

## 2. Mapa de rutas (diagrama de decisión real)
```
mensaje
 └─ route: guards → uiAction? ──► executeUiAction (PROTOCOLO determinista)  ✔ correcto
     └─ tryLocalAnswer (LOCAL-FIRST, sin LLM):
         1 pendingIntent.complete/cancel          (regex + slots)
         2 handleTemporalFollowup                 (regex temporal + composición)
         3 handleContextualFollowup               (regex de referencia/elisión)
         4 decideTurn (P50): META/social/onboarding/how-it-works/…  (≈40 regex)
         5 empty-confirm agenda                    (regex)
         6 parseActionIntent → handleChatAction / detectIncompleteAction  (≈161 regex)
         7 automatización create/manage/confirm    (regex)
         8 ventas / agenda / resumen / findings     (regex)
         9 enrutado por entidad (classifyIntent)    (≈21 regex)  → LISTA GLOBAL
        10 context-policy (confirm_prior/ask_clarify/keep_prior)
         └─ si nada aplica: handled:false
     └─ decideTurn (otra vez, para la turn-policy) → n8n (gpt-4.1-mini) ──► LLM
         └─ n8n falla → error honesto (sin fallback legacy)
```
**129 puntos `return {handled:true}`** en `local-answers.ts` (2.093 líneas) = 129 formas de responder sin LLM.

## 3. Qué componente interpreta el lenguaje
- **El 80% de los turnos: código determinista** (regex + prioridad de handlers). NO ve un LLM.
- El **~20%** restante (lo que `tryLocalAnswer` no captura) llega al LLM del CRM en n8n.
- Superficie de interpretación a mano (literales regex): local-answers **242**, assistant-action-intent **161**,
  conversation-pending **81**, conversation-temporal **36**, conversation-references **35**, assistant-turn **40**,
  intent **21**, context-policy **4** ≈ **620 regex**. Es, de facto, **un parser de lenguaje natural escrito a mano.**

## 4. Porcentaje de turnos por ruta (MEDIDO)
Fuente: soak adversarial reproducible (`p71-soak-adversarial`, 1.748 turnos sintéticos con mezcla realista):
| Ruta | Turnos | % |
|---|---|---|
| Resueltos por LOCAL-FIRST (sin LLM) | 1.398 | **80.0 %** |
| Delegados a n8n / LLM | 350 | **20.0 %** |
| Excepciones | 0 | 0 % |
Latencia local p50 63 ms · p95 147 ms · p99 305 ms. **Cuatro de cada cinco turnos nunca alcanzan un modelo.**
(Advertencia honesta: el soak es sintético; el ratio en tráfico humano real puede variar, pero el orden de
magnitud —local-first dominante— es estructural, no del dataset.)

## 5. Modelo runtime real
- **Cerebro del CRM** (los turnos que llegan a n8n): nodo `OpenAI Chat Model` = **`gpt-4.1-mini`**, temperature
  **0.2**, dentro de un `@n8n/n8n-nodes-langchain.agent` (workflow «CRM Agent V2 — Read Only», 41 nodos, activo).
- **Legacy V1** (blindado, solo con flag): `OPENAI_ASSISTANT_MODEL` = `gpt-4o-mini`.
- `OPENAI_API_KEY` presente (permite construir un planner LLM propio para el prototipo).
- **Fable** (este agente de código) ≠ el runtime LLM del CRM. Son cosas distintas.

## 6. Qué VE el LLM
Solo los ~20% de mensajes que `tryLocalAnswer` no interceptó. Recibe: mensaje, `activeEntity`, `recentMessages`,
turn-policy firmado y (P71) `conversationState` reducido. Elige tools de lectura del contrato.

## 7. Qué NO ve el LLM
El 80%: conteos, listas, agenda, referencias, ordinales, continuidad temporal, acciones, automatizaciones,
onboarding, ventas, resúmenes, follow-ups. **La comprensión de la mayor parte del lenguaje la hace la regex,
no el modelo.** El LLM no puede corregir un error de interpretación que ocurre antes de que él exista en el turno.

## 8. Handlers que compiten con el LLM (routing semántico, no protocolo)
Clasificación de `tryLocalAnswer` (R3):
- **A · Fast-path determinista LEGÍTIMO**: `executeUiAction` (confirm/cancel por actionId), confirmación de
  acción/automatización con marcador vivo, cancelación explícita. Son protocolo → correcto que sean deterministas.
- **B · Routing SEMÁNTICO (sospechoso)**: `decideTurn` (meta/social/onboarding/how-it-works/hypothetical por
  keywords), `detectOfferRequest`/`detectAcceptance`/`resolveOfferedModules` (oferta→aceptación por regex sobre
  el texto previo), `handleContextualFollowup` (pronombre/elisión), `handleTemporalFollowup`, `detectIncompleteAction`,
  `parseSalesIntent`, `classifySummaryIntent`, enrutado por `classifyIntent`. **Aquí es donde el lenguaje abierto
  se interpreta a mano y compite con el modelo.**
- **C · Legacy/redundante**: `runNowLabsAgent` + fallbacks deterministas (blindado, fuera del camino por defecto).

## 9-13. Causas raíz de los fallos humanos (síntoma → mecanismo general)
| Síntoma reportado | Causa raíz (categoría) | Dónde |
|---|---|---|
| Un «sí» no continúa una oferta previa | **Oferta NO persistida como estado**: se reconstruye por regex (`OFFER_MARKER`) sobre el texto anterior; si la oferta o el «sí» no casan el patrón, se pierde | discourse-state · `resolveOfferedModules`/`detectAcceptance` |
| Explicación + dato se separan | **Router de intención ÚNICA**: `decideTurn` devuelve UN turnType; multi-goal colapsa a una rama | arquitectónico · `decideTurn` |
| Entidad recién listada no se resuelve luego | **Resolución dependiente de estado poblado por heurística**: ordinal/ref exige `resultRefs`; no todos los handlers los pueblan igual | estado/discurso · `enrichReadStateUpdate` |
| Detalle de entidad dispara listado global | **Fallback a lista global** cuando el resolver de referencia (regex) no dispara; sin comprensión de «esto es detalle scoped» | arquitectónico · `runFresh`/`classifyIntent` |
| Consulta económica → falso «problema de acceso» | **Taxonomía de error colapsada** (no-match/timeout/reader-error → mensaje genérico) **+ semántica financiera no modelada** (comisiones vs Facturación por keyword) | lectores/tools + dominio · assistant-errors · invoicing guard |
| Onboarding intercepta datos | **Detección de onboarding por keyword compite con la intención de dato**; el guard `hasConcreteDataRequest` es a su vez una heurística que puede fallar | arquitectónico · `decideTurn` |
| Fallback repite explicaciones | **Sin memoria de goals completados**: la rama conceptual se re-ejecuta | estado/discurso |
| Rutas contradictorias sobre los mismos datos | **Dos cerebros** (local-first vs n8n) con lectores/formatos independientes; sin una única interpretación | arquitectónico · route |

**Meta-causa única**: la comprensión de lenguaje abierto está **repartida en ~620 regex y 129 salidas que compiten
por prioridad**. Cada regex parece «general» en aislamiento, pero su COMPOSICIÓN es un árbol de decisión gigante
hecho a mano que no puede generalizar a fraseos no vistos — exactamente lo que predice la hipótesis del mandato.
Por eso los benchmarks construidos alrededor de capabilities conocidas pasan y el lenguaje humano impredecible rompe.

## 14. Qué fallbacks ocultan causas
- `humanError`/mensajes canned mapean múltiples fallos (no-match, timeout, reader-error, RLS) a textos genéricos
  («no he podido…», «problema de acceso») → el usuario y los logs pierden la causa real (taxonomía plana).
- `handled:false` → n8n es un fallback correcto, pero enmascara CUÁNTAS veces local-first interpretó mal antes.

## 15. Qué CONSERVAR de P71 (es bueno y seguro)
Todo el plano **determinista de CONTROL**: readers RLS (`agent-tool-readers`), plano de acciones P65
(prepare→confirm→execute→verify, idempotencia, optimistic lock), registries (action/automation), resolución de
entidad por **candidatos reales** del workspace, matemática temporal Europe/Madrid, `ConversationState` v2 +
persistencia, contrato/turn-policy n8n, invariantes de seguridad (workspace, Facturación aislada, allowlist).
**El código debe seguir controlando. La BD sigue siendo la verdad.**

## 16. Qué SACAR del camino principal (moverlo al planner)
La **interpretación de lenguaje abierto**: clasificación de turno por keywords, oferta→aceptación por regex,
follow-ups heurísticos, distinción explicación/lectura/acción por palabras, guards de onboarding, colapso a
intención única. Eso pasa a un **planner semántico** que produce un PLAN estructurado multi-goal, validado por
schema, que el código determinista ejecuta. Fast-path determinista se mantiene SOLO para protocolo (uiAction,
confirm/cancel por id).

## 17. Riesgos de evolucionar
- Latencia/coste: cada turno pasaría por un LLM (hoy el 80% no). Mitigación: fast-path de protocolo + planner
  barato/estructurado; medir p95 y coste en shadow.
- Alucinación de plan: el LLM podría pedir capabilities/entidades inexistentes. Mitigación: **validación por
  schema + policy + resolución de entidad server-side** (el plan es una PROPUESTA, no autoridad).
- Regresión de seguridad: el planner NUNCA ejecuta; el executor determinista mantiene RLS/confirm/verify/allowlist.
- Regresión funcional vs P71: por eso **shadow primero**, held-out, y gate de superioridad antes de migrar.

## 18. Arquitectura objetivo
```
mensaje + discourse-state + capability-ontology
   → GENERAL SEMANTIC PLANNER (LLM, structured output)  ── interpreta, compone goals, resuelve referencias
   → PLAN validado por schema
   → POLICY + CAPABILITY VALIDATION                      ── código controla
   → ENTITY RESOLUTION (candidatos reales, server-side)
   → DETERMINISTIC READERS / TOOLS (RLS, allowlist)      ── BD = verdad
   → EVIDENCE VALIDATION (consistency checks)
   → RESPONSE SYNTHESIS (LLM, solo con evidencia verificada)
   → CONVERSATION STATE UPDATE (goals, ofertas, referents)
```
Multi-goal de primera clase (EXPLAIN(x)+READ(x) son 2 goals compatibles, no competidores). Oferta conversacional
como estado estructurado (`offeredCapability`), no texto adivinado. Taxonomía de error estructurada
(not_found/ambiguous/empty/forbidden/timeout/unavailable/invalid/partial/conflict), nunca «problema de acceso» genérico.

## 19. Plan de migración (sin big-bang, sin producción)
1. Ontología de capabilities derivada de los registries existentes.
2. Prototipo AISLADO del planner (LLM real, reads QA, **acciones dry-run**), validado por schema.
3. Evaluación generativa black-box (≥500 conversaciones, dev/held-out separados) + human-like LLM-as-user.
4. **Shadow**: P71 vs planner sobre los mismos inputs; medir wrong-entity, global-leakage, false-clarify,
   hallucination, tool-errors, latencia, coste.
5. Gate de superioridad (§criterios) + safety intacta → feature flag `GENERAL_SEMANTIC_PLANNER` → QA → staging.
6. Nunca dos caminos escribiendo a la vez; rollback P71 disponible. **Sin producción hasta validación humana.**

## 20. Diseño del shadow evaluation
- Mismo input (conversaciones generativas + held-out + reales anonimizadas) a AMBOS caminos.
- P71 responde normal; el planner corre en **shadow** (reads QA, writes dry-run, no responde al usuario).
- Se registra por turno: plan, capability, entity resuelta, tools, correctness (juez LLM separado, no el planner),
  clarify innecesaria, latencia, coste. Métricas agregadas → `docs/GENERAL_PLANNER_SHADOW_EVAL.md`.
- Gate: el planner solo «gana» si mejora inteligencia (task-completion, continuidad, multi-goal, menos
  clarify/onboarding/fallback) **sin** empeorar ningún invariante crítico de seguridad.

## Conclusión (honesta)
La evidencia CONFIRMA la hipótesis: el asistente actual interpreta la mayoría del lenguaje con un árbol de
~620 regex / 129 salidas deterministas que compite con el LLM y no generaliza a fraseos no vistos. La vía no es
añadir más detectores, sino **mover la interpretación a un planner semántico y dejar que el código controle y la
BD diga la verdad**. Siguiente paso: prototipo aislado + shadow, sin tocar producción ni congelar nada.
