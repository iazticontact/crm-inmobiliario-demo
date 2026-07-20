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

---

# HARD BENCHMARK (FASE 46, 2026-07-20) — SUPERSEDE la conclusión anterior

> El 10/10 de arriba era un SMOKE: en casos genuinamente difíciles el techo desaparece. 12 casos
> (`scripts/planner-model-hard-benchmark.mts`): P2 (relation+aggregate de entidad nombrada) ×3 fraseos,
> 3-goals, retorno de referente tras cambio de tema, corrección sobre oferta, top-N filtrado, ambigüedad
> financiera, introspección sobre entidad, no-overuse, valores canónicos, avg→crm.query. Ejecutado TRAS
> el fix de mecanismo del pivote (con el fix, la infraestructura ya soporta la composición; lo que se mide
> es la ELECCIÓN del modelo).

| Modelo | Acierto | Lat. media | Tokens out ~ | Fallos restantes |
|---|:--:|:--:|:--:|---|
| **gpt-5.1** | **11/12** | 1.9s | 125 | P2 fraseo B (muy oblicuo: «cuánto mueve X con nosotros») |
| gpt-4.1-mini (runtime) | 9/12 | 2.1s | 98 | P2 A, P2 B, retorno de referente |
| gpt-4.1 | 8/12 | 1.4s | 95 | P2 A/B/pronombre (+1 caso invalidado por 429) |
| gpt-5-mini | NO CANDIDATO | — | — | Rechaza el contrato de llamada del runtime (http_400) |

## Hallazgo clave (el P2 NO era solo «límite de modelo»)

El debug de planes reales mostró que gpt-5.1 YA emitía la intención correcta con la forma natural
`{entity: operaciones, operation: aggregate, entityRef: <cliente>}` que el schema no aceptaba — y que el
layer IGNORABA el entityRef en operaciones no-relacionales (riesgo de agregar TODO el workspace en
silencio). Tras el fix (pivote por grafo registrado + tokens canónicos de campo + prohibición de
scope-broadening), gpt-5.1 pasa la clase P2; gpt-4.1-mini sigue emitiendo `clients.search` (limitación
real del mini en composición). La clase metamórfica «detalle de cliente» (2-3/5 en mini) es la misma
familia.

## Recomendación PRELIMINAR (el gate formal 150-300 sigue pendiente)

- **Candidato a upgrade del planner: `gpt-5.1`** — resuelve la clase de composición más difícil y el
  retorno de referente con latencia ≈ mini (1.9s vs 2.1s) y salida corta (~125 tokens).
- Híbrido a evaluar: **planner gpt-5.1 + synthesizer gpt-4.1-mini** (el synth solo redacta evidencia validada).
- Config razonable YA (FASE 9): `PLANNER_FALLBACK_MODEL=gpt-4.1-mini` como alternativo de infra.
- gpt-4.1 NO aporta sobre mini en esta clase (8/12) — descartado.
- **NO cambiar el modelo del runtime** hasta el dataset difícil 150+ por modelo con métricas FASE 37
  completas (incluido coste) y regresión completa en verde. N=12 es señal direccional, no decisión.
