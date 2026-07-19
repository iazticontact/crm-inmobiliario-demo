# General Planner — Human-like Conversation Harness (FASE 41) — resultados REALES

> Harness: `scripts/planner-humanlike.mts`. Simulador de usuario LLM con persona + misión ABSTRACTA
> (sin conocer capabilities/implementación/frases esperadas) contra el pipeline real (QA, dry-run).
> Juez doble: métricas estructurales deterministas + juez LLM separado (transcript + evidencia resumida).
> **N acotado honesto: 4 conversaciones** (novato, seco, erratas, indeciso), máx. 7 turnos.
> El gate del veredicto sigue siendo 120+; esto es el harness funcionando + primera señal.

## Run 2 (2026-07-20, tras fix [FIN] + valores canónicos de filtro)

| Persona | Turnos | Rejected | InternalErr | Replans | Clarif. | Coherencia | Grounding | Continuidad |
|---|---|---|---|---|---|---|---|---|
| novato | 7 | 0 | 0 | 0 | 0 | 4 | 5 | 4 |
| seco | 3 | 0 | 0 | 0 | 0 | 5 | 5 | 5 |
| erratas | 5 | 0 | 0 | 0 | 0 | 4 | 4 | 4 |
| indeciso | 7 | 0 | 0 | 0 | 3 | 5 | 5 | 5 |
| **Media** | — | **0** | **0** | — | — | **4.5/5** | **4.8/5** | **4.5/5** |

Errores duros (INTERNAL_ERROR + respuestas vacías): **0**.

## Run 1 (mismo día, antes de los fixes) — para comparación honesta

coherencia 4.3 · grounding 4.3 · continuidad 4.5 · errores duros 0. Defectos del run 1 que motivaron
fixes: (a) bug de harness `[FIN]` pegado a un mensaje no cortaba la conversación; (b) «clientes
activos» → EMPTY falso por valores de filtro en lenguaje de usuario (mecanismo corregido: valores
canónicos declarados en la ontología, ver ANTI_OVERFIT_AUDIT y el commit correspondiente).

## Observaciones abiertas (clase, no frase)

- P3 · consistencia inter-turno: misma petición («tareas pendientes») puede dar SUCCESS y luego EMPTY si
  el plan varía el scope temporal/filtros entre turnos. Clase para el consistency-checker (FASE 30)
  a nivel de CONVERSACIÓN (hoy es intra-turno).
- El juez LLM es gpt-4.1-mini (mismo modelo que el planner); para el gate formal usar juez distinto
  (JUDGE_MODEL env ya soportado).

## Escalado pendiente (coste)

120+ conversaciones ≈ 120 × ~18 llamadas ≈ ~2.200 llamadas gpt-4.1-mini (plan+synth+sim+juez).
Estimación de coste bajo (pocos €), pero se deja como decisión explícita de gasto. El harness está listo:
`npx tsx --tsconfig tsconfig.json scripts/planner-humanlike.mts [maxTurnos]`.
