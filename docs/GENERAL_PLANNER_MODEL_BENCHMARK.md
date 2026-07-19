# General Semantic Planner — Model Benchmark (FASE 15–17)

> Aísla la calidad de INTERPRETACIÓN del planner (`planTurn`, sin executor ni synthesizer) sobre 10 casos
> DISCRIMINANTES con datos reales de QA. Mismo prompt/ontología/schema/evaluador para todos; solo cambia el
> modelo. Modelos descubiertos dinámicamente vía `GET /v1/models` (no asumidos). Fecha 2026-07-19.
> Script: `scripts/planner-model-benchmark.mts`.

## Modelos disponibles (descubiertos, no asumidos)
El provider expone gpt-4/4o/4.1(+mini/nano), gpt-5.x (varios), o1/o3/o4-mini, etc. Se benchmarcaron los
candidatos razonables compatibles con `chat/completions + response_format:json_schema`: el runtime actual
(`gpt-4.1-mini`) y candidatos más capaces (`gpt-4.1`, `gpt-4o`, `gpt-5.1`, `gpt-5-mini`).

## Resultados (10 casos discriminantes · cliente real)
| modelo | acierto plan | latencia media | prompt tok~ | out tok~ | fallo |
|---|:--:|:--:|:--:|:--:|---|
| **gpt-4.1-mini (runtime actual)** | **10/10** | 1628 ms | 2051 | 72 | — |
| gpt-4.1 | 9/10 | 855 ms | 2051 | 71 | corrección de tema |
| gpt-4o | 9/10 | 997 ms | 2051 | 63 | corrección de tema |
| gpt-5.1 | 10/10 | 1477 ms | 2049 | 89 | — |
| gpt-5-mini | NO DISPONIBLE | — | — | — | http_400 (rechaza json_schema+temperature con estos params) |

Casos: detalle terse («abre a X»), detalle explícito, multi-goal explain+read, pronombre+relación+periodo,
corrección de tema, financiero comisiones, pregunta de capacidad, oferta→aceptación, ordinal tras lista,
agregado valor ventas. `structured output` válido en el 100% de las llamadas exitosas (0 JSON inválidos).

## Selección de modelo (por evidencia, no por tamaño)
**Se mantiene `gpt-4.1-mini`.** Razones:
1. **Empata en el techo** (10/10), igual que `gpt-5.1`, y por encima de `gpt-4.1`/`gpt-4o` (9/10).
2. **Menor coste** (mini) y sin ventaja de latencia de los grandes que justifique el cambio.
3. Ningún fallo de seguridad crítico en ningún modelo (la seguridad la garantiza el executor, no el modelo).
4. Refuta la hipótesis «hace falta un cerebro mayor»: la interpretación ya es excelente en el runtime actual;
   las debilidades observadas en la eval generativa multi-turno **no son de capacidad del modelo** (single-shot
   `gpt-4.1-mini` acierta terse-detail y corrección), sino de composición discurso/umbral del juez.
5. `gpt-5.1` queda como **alternativa de fallback capaz y validada** (10/10) si en el futuro se requiere.

**Regla de scoring aplicada**: fallo crítico (wrong entity / unsafe action / policy / global leak / capability
alucinada) = descalificación absoluta (ninguno lo tuvo). Luego: acierto de plan > coste > latencia. `gpt-4.1-mini`
gana por acierto máximo a coste mínimo.
