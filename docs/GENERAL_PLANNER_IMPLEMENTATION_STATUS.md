# General Semantic Planner — Implementation Status (auditado contra el código)

> Rama aislada `general-semantic-planner`. NO merge, NO producción. V1 (`v1.0.0-rc1` @ `ad3c06e`) sigue
> siendo el sistema vigente. Actualizado 2026-07-20 (sesión autónoma; sustituye la versión del 07-19 que
> tenía las filas T/U desactualizadas). Estado auditado contra ficheros y ejecución real de scripts.

| # | Pieza | Fichero | Estado | Probado |
|---|---|---|---|---|
| A | Semantic planner (LLM) | `src/lib/agents/planner/semantic-planner.ts` | IMPLEMENTED | TESTED (benchmark, e2e, metamórfico) |
| B | Plan schema/contrato | `plan-contract.ts` (+ schema en semantic-planner) | IMPLEMENTED | TESTED (security matrix 11/11; validación ÚNICA — el filtrado silencioso duplicado se eliminó 2026-07-20) |
| C | Capability ontology | `capability-ontology.ts` | IMPLEMENTED | TESTED (usada por planner+executor) |
| D | Executor general | `capability-executor.ts` | IMPLEMENTED | TESTED (e2e, security, generative; ids canónicos de módulo aceptados 2026-07-20) |
| E | Entity resolver | `entity-resolver.ts` | IMPLEMENTED | TESTED (e2e follow-up, NOT_FOUND, ordinal) |
| F | Referent resolver (pronombre/ordinal) | `entity-resolver.ts` + `discourse-state.ts` | IMPLEMENTED | TESTED (e2e turno 3; coherence T3 7/7) |
| G | Discourse state | `discourse-state.ts` | IMPLEMENTED | TESTED (+ `plannerView()`: el prompt NUNCA ve ids internos — fix causa raíz coherence, 2026-07-20) |
| H | Multi-goal (paralelo, estado por goal) | `capability-executor.ts::executePlan` | IMPLEMENTED | TESTED (multi-goal 3/3 generative) |
| I | Controlled tool loop (replan acotado) | `planner-pipeline.ts` | IMPLEMENTED (retry transitorio + REPLAN SEMÁNTICO acotado con feedback estructurado, máx. 1) | TESTED (replan observado en repro con `planAttempts=2`) |
| J | Synthesizer | `response-synthesizer.ts` | IMPLEMENTED | TESTED (e2e, grounded) — P3 abierto: auditoría dedicada de grounding ante goals fallidos |
| K | Error taxonomy única (12) | `plan-contract.ts::GoalStatus` | IMPLEMENTED | TESTED (mapReaderError + estados en evidence) |
| L | Consistency checker | `consistency-checker.ts` | IMPLEMENTED | PARTIAL (unit-integrado en pipeline; sin suite dedicada) |
| M | Financial semantics | `capability-executor.ts` (commissions.aggregate) + ontology | IMPLEMENTED | TESTED (e2e comisiones ≠ facturación) |
| N | Local-first reduction strategy | `planner-flag.ts` + route (fail-soft documentado) | PARTIAL (ver PROTOCOL_FAST_PATHS: deuda fail-soft→P71 bajo ON) | TESTED (flag matrix off/shadow/on/basura) |
| O | Evaluador generativo | `scripts/planner-generative-eval.mts` | IMPLEMENTED | TESTED (dev+held-out, N=72) |
| P | Human-like evaluator | — | MISSING | — |
| Q | Model benchmark | `scripts/planner-model-benchmark.mts` | IMPLEMENTED | TESTED (5 modelos; hard-benchmark 150-300 pendiente) |
| R | Security/mutation harness | `scripts/planner-security-matrix.mts` | IMPLEMENTED | TESTED (11/11, re-verificado post-fixes 2026-07-20) |
| S | Shadow comparison | `planner-generative-eval.mts` + `planner-shadow-eval.mts` + `planner-shadow-compare.mts` | IMPLEMENTED | TESTED (N=72 + 12 categorías + plumbing/atribución) |
| T | Feature flag en route | `planner-flag.ts` + `shadow-hook.ts` + `v2/route.ts` | **IMPLEMENTED e INTEGRADO** (commit `8819703`) | TESTED (shadow-compare: default off no-op, mapping, atribución) |
| U | Staging integration | runbook + `scripts/verify-general-planner-deploy.mjs` | **READY, BLOCKED por infra** (EasyPanel 3/3 servicios; acción manual del usuario) | Verificador ejecutado REAL contra staging vivo: sigue V1/P71 ✓ |
| V | Deploy verification | `scripts/verify-general-planner-deploy.mjs` | IMPLEMENTED (FASE 35, 2026-07-20) | TESTED (staging vivo → V1/P71 confirmado, sin secretos) |

## Suites y últimos resultados REALES (2026-07-20, post-fixes)

security matrix 11/11 · query layer 11/11 + 7/7 · mecanismos 9/9 · coherence 7/7 · crm-query 7/8 (P2
modelo) · metamórfico 22/24 (92%) · e2e smoke todo correcto + dry-run sin mutación · shadow-compare
flags/atribución OK · tsc limpio · next build OK · eslint 0 errores.

## Gates PENDIENTES para el veredicto de candidato (honesto)

human-like ≥120 (P), generative a escala 600 (coste), hard model benchmark 150-300 (Q), deploy staging
SHADOW→ON (U, bloqueado por usuario/EasyPanel), black-box staging ≥100, y la validación humana.
Ver `GENERAL_PLANNER_ARCHITECTURE_AND_EVAL.md` y `GENERAL_PLANNER_AUTONOMOUS_RUN_STATE.md`.
