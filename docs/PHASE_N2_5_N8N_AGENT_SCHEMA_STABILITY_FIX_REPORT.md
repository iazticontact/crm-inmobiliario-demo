# FASE N2.5 — Estabilización de schemas: las tools SIN argumentos rompían el Agent V2 (n8n)

> **Fecha:** 2026-06-20 · Instancia: `https://primer-proyecto-prueba-n8n.hvdnby.easypanel.host`
> · Workflow `[CRM Inmobiliario] Agent V2 — Read Only` (id `6mps8YoWu3syldUc`),
> **INACTIVO**. Corregido por **REST API (PUT)**. Diagnóstico sobre **execution #1238
> (NUEVA, 11:51, posterior a N2.3/N2.4)**. No se tocó ningún otro workflow, secretos,
> `.env`, `.mcp.json`, ni runtime del CRM (`src/`).

---

## 1. Ejecución nueva identificada (verificado, no asumido)
`GET /api/v1/executions?workflowId=6mps8YoWu3syldUc` → la ejecución que falla es
**#1238**, `startedAt 2026-06-20T11:51:45Z`. Es **posterior** al PUT de N2.4 (11:35:52),
así que **NO es una ejecución vieja** — es un fallo real tras N2.3/N2.4. (#1237 era de
las 10:55, anterior; esta vez sí hay una nueva.)

Detalle (`GET /api/v1/executions/1238?includeData=true`):
- `status: error`, `lastNodeExecuted: CRM Agent`.
- `error.message`: `Received tool input did not match expected schema / ✖ Required → at `
  (**path VACÍO** tras "→ at").
- `error.stack`: `N8nTool.call` → `@langchain/core/src/tools/index.ts:247` →
  `AgentExecutor` → `ToolsAgent/V1/execute.ts`. La validación Zod del input de la tool
  revienta.
- `OpenAI Chat Model`: `finish_reason: tool_calls`, **`completionTokens: 11`** (llamada
  a tool muy corta, sin argumentos útiles).
- **El nombre de la tool NO se almacena** en la ejecución (la tool lanzó la excepción
  antes de registrarse como sub-run; `metadata` solo lista Window Memory y OpenAI Chat
  Model). La API de executions de n8n no expone la tool exacta → aplica la estrategia
  de diagnóstico por evidencia + máxima estabilidad (lo previsto para este caso).

## 2. Causa raíz (distinta a la que asumían N2.2/N2.3)
**Path VACÍO en el error de Zod = el modelo llamó la tool con argumentos
ausentes/`undefined`** (no `{}`), y el schema es un `z.object(...)`. En Zod,
`z.object({...}).parse(undefined)` da `Required` en **path raíz `[]`** → se renderiza
"→ at " (vacío). Si el modelo hubiera mandado `{}`, el error diría "→ at <campo>".

¿Cuándo manda gpt-4o-mini argumentos ausentes? **Cuando la tool NO tiene parámetros.**
Las **8 tools sin argumentos** (`get_latest_client`, `get_crm_overview`,
`get_pending_tasks`, `get_calendar_summary`, `get_open_operations`,
`get_open_service_cases`, `get_recent_activity`, `pipeline_summary`) tenían `input: {}`
y **cero `$fromAI`**. n8n las envuelve igualmente como `DynamicStructuredTool` con
schema `z.object({})`, y **un `z.object` rechaza `undefined`** → el modelo, al no tener
nada que rellenar, emite una tool-call con argumentos vacíos → **`Required` en raíz**.

Esto encaja con TODA la evidencia:
- Path vacío (undefined, no `{}`).
- `completionTokens: 11` (típico de una llamada a tool **sin** argumentos).
- El prompt rutea "último cliente registrado" → **`get_latest_client`** (tool sin
  argumentos) → justo el caso del payload de prueba.
- Explica por qué N2.2/N2.3 (minimizar `$fromAI` en las tools **estructuradas**) nunca
  lo arreglaron: **el culpable eran las tools sin argumentos**, que esos fixes no tocaron.

**`crm_read_query` NO era el culpable de #1238:** su único `$fromAI` es `entity` (enum
claro que el modelo rellena siempre); si fuera ella, el error diría "→ at entity", no
vacío. Por eso **no se desconecta ni se reconstruye** — se deja intacta (1 campo, robusta).

## 3. Fix aplicado (vía REST PUT, workflow inactivo)
**A cada una de las 8 tools sin argumentos se le añadió UN campo `$fromAI` claro y
obligatorio (`reason`)**, para que el modelo emita SIEMPRE un objeto de argumentos no
vacío (`{"reason":"..."}`) en lugar de argumentos ausentes → el `z.object` ya valida.

Body nuevo (ejemplo `get_latest_client`):
```
={ "tool": "get_latest_client",
   "workspace_id": "{{ $('Normalize input').item.json.workspaceId }}",
   "input": { "reason": "{{ $fromAI('reason', 'motivo breve de tu consulta en pocas palabras', 'string', '') }}" } }
```

- **El servidor ignora `reason`.** Verificado en `src/app/api/agent/tool/route.ts`: las
  8 tools sin argumentos despachan como `(s, w) => reader(s, w)` (p. ej. l.138
  `get_latest_client: (s, w) => getLatestClient(s, w)`) — **nunca leen `input`**; las
  que reciben `i` solo leen claves concretas e ignoran las desconocidas. **No hubo que
  tocar el runtime del CRM.**
- Filosofía: **estabilidad > pureza**. Ahora **las 15 tools tienen exactamente UN
  campo `$fromAI`** (un string claro que el modelo rellena con fiabilidad). Ninguna con
  0 (modo de fallo eliminado) ni con >1 (riesgo de omisión eliminado desde N2.2/N2.3).

## 4. Tools finales (15) — todas con 1 campo
| Tool | `$fromAI` | Tool | `$fromAI` |
|---|---|---|---|
| search_clients | query | get_recent_activity | **reason** |
| get_client_360 | clientId | get_latest_client | **reason** |
| get_documents_metadata | clientId | get_open_service_cases | **reason** |
| get_client_opportunities | clientId | pipeline_summary | **reason** |
| get_client_service_cases | clientId | get_crm_overview | **reason** |
| search_properties | query | get_pending_tasks | **reason** |
| crm_read_query | entity | get_calendar_summary | **reason** |
| get_open_operations | **reason** | | |

## 5. Verificación (read-back por API)
- `active = false` ✅ (no se activó).
- 23 nodos, **15 tools**, **15 conexiones `ai_tool`** al `CRM Agent` ✅.
- Cada tool: **exactamente 1 `$fromAI`** ✅ (las 8 sin-args ahora con `reason`).
- Cabecera `x-nowcrm-secret = {{$env.AGENT_TOOL_SECRET}}` intacta en las 15 ✅.
- `systemMessage` sigue interpolado (empieza con `=`, de N2.4) ✅.
- `crm_read_query` intacta (solo `entity`), NO desconectada ✅.
- Credencial OpenAI (`gpt-4o-mini`, temp 0.3) preservada; Window Memory intacta ✅.
- Backup repo `n8n/workflows/crm-agent-v2-readonly.json` regenerado del estado vivo.
- Workflows antiguos y `[MCP TEST]` (`ZcHDxvyqaAXL0NIa`): no tocados.

## 6. Prompt
**No se tocó.** El campo `reason` es auto-descriptivo vía su `$fromAI`; el modelo lo
rellena por el schema. El ruteo "último cliente → get_latest_client" ya estaba.
`crm_read_query` sigue documentada como fallback. Sin alargar el prompt.

## 7. Qué NO se tocó
Workflow `active=false`; otros workflows, secretos, `.env`, `.mcp.json`, runtime CRM,
credenciales: intactos. `crm_read_query` NO desconectada (no era el culpable). Sin
Supabase directo, sin SQL libre, sin `service_role` en n8n. No se ejecutó test E2E (el
webhook `webhook-test/...` solo escucha en modo "Listen for test event", manual).

## 8. Próximo test exacto para el usuario
1. CRM redeployado a `6fa7cca`+ (para que `crm_read_query` y el resto respondan datos).
2. En n8n: abrir el workflow → **Execute workflow / Listen for test event** (sin activar).
3. POST (header `x-nowcrm-agent-secret: <N8N_ASSISTANT_V2_SECRET>`):
```json
{ "message": "Necesito saber el DNI del ultimo cliente registrado",
  "workspaceId": "d0000000-0000-4000-8000-000000000001",
  "userId": "test-user", "threadId": "test-thread-001",
  "activeEntity": null, "recentMessages": [], "requestId": "test-001" }
```
Esperado: el agente llama `get_latest_client` con `{"reason":"..."}` → **ya NO crashea
por schema**; devuelve el cliente y el DNI (de `metadata`). Revisa la nueva execution:
debe pasar el nodo `CRM Agent`.

## 9. Riesgos / pendientes
- **Redeploy CRM a `6fa7cca`+** sigue pendiente (de N2.1).
- `reason` es un campo "de relleno" (el servidor lo ignora). Es deliberado: el coste es
  trivial y elimina el modo de fallo de argumentos vacíos. Si una futura versión de n8n
  permite `$fromAI` opcional o tools sin schema que acepten `undefined`, se puede quitar.
- **Gotcha**: reabrir/guardar el workflow en la UI puede alterar la estructura de las
  `toolHttpRequest`; si reaparece un 401 o el error de schema, reaplicar por API.

## Veredicto
**N2.5 COMPLETADO — SCHEMA ESTABILIZADO.** Identificada por evidencia la causa real del
fallo en la ejecución NUEVA (#1238): las 8 tools **sin argumentos** rompían porque
gpt-4o-mini las invoca con argumentos ausentes y el `z.object` de n8n rechaza
`undefined` (`Required` en raíz). Añadido un único `$fromAI` (`reason`, ignorado por el
servidor) a esas 8 → ahora **las 15 tools tienen exactamente 1 campo** que el modelo
rellena siempre. `crm_read_query` intacta (no era el culpable). Validado por read-back,
**inactivo**, headers y credencial OpenAI preservados, demás workflows intactos.
Requiere redeploy del CRM (de N2.1) para devolver datos.
