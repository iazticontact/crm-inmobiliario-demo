# FASE N2.3 — Eliminar el último `$fromAI` required del Agent V2 (n8n)

> **Fecha:** 2026-06-20 · Instancia: `https://primer-proyecto-prueba-n8n.hvdnby.easypanel.host`
> · Workflow `[CRM Inmobiliario] Agent V2 — Read Only` (id `6mps8YoWu3syldUc`),
> **INACTIVO**. Corregido por **REST API (PUT)**. Diagnóstico sobre **execution
> #1237**. No se tocó ningún otro workflow, secretos, `.env`, `.mcp.json`, ni runtime
> del CRM (`src/`).

---

## 1. Diagnóstico real (execution #1237)
Leída por API (`GET /api/v1/executions/1237?includeData=true`). Hallazgos:
- `status: error`, falla en el nodo **`CRM Agent`**.
- `error.message`:
  ```
  Received tool input did not match expected schema
  ✖ Required
    → at
  ```
  El path tras `→ at` está **vacío** → el modelo invocó una tool **sin objeto de
  argumentos** (input `undefined`/vacío), y la tool tenía un campo **required**.
- `error.output: "{}"`, `finish_reason: tool_calls`, `completionTokens: 11` → el
  modelo hizo una llamada a tool muy corta (sin argumentos útiles).
- **Prueba empírica clave:** en N2.2 `crm_read_query` tenía `searchText` como
  `$fromAI(..., 'string', '')` (con default `''`) y **aun así** crasheó por
  "Required". ⇒ **El `defaultValue` (4º arg) NO hace opcional un `$fromAI` en esta
  versión de n8n.** Confirma que la única vía fiable es **no exponer como `$fromAI`
  ningún campo que el modelo pueda omitir**.

**Tool que fallaba:** `crm_read_query` (la única tool que quedó con 2 campos `$fromAI`
tras N2.2: `entity` + `searchText`). Para "DNI del último cliente" el modelo no
necesita texto de búsqueda → llamaba con argumentos vacíos → `searchText` (required)
faltaba → crash.

## 2. Causa raíz
`$fromAI` ⇒ campo **siempre required** en el schema Zod que n8n genera (sin opción de
opcional; el flag `isOptional` es una *feature request* abierta). Cualquier `$fromAI`
que el modelo pueda dejar vacío puede romper el agente con
*"Received tool input did not match expected schema / Required"*.

## 3. Fix aplicado (vía REST PUT, workflow inactivo)
**`crm_read_query` → solo `entity` como `$fromAI`** (el único campo que el modelo
siempre aporta al elegir esta tool) + `limit: 10` **fijo** (estático, no `$fromAI`).
Se **eliminó `searchText`** del body de la tool.

Body final de `crm_read_query`:
```
={ "tool": "crm_read_query", "workspace_id": "{{ $('Normalize input').item.json.workspaceId }}",
   "input": { "entity": "{{ $fromAI('entity', 'Entidad CRM a consultar: clients, opportunities, service_cases, tasks, calendar_events, properties, documents o activities') }}", "limit": 10 } }
```

> **Nota sobre el body que sugeriste:** usé `"workspace_id"` (snake_case) y
> `$('Normalize input').item.json.workspaceId`, **no** `"workspaceId"`/`$json`. El
> endpoint del CRM exige `workspace_id` y, dentro de una tool sub-nodo, `$json` no
> resuelve al payload normalizado — el patrón fiable (y ya en uso) es
> `$('Normalize input')`. Además **no** rellené `searchText` con `{{$json.message}}`:
> al ser el mensaje completo, el `ilike` del servidor no casaría casi nunca →
> **falsos negativos** ("no hay tareas" cuando sí las hay). Dejar la tool como
> *listar entidad* (sin texto) es más correcto: el reader ordena por recencia y
> devuelve filas; el modelo filtra de los resultados. El texto de búsqueda sigue
> cubierto por `search_clients` y `search_properties`.

**Estado final de campos `$fromAI` por tool** (ninguna tool tiene >1 campo required):
| Tool | `$fromAI` | Tool | `$fromAI` |
|---|---|---|---|
| search_clients | `query` | get_recent_activity | — |
| get_client_360 | `clientId` | get_latest_client | — |
| get_documents_metadata | `clientId` | get_open_service_cases | — |
| get_client_opportunities | `clientId` | pipeline_summary | — |
| get_client_service_cases | `clientId` | get_crm_overview | — |
| search_properties | `query` | get_pending_tasks | — |
| **crm_read_query** | **`entity`** | get_calendar_summary | — |
| get_open_operations | — | | |

## 4. Verificación (read-back por API)
- `active = false` ✅ (no se activó).
- 23 nodos, **15 tools** ✅.
- `crm_read_query`: **sin `searchText`**, solo `entity` + `limit:10` ✅.
- Cabecera `x-nowcrm-secret = {{ $env.AGENT_TOOL_SECRET }}` intacta en las 15 tools ✅.
- **Credencial OpenAI preservada** (`OpenAi account`, `gpt-4o-mini`) ✅.
- Tools sin argumentos siguen con `input:{}` y cero `$fromAI` ✅.
- `search_properties` ya era de un solo campo (`query`) desde N2.2 (sin `status`) ✅.
- Workflows antiguos intactos (no tocados).

## 5. Hallazgo aparte (NO corregido en esta fase) — prompt sin interpolar
En el prompt que llega al modelo (visto en #1237), las líneas de contexto van
**literales** (sin resolver):
```
- workspaceId activo: {{ $('Normalize input').item.json.workspaceId }}
- entidad activa del hilo (si la hay): {{ $('Normalize input').item.json.activeEntity }}
```
Causa: el `systemMessage` se guardó como **texto plano** (sin prefijo `=`), así que
n8n no evalúa los `{{ }}` de dentro. **No** es la causa del crash (la regla de ruteo
de tools sí se lee), pero el modelo ve placeholders en bruto y pierde el contexto de
`activeEntity` ("este cliente"). **No lo toqué** para mantener N2.3 quirúrgico y no
arriesgar un fallo de expresión en todo el prompt que no puedo testear sin ejecutar.
**Recomendación:** prefijar el `systemMessage` con `=` (o quitar esas 2 líneas). Lo
aplico en una pasada aparte si lo apruebas.

## 6. Cómo repetir el test
1. CRM redeployado a `6fa7cca`+ (para `crm_read_query`).
2. En n8n: *Execute workflow / Listen for test event* (no hace falta activar).
3. POST con header `x-nowcrm-agent-secret: <N8N_ASSISTANT_V2_SECRET>` y el payload:
```json
{ "message": "Necesito saber el DNI del ultimo cliente registrado",
  "workspaceId": "d0000000-0000-4000-8000-000000000001",
  "userId": "test-user", "threadId": "test-thread-001",
  "activeEntity": null, "recentMessages": [], "requestId": "test-001" }
```
Esperado: el agente llama `get_latest_client` (sin args) y devuelve el DNI; si usa
`crm_read_query`, ahora basta con `entity` → ya no crashea por schema.

## 7. Qué NO se tocó
Workflow sigue `active=false`; otros workflows, secretos, `.env`, `.mcp.json`, runtime
CRM, prompt (salvo lo indicado: NO se tocó), credenciales: intactos. Sin Supabase
directo, sin SQL libre, sin `service_role` en n8n.

## 8. Riesgos / pendientes
- **Redeploy CRM a `6fa7cca`+** sigue pendiente (de N2.1) para `crm_read_query`.
- `entity` sigue siendo `$fromAI` required: si el modelo llamara `crm_read_query` con
  argumentos totalmente vacíos (omitiendo `entity`) podría volver a fallar. Con un
  único campo claro la probabilidad es muy baja; si reapareciera, el siguiente paso
  sería rutear por prompt para que el modelo use las tools dedicadas y reservar
  `crm_read_query` a casos explícitos.
- Pérdida deliberada: `crm_read_query` ya no busca por texto (solo lista entidad). El
  reader lo sigue soportando; reactivable si n8n soporta `$fromAI` opcional.
- **Gotcha**: reabrir/guardar el workflow en la UI puede alterar la cabecera de las
  `toolHttpRequest`; si reaparece un 401, reaplicar por API.

## Veredicto
**N2.3 COMPLETADO — REQUIRED FIELD FIX.** Eliminado el último `$fromAI` required que
el modelo podía omitir (`crm_read_query.searchText`); ahora ninguna tool tiene más de
un `$fromAI` y todos son campos que el modelo aporta al invocar la tool. Validado por
read-back, **inactivo**, credencial OpenAI preservada, demás workflows intactos.
Requiere redeploy del CRM (de N2.1) para `crm_read_query`.
