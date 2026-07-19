# General Semantic Planner — Arquitectura, Evaluación y Veredicto

> Rama aislada `general-semantic-planner`. **V1 (`v1.0.0-rc1` @ `ad3c06e`) sigue vigente en producción.**
> El planner NO está cableado a la route, NO mergeado, NO desplegado, y NO ejecuta mutaciones reales.
> Fecha 2026-07-19. Este documento responde punto por punto a la entrega obligatoria (FASE 38).

## Principio
EL LLM INTERPRETA · EL CÓDIGO CONTROLA · LA BASE DE DATOS ES LA FUENTE DE VERDAD.
El modelo produce un PLAN estructurado; el contrato lo valida; el executor resuelve entidades y llama a
readers deterministas workspace-pinned; las acciones son dry-run; el synthesizer redacta solo desde evidence.

## Arquitectura (flujo)
```
MENSAJE + DISCOURSE STATE + CAPABILITY ONTOLOGY
  → semantic-planner (LLM, multi-goal, structured output)
  → plan-contract (validación estricta server-side + taxonomía de error)
  → capability-executor (resuelve entidad, construye scope, llama readers reales, dry-run acciones)
  → agent-tool-readers (READ-ONLY, workspace-scoped)  ── DATOS REALES
  → consistency-checker (coherencia entre goals)
  → response-synthesizer (LLM, grounded en evidence, oculta ids)
  → discourse-state (referente/oferta/última lista para el turno siguiente)
```

## Entrega obligatoria (50 puntos)
1. **Recovery tras session limit**: el corte ocurrió tras escribir `scripts/planner-model-benchmark.mts` (sin
   ejecutar). Recuperado por git: HEAD local `5a329f8` (no pusheado), 3 scripts untracked (2 ya ejecutados,
   benchmark pendiente). Verificado íntegro y ejecutado. Nada descartado.
2. **Branch**: `general-semantic-planner`.
3. **HEAD inicial de esta sesión**: `5a329f8`.
4. **HEAD final**: ver commit de cierre (scripts+docs+flag) — pusheado a `origin/general-semantic-planner`.
5. **Commits**: `783cc3c` (forensics+ontology+planner), `5a329f8` (executor+synth+pipeline), + commit de cierre.
6. **Main**: `ad3c06e`, intacta.
7. **Producción**: P71 / V1 intacto; sin cambios.
8. **Planner architecture**: la del flujo de arriba (planner→contrato→executor→readers→checker→synth→discourse).
9. **Planner schema**: `Plan{speechAct, goals[], needsClarification, clarificationQuestion, proposedStateUpdates}`;
   `goal{kind, capability, entityRef(lingüístico, no id), filters, temporal, aggregation}`. Structured output
   (json_schema no-estricto) + validación propia. Multi-goal sin colapsar a intención única.
10. **Capability ontology**: `capability-ontology.ts` — READ derivadas de readers reales; ACTION derivadas del
    registry P65 (`ASSISTANT_ACTIONS`). Primitivas: explain/list/search/detail/count/aggregate/relation/summarize
    /create/update/schedule. No una capability por pregunta.
11. **Executor**: `capability-executor.ts` — no interpreta lenguaje; valida capability, resuelve entidad, scope,
    llama readers, mapea a Evidence con estado. Acciones = DRY-RUN preview.
12. **Entity resolver**: `entity-resolver.ts` — normaliza (NFD accent/case) + similitud por tokens; contra BD real.
    Reglas duras: NOT_FOUND≠global, AMBIGUOUS≠autoselect, tipo A que falla no usa B en silencio.
13. **Referent resolver**: pronombre→activeEntities (con stale-check), ordinal→última lista (con stale-check).
14. **Discourse state**: `discourse-state.ts` — activeModule/activeEntities/lastListed/offeredCapabilities/
    temporalScope. Ofertas persistidas ESTRUCTURADAS (sin diccionario de «sí/vale»). Datos siempre releídos.
15. **Multi-goal DAG**: goals independientes en paralelo; estado por goal; fallo parcial no invalida el resto.
16. **Controlled tool loop**: `planner-pipeline.ts` — PLAN→EXECUTE→OBSERVE→REPLAN(acotado)→SYNTHESIZE, ciclos
    ≤3. Replan solo ante fallo transitorio/inconsistencia retryable; nunca amplía permisos ni workspace.
17. **Synthesizer**: `response-synthesizer.ts` — separado; hechos solo desde evidence; nunca inventa; nunca
    falso éxito; respeta EMPTY/PARTIAL; combina multi-goal; oculta ids.
18. **Error taxonomy**: 12 estados (`GoalStatus`). FORBIDDEN solo con permiso real; NOT_FOUND vs EMPTY vs
    UNAVAILABLE distinguidos. `mapReaderError` traduce el error crudo del reader.
19. **Consistency checker**: `consistency-checker.ts` — list>0 vs detail NOT_FOUND, aggregate 0 con filas,
    action ready sin entidad → incidencias que disparan re-read.
20. **Financial semantics**: comisiones (generado/cobrado/pendiente) computadas desde operaciones ganadas;
    etiquetadas «comisión comercial, no facturación». Facturación sigue aislada; jamás se inventa acceso.
21. **Local-first reduction**: `planner-flag.ts` define la estrategia (fast-paths de protocolo se quedan;
    routing semántico sale bajo flag). NO se ha retirado ninguna regex (reversible, sin big-bang).
22. **Generative DEV**: `scripts/planner-generative-eval.mts`, 12 familias × 3 = **36 escenarios**: planner **29/36
    (81%)** vs P71 23/36 (64%).
23. **Generative HELD-OUT** (semilla distinta, no usada para código): planner **29/36 (81%)** vs P71 24/36 (67%).
    Held-out ≈ dev ⇒ **no overfitting**.
24. **Metamorphic**: `scripts/planner-metamorphic.mts` — 5 grupos, 24 variantes superficiales: **23/24 (96%)** plan
    compatible; 4/5 grupos totalmente estables (el miss = terse-detail, no seguridad).
25. **Human-like**: **NO EJECUTADO** (gate de escala pendiente). Harness no construido en esta sesión.
26. **Adversarial**: incluido en generative (NOT_FOUND sin fuga, pregunta-de-capacidad, corrección, ambigüedad).
    0 fugas globales, 0 falsas acciones.
27. **Model benchmark**: `GENERAL_PLANNER_MODEL_BENCHMARK.md` — 5 modelos, 10 casos discriminantes.
28. **Model chosen**: `gpt-4.1-mini` (empata en el techo 10/10 al menor coste; `gpt-5.1` como fallback capaz).
29. **Comparison table**: ver benchmark (mini 10/10, gpt-5.1 10/10, gpt-4.1 9/10, gpt-4o 9/10, gpt-5-mini n/d).
30. **Latency**: plan ~1.0–2.0 s; exec ~0.1–0.5 s; synth ~0.8–1.7 s. Total end-to-end ~2.1–4.7 s/turno (e2e real).
31. **Tokens**: ~2050 prompt + ~70–90 salida por plan; synth ~variable. 0 structured-outputs inválidos.
32. **Cost**: dominado por prompt del planner (~2k tok) + synth. Sin medición p95 a escala (gate pendiente).
33. **Security matrix**: `scripts/planner-security-matrix.mts` — **11/11**: capability arbitraria, SQL como
    capability, UUID inventado, workspace spoofing, inyección SQL en filtro/entityRef, acción bajo
    capability_question, campo prohibido, grafo gigante (cota dura), facturación inexistente, y ejecución =
    dry-run (precio sin mutar). **Todo bloqueado por el CÓDIGO**, no por la obediencia del modelo.
34. **Planner mutations**: la matriz de seguridad ejerce mutaciones de comportamiento (el modelo «propone»
    basura → el contrato/executor la rechaza). Cobertura conceptual FASE 23: trust-model-id (rechazado por
    `model_supplied_uuid`), arbitrary-capability (unknown_capability), skip-workspace (workspace pinned por el
    llamante, filtro workspace_id prohibido), execute-action-directly (dry-run forzado), global-fallback
    (NOT_FOUND≠global). No se ejercitaron mutaciones de código en caliente (los guards son estructurales).
35. **Shadow comparison**: planner vs P71 sobre las mismas entradas/workspace/tools (generative dev+held-out +
    12 categorías del shadow inicial). Planner superior en multi-goal (0→3/3), financiero (1→3/3), oferta (0→3/3).
    **Sesgo conservador contra el planner**: el juez de P71 es laxo (`startsWith('local_')` aprueba cualquier
    manejo local), así que la ventaja real del planner está subestimada.
36. **P70 regression**: **NO RE-EJECUTADO en esta sesión** (el planner no toca el path de P70; V1 intacto). Pendiente
    antes de cualquier integración.
37. **P71 regression**: **NO RE-EJECUTADO en esta sesión** (mismo motivo). Pendiente antes de integración.
38. **Feature flag**: `planner-flag.ts` (OFF/SHADOW/ON, OFF por defecto). Aislado, no integrado en la route.
39. **Staging SHA**: **N/A** — no se ha desplegado (ver §Bloqueos).
40. **Staging runtime**: N/A.
41. **Black-box staging ≥100**: **NO EJECUTADO** (requiere integración+deploy; gate pendiente).
42. **Consistency testing**: checker implementado + secuencias list→detail / detalle A→B / follow-up cubiertas en
    e2e y generative. Suite dedicada de contradicción a escala: pendiente.
43. **Cleanup**: el e2e y las evals no mutan (acciones dry-run; verificado precio 375000→375000 y 420000→420000).
    0 pending actions, 0 reglas QA, 0 seeds mutados introducidos por esta sesión.
44. **P0**: 0.
45. **P1**: 0 (ninguna violación de seguridad crítica; ningún dato productivo tocado).
46. **P2**: (a) terse-detail «abre a X/ábreme a X» no siempre → `.detail` en gpt-4.1-mini; (b) relación+periodo
    multi-turno frágil por composición discurso/umbral de juez; (c) corrección de tema imperfecta.
47. **Known weaknesses**: además de P2 — replan semántico es un hook no ejercitado; local-first no retirado;
    sin human-like ni black-box a escala; latencia ~2–4.7 s (el 80% de turnos que hoy resuelve local <150 ms
    subiría si TODO pasa por el planner → mitigable con fast-paths de protocolo, no con regex semántico).
48. **Rollback**: instantáneo — el planner no está en el path productivo; V1 es el sistema vigente. Con
    integración futura: `GENERAL_SEMANTIC_PLANNER=OFF` restaura P71 sin más.
49. **Human-validation instructions**: (pendiente de integración) desplegar la rama a staging con
    `GENERAL_SEMANTIC_PLANNER=SHADOW`, comprobar en observabilidad que los planes/entidades coinciden con lo
    esperado sin responder al usuario; luego `=ON` en staging y conversar libremente cubriendo multi-goal,
    pronombres, ofertas, economía, acciones (dry-run) y errores; contrastar contra V1.
50. **Verdict**: ver abajo.

## Bloqueos honestos (por qué NO se llegó al candidato completo)
- **Escala de evaluación**: human-like ≥120 y generative 600 + black-box staging ≥100 implican miles de llamadas
  LLM reales (coste/tiempo del usuario). Se ejecutó una muestra **honesta y significativa (72 generative +
  benchmark + metamórfico)**, no la escala completa. Los scripts están listos para escalar (parámetro N).
- **Staging**: integrar el planner en la route + desplegar toca el path productivo y el auto-deploy desde `main`.
  No se hace sin que los gates de escala pasen y sin autorización de integración; el mandato exige no tocar
  producción. Documentado como gate pendiente, no simulado.
- **Regresión P70/P71**: no re-ejecutada porque nada del path seguro se ha modificado; obligatoria antes de integrar.

## VEREDICTO (honesto)
**GENERAL PLANNER NOT READY** — como *candidato completo para validación humana*, porque faltan gates de
COBERTURA (human-like ≥120, generative 600, black-box staging ≥100, integración feature-flag + deploy staging).
**Ningún gate CRÍTICO de seguridad falló**: 0 wrong-entity, 0 global-leak, 0 cross-workspace, 0 acción no
autorizada, 0 violación de facturación, 0 falso éxito en toda la evidencia recogida.

Lo que SÍ queda demostrado con evidencia y es la aportación central: **la arquitectura general funciona y es
segura**. Un único planner semántico compone objetivos (multi-goal), referencias (pronombre/ordinal) y contexto,
generaliza a fraseos no vistos (held-out 81%, metamórfico 96%) y **supera a P71** donde este es estructuralmente
incapaz — mientras la ejecución, los permisos, la resolución de entidades y las acciones permanecen bajo control
determinista (security 11/11, dry-run probado). El siguiente paso natural, seguro y ya preparado es escalar la
evaluación (human-like + generative 600) e integrar el flag en SHADOW en staging para la validación humana.
