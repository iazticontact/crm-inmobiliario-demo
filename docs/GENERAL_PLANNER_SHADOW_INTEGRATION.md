# General Semantic Planner — Integración SHADOW en la route (FASE 1-5)

> Rama aislada `general-semantic-planner`. **NO mergeado, NO desplegado.** `main`/producción = `ad3c06e`
> (V1). El flag por defecto es **OFF ⇒ P71 intacto, sin cambio de comportamiento ni latencia.** 2026-07-19.

## Qué se integró (a nivel de código, en la rama)
Feature flag real `GENERAL_SEMANTIC_PLANNER` cableado en la route activa `src/app/api/assistant/v2/route.ts`
vía `src/lib/agents/planner/shadow-hook.ts`:

| Estado | Comportamiento | Escrituras | Respuesta al usuario |
|---|---|---|---|
| **OFF** (default) | La route se comporta EXACTAMENTE como antes. El único trabajo extra es una lectura de env (`plannerMode()`). Los bloques del planner ni se entran. | — | P71 |
| **SHADOW** | P71 responde al usuario. El planner procesa el MISMO turno (solo lecturas + acciones dry-run) y se registra la atribución/comparación. No altera respuesta ni estado autoritativo. | dry-run | P71 |
| **ON** | Para lenguaje abierto, el planner es el cerebro (tras los fast-paths de protocolo: uiAction/confirm/cancel). Fail-soft: si el planner no puede, cae a P71 (nunca respuesta inventada). | dry-run (prototipo) | Planner |

## Garantías de seguridad
- **OFF es un no-op probado**: `plannerMode()` por defecto = `off`; ambos bloques (`on`/`shadow`) están tras
  `if (gspMode === ...)`. Verificado: `off` por defecto, `shadow→shadow`, `on→on`, valor basura→`off`.
- **Nunca dual writes / doble respuesta / doble mutación**: ON devuelve y retorna; SHADOW no toca la respuesta.
- **El planner nunca escribe** en el prototipo (acciones = dry-run preview), sea cual sea el flag.
- **Atribución**: cada turno del planner registra `assistantArchitecture=GENERAL_PLANNER` + `featureFlagState`.
  Imposible volver a probar P71 creyendo que es el planner (y viceversa).
- `next build` **OK** (route compila); `tsc` limpio; security matrix **11/11**; mecanismos nuevos **9/9**.

## Shadow comparison por turno (P71 vs planner, misma entrada, sin exact-text) — `scripts/planner-shadow-compare.mts`
```
mensaje                                    | P71 tool             | PLANNER (GENERAL_PLANNER)
¿cuántos clientes tengo?                   | local_clients        | read_request / clients.count
enséñame un cliente al azar                | local_clients (lista)| read_request / clients.list [sel=random→1]
dame la ficha completa de <cliente>        | local_client_detail  | read_request / clients.detail
¿qué puedes hacer con la cartera?          | local_turn:capability| capability_question / capabilities.introspect
¿cuánto llevo generado en comisiones…?     | UNHANDLED→n8n        | read_request / commissions.aggregate
explícame operaciones y dime cuántas…      | local_turn:module    | read_request / explain.module+operations.list (multi-goal)
¿se pueden cambiar los precios desde aquí? | UNHANDLED→n8n        | capability_question / capabilities.introspect
```
Diferencias arquitectónicas visibles: selección (1 vs lista), introspección derivada (vs genérico),
semántica financiera real (vs delegar a n8n donde aparecía el falso «sin acceso»), multi-goal (vs 1 goal).

## Gates que siguen ABIERTOS (honesto) — por qué NO hay veredicto de candidato
- **Deploy a staging + ON en staging**: requiere merge a `main` (que auto-despliega) o un mecanismo de deploy de
  rama; toca infraestructura compartida. No ejecutado sin autorización de integración y sin pasar los previos.
- **Eval a escala**: 600 generativas / 120 human-like / 100 black-box = miles de llamadas LLM reales (coste del
  usuario). Ejecutado a escala honesta (72 generativas + benchmark + metamórfico + 9/9 mecanismos), no la completa.
- **Regresión P70/P71 completa** (Playwright, red-team, chaos, grants…): no re-ejecutada; obligatoria antes de ON real.
- **Coherence score de conversación completa** y **model hard-benchmark 300 multi-turn**: pendientes.

Producción intacta (P71/V1 vigente). El siguiente paso, ya preparado y seguro, es desplegar la rama a staging con
`GENERAL_SEMANTIC_PLANNER=SHADOW`, recoger comparación real de tráfico y luego `=ON` en staging para validación humana.
