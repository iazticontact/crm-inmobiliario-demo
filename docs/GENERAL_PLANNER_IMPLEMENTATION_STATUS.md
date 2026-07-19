# General Semantic Planner — Implementation Status (auditado contra el código)

> Rama aislada `general-semantic-planner`. NO cableado a la route productiva, NO merge, NO producción.
> V1 (`v1.0.0-rc1` @ `ad3c06e`) sigue siendo el sistema vigente. Fecha 2026-07-19.
> Estado auditado contra ficheros y ejecución real de scripts (no solo documentación).

| # | Pieza | Fichero | Estado | Probado |
|---|---|---|---|---|
| A | Semantic planner (LLM) | `src/lib/agents/planner/semantic-planner.ts` | IMPLEMENTED | TESTED (benchmark, e2e, metamórfico) |
| B | Plan schema/contrato | `plan-contract.ts` (+ schema en semantic-planner) | IMPLEMENTED | TESTED (security matrix 11/11) |
| C | Capability ontology | `capability-ontology.ts` | IMPLEMENTED | TESTED (usada por planner+executor) |
| D | Executor general | `capability-executor.ts` | IMPLEMENTED | TESTED (e2e, security, generative) |
| E | Entity resolver | `entity-resolver.ts` | IMPLEMENTED | TESTED (e2e follow-up, NOT_FOUND, ordinal) |
| F | Referent resolver (pronombre/ordinal) | `entity-resolver.ts` + `discourse-state.ts` | IMPLEMENTED | TESTED (e2e turno 3) |
| G | Discourse state | `discourse-state.ts` | IMPLEMENTED | TESTED (referente persistido) |
| H | Multi-goal (paralelo, estado por goal) | `capability-executor.ts::executePlan` | IMPLEMENTED | TESTED (multi-goal 3/3 generative) |
| I | Controlled tool loop (replan acotado) | `planner-pipeline.ts` | IMPLEMENTED (retry acotado; replan-LLM = hook) | PARTIAL (retry transitorio testeado; replan semántico no ejercitado) |
| J | Synthesizer | `response-synthesizer.ts` | IMPLEMENTED | TESTED (e2e, grounded) |
| K | Error taxonomy única (12) | `plan-contract.ts::GoalStatus` | IMPLEMENTED | TESTED (mapReaderError + estados en evidence) |
| L | Consistency checker | `consistency-checker.ts` | IMPLEMENTED | PARTIAL (unit-integrado en pipeline; sin suite dedicada) |
| M | Financial semantics | `capability-executor.ts` (commissions.aggregate) + ontology | IMPLEMENTED | TESTED (e2e comisiones ≠ facturación) |
| N | Local-first reduction strategy | `planner-flag.ts` (contrato) | PARTIAL (diseño + flag; sin retirada real de regex) | UNTESTED en integración |
| O | Evaluador generativo | `scripts/planner-generative-eval.mts` | IMPLEMENTED | TESTED (dev+held-out, N=72) |
| P | Human-like evaluator | — | MISSING | — |
| Q | Model benchmark | `scripts/planner-model-benchmark.mts` | IMPLEMENTED | TESTED (5 modelos) |
| R | Security/mutation harness | `scripts/planner-security-matrix.mts` | IMPLEMENTED | TESTED (11/11) |
| S | Shadow comparison | `scripts/planner-generative-eval.mts` (P71 vs planner) + `planner-shadow-eval.mts` | IMPLEMENTED | TESTED (N=72 + 12 categorías) |
| T | Feature flag | `planner-flag.ts` | IMPLEMENTED (helper aislado) | UNTESTED (no integrado en route) |
| U | Staging integration | — | MISSING (por diseño: no se toca producción/auto-deploy) | — |

## Gates cumplidos vs. pendientes (honesto)
CUMPLIDO: pipeline completo aislado; security 11/11; generative dev/held-out con superioridad y 0
violaciones críticas; benchmark de modelos; metamórfico 96%. PENDIENTE para el veredicto de candidato:
human-like ≥120, generative a escala 600, black-box staging ≥100, integración feature-flag en route,
deploy staging, y por tanto la validación humana. Ver `GENERAL_PLANNER_ARCHITECTURE_AND_EVAL.md`.
