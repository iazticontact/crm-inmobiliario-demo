# General Semantic Planner — Shadow evaluation (prototipo)

> Comparación P71 (regex/handlers) vs GENERAL SEMANTIC PLANNER (LLM `gpt-4.1-mini`, el cerebro real del CRM)
> sobre CATEGORÍAS ABSTRACTAS de los síntomas reportados, con fraseos **no usados** para construir ninguno de
> los dos sistemas y módulos/entidades variados. Juez = **propiedad semántica estructural** (no texto exacto).
> Rama aislada `general-semantic-planner`. NO se toca producción; el planner NO ejecuta (reads QA, dry-run).
> Fecha 2026-07-18. **Escala: prototipo (12 categorías).** No es la evaluación completa (ver §Limitaciones).

## Resultado
| Categoría (fraseo NUEVO) | P71 | PLANNER | P71 tool / Planner capabilities |
|---|:--:|:--:|---|
| multi-goal explain+read (operaciones) | ✗ | ✓ | `local_turn:module` / explain.module + operations.list |
| multi-goal explain+read (cartera) | ✗ | ✓ | `local_turn:module` / portfolio.list + portfolio.list |
| oferta→aceptación («venga sí, enséñamelas») | ✓ | ✓ | local_operations / operations.list |
| oferta→aceptación otra capability («sí porfa») | ✓ | ✓ | local_agenda / tasks.list |
| pregunta de capacidad («¿se pueden cambiar…?») | ✓ | ✓ | UNHANDLED→n8n / capability_question |
| detalle scoped, no global | ✓ | ✓ | local_client_detail / clients.detail |
| **financiero ≠ acceso denegado** | ✗ | ✓ | UNHANDLED→n8n / commissions.aggregate |
| onboarding + dato | ✓ | ✓ | local_agenda / calendar.list |
| pronombre + relación + periodo | ✓ | ✓ | local_client_events / clients.relation.events |
| ordinal tras lista | ✓ | ✓ | local_client_detail / clients.detail |
| corrección de tema | ✓ | ✓ | local_turn:correction / operations.list |
| agregado temporal ventas | ✓ | ✓ | local_sales / operations.aggregate.value |

**P71: 9/12 · PLANNER: 12/12.**

## Dónde gana el planner (y por qué es arquitectónico)
- **Multi-goal (2/2)**: «explícame X **y de paso** dime cuántos» → P71 devuelve UN solo turnType
  (`local_turn:module`, la explicación) y **descarta la lectura**. El planner emite **≥2 goals** (explain + read)
  porque el router de intención única de P71 es estructuralmente incapaz de componer objetivos. Confirma la
  causa raíz #2 del failure analysis.
- **Financiero (1/1)**: «¿cuánto llevo generado en comisiones este mes?» → P71 delega a n8n (y ahí aparece el
  falso «problema de acceso» reportado). El planner selecciona `commissions.aggregate` con la semántica correcta
  (comisiones ≠ Facturación). Confirma la causa raíz #5 (taxonomía de error + semántica financiera).

## Imperfecciones HONESTAS del planner (no cherry-pick)
El planner interpreta bien, pero **propone** de forma imperfecta; por eso el ejecutor determinista DEBE gatear:
1. **Pregunta de capacidad**: el planner marcó `speechAct=capability_question` **pero incluyó** un goal
   `portfolio.update_price`. La propiedad se cumplió porque el `kind` no fue `action`, pero un ejecutor ingenuo
   podría intentar ejecutarlo. **Regla de ejecución obligatoria**: con `speechAct=capability_question` NUNCA se
   ejecuta ni se prepara nada — se explica la capacidad. (El modelo propone; el código controla.)
2. **Multi-goal cartera**: eligió `portfolio.list` también para el slot de explicación en vez de `explain.module`.
   Módulos correctos, capability de explicación mal etiquetada. El validador debe normalizar explain→explain.module.
3. **Corrección de tema**: devolvió `operations.list` sin fijar `stage=won` para «ganadas». Familia correcta,
   filtro incompleto — mejorable con un ejemplo de filtro en el prompt (no una regla por frase).

Estas imperfecciones **refuerzan** la tesis: el LLM aporta comprensión general; la **validación de plan + policy +
resolución de entidad server-side + gating por speechAct** aporta el control. Un planner sin ejecutor determinista
NO sería seguro; un ejecutor sin planner NO generaliza. La arquitectura objetivo necesita AMBOS.

## Coste / latencia (medido)
- gpt-4.1-mini, temperature 0.1, structured output (json_schema no-estricto + validación propia).
- ~2.000 tokens de prompt (ontología incluida) + ~100 de salida por turno · latencia ~1.7-2.0 s/turno.
- Implicación: pasar el 100% de turnos por el planner subiría la latencia media (hoy el 80% es local <150ms).
  Mitigación a evaluar: fast-path de protocolo (uiAction/confirm/cancel) sin LLM; caché de ontología; o un
  planner más pequeño/estructurado. **Medir p95/coste en la evaluación completa antes de decidir.**

## Limitaciones de esta evaluación (honestidad)
- **Escala prototipo**: 12 categorías abstractas, no las 500 generativas + 100 human-like que exige el gate de
  migración. La harness (`planner-shadow-eval.mts`) está lista para escalar; no se ha ejecutado a esa escala.
- **Sin executor/synthesizer completos**: se evaluó el PLAN (interpretación), no la respuesta final sintetizada
  ni la ejecución real de readers para cada goal (eso es la siguiente pieza del prototipo).
- **Sin benchmark de modelos** (gpt-4.1-mini vs otros) ni **matriz de seguridad completa** sobre el planner.
- El juez es una propiedad estructural codificada por mí, no un LLM-juez independiente a escala.

## Veredicto de esta fase (honesto, sin cierre)
La hipótesis arquitectónica queda **CONFIRMADA con evidencia**: P71 falla en multi-goal y semántica financiera
**por diseño** (router de intención única + árbol de ~620 regex), y un planner semántico general **generaliza** a
fraseos no vistos y cierra esos huecos. El prototipo demuestra el mecanismo **y** sus riesgos (el planner debe ir
SIEMPRE gateado por el ejecutor determinista). **No se declara la arquitectura validada** ni se migra: faltan
executor+synthesizer completos, evaluación generativa a escala, human-like eval, benchmark de modelos, matriz de
seguridad sobre el planner y el gate de superioridad. **Producción intacta; V1 (`v1.0.0-rc1`) sigue siendo el
sistema vigente.**
