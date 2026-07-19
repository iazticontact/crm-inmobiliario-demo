# General Semantic Planner — Mecanismos generales frente a la evidencia humana

> Rama aislada `general-semantic-planner`. La evidencia humana reciente proviene del sistema **VIGENTE =
> P71/legacy**: la route activa (`src/app/api/assistant/v2/route.ts:390`) llama a `tryLocalAnswer`; el
> General Planner **NO está cableado**. Por tanto esos fallos son de P71, no del planner nuevo.
> Aquí NO se parchean frases: cada síntoma se convierte en un MECANISMO GENERAL. Fecha 2026-07-19.

## Clasificación (síntoma → mecanismo general → implementación)
| # | Clase de fallo (abstracta) | Mecanismo general | Dónde |
|---|---|---|---|
| 1 | Cardinality/selection: pedir UNA instancia devuelve TODO el conjunto | `selection` (all/one/first/last/random/top/bottom/n/matching) + `requestedOutput` como DATO del plan; el executor reduce el dataset autorizado (RANDOM seedable) | schema+prompt `semantic-planner.ts`; `capability-executor.ts::applySelection` |
| 2/8 | Capability introspection / capability truth | capability `capabilities.introspect` cuya respuesta se DERIVA de los registries (ontología + acciones + campos), nunca de texto manual | `capability-ontology.ts::introspectCapabilities`; executor case |
| 3/7 | Speech-act vs domain target: preguntar por capacidad SOBRE X se volvía SEARCH(X) | principio ACTO vs OBJETIVO en el prompt + invariante en el contrato: bajo `capability_question`, `explain.module`→`capabilities.introspect`; nunca search | `semantic-planner.ts` prompt; `plan-contract.ts` |
| 4/5/6 | Discourse focus / stale intent / supersession | reducer de discurso: un cambio explícito de módulo retira los referentes STALE incompatibles y CONSERVA los compatibles/recién resueltos | `discourse-state.ts::advanceDiscourse` (MODULE_ENTITY supersession) |
| 9 | Error truth | taxonomía única de 12 estados; FORBIDDEN solo con permiso real; NOT_FOUND≠routing≠timeout | `plan-contract.ts::GoalStatus` (ya existente) |
| 10 | Cross-turn coherence | `consistency-checker.ts` + discourse persistido + observabilidad por turno | ya existente + reforzado |
| — | Atribución de arquitectura | observabilidad `assistantArchitecture: GENERAL_PLANNER` + `featureFlagState` en cada turno | `planner-pipeline.ts` |

## Evidencia (fraseos NO vistos, datos reales de QA) — `scripts/planner-new-mechanisms.mts`
```
✓ selection: un cliente al azar → 1, no la lista   (clients.list[sel=random/out=detail] count=1)
✓ selection: un piso al azar → 1
✓ selection: "un par" → 2                          (n/2)
✓ selection: "en total" NO reduce (all)            (count=9)
✓ introspección global → read[] y write[] del registro  (read=20, write=21 derivados)
✓ introspección por módulo (cartera) → acciones portfolio.*
✓ capacidad sobre entidad → introspect, NO search
✓ «¿puedes cambiarle el teléfono?» → introspect, sin preparar acción
✓ cambio de foco a cartera retira cliente stale    (module=portfolio, entities=∅)
→ MECANISMOS: 9/9
```
Regresión: security matrix **11/11** (sin agujeros; acción sigue dry-run), generative dev/held-out **~83%
vs P71 ~67-71%**, **0 violaciones críticas** (wrong_entity/global_leak/false_action). `tsc` del planner limpio.

## Defectos hallados y corregidos DE FORMA GENERAL en esta sesión (no por frase)
1. El planner elegía `clients.detail` para «un cliente al azar» → aclarado en el prompt: `.detail` exige
   entidad IDENTIFICADA; una instancia no identificada usa `.list`+`selection`.
2. Bug propio del contrato: `normalizeExplainCapability` reescribía CUALQUIER goal explain a `explain.module`,
   pisando `capabilities.introspect` → exención añadida.
3. El planner confundía «qué puedes hacer» con `explain.module` → invariante de acto en el contrato
   (`capability_question` + `explain.module` → `capabilities.introspect`) + contraste explícito en el prompt.

## Lo que sigue pendiente (honesto)
Integración del flag en la route + deploy a staging + eval a escala (600 generativas, 120 human-like, 100
black-box) + regresión P70/P71. Sin eso NO hay veredicto de candidato. Producción intacta (P71 vigente).
