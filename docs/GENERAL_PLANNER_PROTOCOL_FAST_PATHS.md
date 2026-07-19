# General Planner — Inventario de fast-paths pre-planner (FASE 4)

> Qué se ejecuta ANTES del General Planner cuando `GENERAL_SEMANTIC_PLANNER=ON` en
> `src/app/api/assistant/v2/route.ts`, y por qué cada camino es protocolo estructural y no
> interpretación semántica de lenguaje abierto. Auditado contra el código el 2026-07-20.

## Caminos pre-planner (en orden de ejecución)

| # | Camino | Naturaleza | Por qué NO es interpretación semántica | Validación |
|---|---|---|---|---|
| 1 | Guardas de auth/sesión/workspace (early returns de error) | ESTRUCTURAL | No leen el contenido del mensaje; deciden por sesión/config | Sesión Supabase server-side; el workspace lo resuelve el server, nunca el cliente |
| 2 | Crisis guard (`crisis_guard`) | SEGURIDAD | Interceptor de seguridad personal, no de negocio; su misión es NO interpretar CRM | Respuesta fija de seguridad; heredado de V1, idéntico bajo OFF/ON |
| 3 | Rate limit + guardas de bloqueo (`guard_*`) | ESTRUCTURAL | Cuotas/estado, no semántica | Contadores server-side |
| 4 | `uiAction` confirm/cancel (`{uiAction, actionId}`) | PROTOCOLO TIPADO | El navegador envía SOLO `{uiAction:'confirm'|'cancel', actionId}`; el mensaje sintético `[ui:...]` jamás se interpreta (comentario y código en route:235-237) | El server resuelve el actionId contra su propio estado firmado; nada del cliente es verdad |
| 5 | **GENERAL PLANNER (ON)** — todo lenguaje abierto entra aquí | — | — | plan-contract + executor + query layer |

## Deuda arquitectónica documentada (honesta)

- **Fail-soft a P71 bajo ON**: si `plannerAnswer` lanza o no produce respuesta (p. ej. sin API key,
  timeout del modelo), la route continúa por el camino P71 (`tryLocalAnswer` → n8n). Es una decisión de
  DISPONIBILIDAD deliberada (nunca respuesta inventada, nunca 500 al usuario), pero es una desviación del
  ideal «bajo ON ningún interceptor semántico legacy toca lenguaje abierto». Mitigación actual: la
  atribución (`debugSource`/`assistantArchitecture`) distingue SIEMPRE qué cerebro respondió, así que el
  fallback nunca es silencioso en observabilidad. Alternativa futura: responder «no disponible temporal»
  en vez de caer a P71 (FASE 31); requiere decisión de producto sobre disponibilidad vs pureza.
- `tryLocalAnswer` (árbol semántico P71) NO se ha borrado: bajo OFF/SHADOW es el sistema vigente y es el
  rollback instantáneo. Bajo ON solo es alcanzable vía el fail-soft anterior.

## Invariantes verificadas

- OFF (default y valor basura): el planner ni se invoca; comportamiento = P71 idéntico
  (`planner-shadow-compare.mts`: «por defecto off ✓ (no-op)», «basura → off»).
- SHADOW: P71 responde; el planner solo observa (sin doble respuesta, sin escrituras, log
  `source=shadow_planner:arch=GENERAL_PLANNER:...`).
- ON: atribución explícita `assistantArchitecture=GENERAL_PLANNER` + `featureFlagState` en la respuesta.
