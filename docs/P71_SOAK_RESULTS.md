# P71 — Resultados del soak test adversarial

> `scripts/p71-soak-adversarial.mts` · seed `p71-soak-2026-07-18` (reproducible) · contra staging p71-rc.
> No toca datos productivos: acciones/automatizaciones siempre canceladas/descartadas; epílogo limpia BD.

## Volumen
- **30 conversaciones** de 30-80 turnos (longitud por seed) + 1 ronda **interleave de 3 hilos** (33 turnos)
  + 1 ronda **workspace ajeno** (20 turnos).
- **1748 turnos** ejecutados en ~1.8 min.
- Clases mezcladas por peso: saludos, lecturas, referencias/posesivos, ordinales, superlativos, continuidad
  temporal, cambios de módulo, retornos, correcciones, typos, mensajes irrelevantes, preguntas de capacidad,
  acciones incompletas (canceladas), previews de automatización (descartadas), afirmaciones/negaciones.
- **Inyección deliberada cada 5-10 turnos**: cambio de módulo, referente antiguo, corrección de entidad,
  cambio de periodo, pregunta no relacionada.

## Invariantes verificados EN CADA turno
- sin excepciones (cero); higiene (cero UUID/secretos/stacks/x-nowcrm en la respuesta);
- cero «aplicado y verificado» y cero «activada y programada» (el soak es read-only);
- estado ACOTADO: activeEntities ≤ 8, previousEntities ≤ 8, referents ≤ 12, resultRefs ≤ 25 (sin fuga de memoria);
- scoped ⇒ la respuesta se refiere a ESA entidad (cero wrong-entity);
- workspace ajeno ⇒ cero filas de datos y cero nombres del demo no solicitados.

## Métricas
| Métrica | Valor |
|---|---|
| Turnos | 1748 |
| Manejados localmente | 1398 (80.0%) |
| Delegados a n8n (correcto) | 350 |
| **Excepciones** | **0** |
| **Violaciones de invariante** | **0** |
| Latencia local p50 | 63 ms |
| Latencia local p95 | 147 ms |
| Latencia local p99 | 305 ms |
| Crecimiento de estado | acotado (nunca superó los límites) |
| pendingIntent residual al cerrar | 0 |
| BD tras el soak | 0 acciones vivas · 0 reglas creadas · 0 precios centinela |

## Nota de honestidad (falso positivo corregido durante el desarrollo)
La primera ejecución marcó 2 «CROSS-WS» en la ronda de workspace ajeno: eran ECO del término buscado
(«No encuentro ningún cliente que coincida con «X»»), no fuga de datos — el workspace ajeno tiene 0
clientes/0 inmuebles (verificado en BD). Se ajustó la aserción del test para medir la fuga REAL (filas de
datos devueltas o nombres del demo NO presentes en la pregunta). Tras el ajuste: **0 violaciones**.

## Veredicto
Sin memory leak, sin degradación con conversaciones largas, sin contaminación progresiva de estado, sin
errores acumulativos. **SOAK: TODO PASS.**
