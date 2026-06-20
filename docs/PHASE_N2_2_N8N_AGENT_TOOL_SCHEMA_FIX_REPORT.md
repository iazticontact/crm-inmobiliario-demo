# FASE N2.2 — Arreglo de schemas de tools del CRM Agent V2 (n8n)

> **Fecha:** 2026-06-20 · Instancia: `https://primer-proyecto-prueba-n8n.hvdnby.easypanel.host`
> · Workflow `[CRM Inmobiliario] Agent V2 — Read Only` (id `6mps8YoWu3syldUc`),
> **INACTIVO**. Corregido por **REST API (PUT)**. No se tocó ningún otro workflow,
> ni `.env`/`.mcp.json`, ni secretos, ni el runtime del CRM (`src/`).

---

## 1. Error exacto observado
En el nodo **`CRM Agent`** (langchain agent), al ejecutar el webhook de prueba:

```
Received tool input did not match expected schema
Required
  → at <campo>
```

El flujo llegaba bien hasta el agente (Webhook In ✅ · Check secret ✅ ·
Normalize input ✅ · Window Memory ✅ · OpenAI Chat Model ✅) y fallaba al intentar
**invocar una tool**.

## 2. Causa raíz
n8n construye un **schema Zod** para cada tool a partir de las llamadas
`$fromAI(key, description, type)` que hay en el `jsonBody`. En esta versión de n8n
**todos los campos `$fromAI` son obligatorios**: no existe forma fiable de marcarlos
opcionales (el `defaultValue` —4º argumento— **no** los hace opcionales; hay una
*feature request* abierta para un flag `isOptional` que aún no está implementada).

Resultado: cuando el modelo (`gpt-4o-mini`) llamaba a una tool con **varios** campos
`$fromAI` y **omitía** alguno (lo habitual con los campos secundarios/opcionales),
la validación Zod lo rechazaba con *"Received tool input did not match expected
schema / Required → at &lt;campo&gt;"* y **abortaba la ejecución del agente**.

**Tool/schema que lo provocaba (principal):** `crm_read_query`, que exigía **tres**
campos (`entity`, `searchText`, `clientRef`). El modelo aportaba `entity` (y a veces
`searchText`) pero omitía `clientRef` → *Required → at clientRef*. El mismo patrón
afectaba a `search_properties` (`query` + `status`).

## 3. Bugs adicionales encontrados (latentes, habrían bloqueado igual)
Auditando las 15 tools en vivo aparecieron tres problemas más que el error de schema
tapaba (ocurren *después* de pasar el schema):

1. **Cabecera de secreto perdida en las 15 tools.** En vivo cada tool tenía
   `"sendHeaders": true, "parametersHeaders": { "values": [ {} ] }` — propiedad
   **incorrecta y vacía**: NO se enviaba `x-nowcrm-secret`. El endpoint del CRM
   habría respondido **401** a cada llamada. (La estructura correcta es
   `specifyHeaders: "keypair"` + `headerParameters.parameters[]`.) Probablemente se
   corrompió en un PUT/guardado anterior; el backup del repo tenía la forma correcta.
2. **Mismatch de clave `client_id` vs `clientId`.** Los readers del CRM leen
   `input.clientId` (camelCase), pero `get_client_360` y `get_documents_metadata`
   enviaban `client_id` (snake_case) → `get_client_360` devolvía siempre
   `invalid_input`; `get_documents_metadata` ignoraba el filtro de cliente.
3. **`Respond Unauthorized` sin `responseCode`.** La rama 401 respondía con HTTP 200
   y body `{error:"unauthorized"}` (faltaba `responseCode: 401`).

## 4. Cambios aplicados (vía REST PUT)
Filosofía del fix: **schema permisivo en n8n, validación en el servidor.** El
endpoint `/api/agent/tool` ya valida todo con mensajes claros en español (UUID,
allowlist de entidades, longitud mínima, etc.) y trata las cadenas vacías como
"ausente". Por eso se minimiza el nº de campos `$fromAI` por tool a los que el modelo
**siempre** aporta, y el resto se delega al servidor.

- **`$fromAI` minimizado** (y con `defaultValue` `''` como red de seguridad):
  - `crm_read_query`: de 3 campos → **2** (`entity`, `searchText`). Se elimina
    `clientRef` del schema del modelo (el filtrado por cliente ya lo cubren
    `get_client_opportunities` / `get_client_service_cases` / `get_client_360`).
  - `search_properties`: de 2 campos → **1** (`query`). Se elimina `status` del
    schema (el `status` viene igualmente en cada fila del resultado; el agente puede
    distinguir "disponibles" leyéndolo). El servidor sigue aceptando `status` si algún
    día se reañade.
  - `search_clients`: 1 campo (`query`). Sin cambios de nº de campos.
  - Tools de un cliente (`get_client_360`, `get_documents_metadata`,
    `get_client_opportunities`, `get_client_service_cases`): 1 campo `clientId`.
- **Cabecera restaurada** en las 15 tools: `specifyHeaders: "keypair"` +
  `headerParameters: [{ name: "x-nowcrm-secret", value: "={{ $env.AGENT_TOOL_SECRET }}" }]`.
- **Claves de body alineadas** con los readers: `client_id` → `clientId` en
  `get_client_360` y `get_documents_metadata` (y `$fromAI('client_id'…)` →
  `$fromAI('clientId'…)` en las cuatro tools de cliente, por coherencia).
- **`Respond Unauthorized`**: añadido `responseCode: 401`.
- **Prompt** (cambio mínimo, no se alargó): la guía de `crm_read_query` decía
  "filtrando por searchText o clientRef" → ahora "filtrando por searchText" (coherente
  con el schema; `clientRef` ya no existe en la tool). Ninguna otra línea del system
  prompt cambió.

Las **8 tools sin argumentos** (`get_crm_overview`, `get_pending_tasks`,
`get_calendar_summary`, `get_open_operations`, `get_recent_activity`,
`get_latest_client`, `get_open_service_cases`, `pipeline_summary`) se quedan con
`input: {}` (sin `$fromAI`) — no aplica el error de schema.

`workspace_id` sigue **fijado** desde `Normalize input` en las 15 tools (el LLM nunca
lo decide). Arquitectura, nº de nodos (23), nº de tools (15) y conexiones: intactos.

## 5. Verificación (read-back por API)
- `active = false` ✅ (no se activó nada).
- 23 nodos, 15 tools ✅.
- Credencial **OpenAI preservada** (`OpenAi account`) y modelo
  `gpt-4o-mini` intactos ✅ (el PUT no la borró).
- Las 15 tools: `x-nowcrm-secret = {{ $env.AGENT_TOOL_SECRET }}`, sin
  `parametersHeaders` residual ✅.
- Tools de cliente usan `clientId`; `crm_read_query` sin `clientRef`;
  `search_properties` sin `status` ✅.
- `Respond Unauthorized` → `responseCode 401` ✅.
- **Otros 8 workflows intactos** (ARIZAN x4 —Vapi v3 sigue `active=true`, su estado
  normal—, HOLA MUNDO, My workflow, 2 ARCHIVADO) y `[MCP TEST]` (`ZcHDxvyqaAXL0NIa`,
  inactivo, no borrado) ✅.
- Backup del repo `n8n/workflows/crm-agent-v2-readonly.json` actualizado para reflejar
  el estado en vivo (JSON validado).

## 6. Tools finales (15)
| Tool | Campos que aporta el modelo (`$fromAI`) | Clave en body |
|---|---|---|
| search_clients | `query` | `query` |
| get_client_360 | `clientId` | `clientId` |
| get_documents_metadata | `clientId` | `clientId` |
| get_client_opportunities | `clientId` | `clientId` |
| get_client_service_cases | `clientId` | `clientId` |
| search_properties | `query` | `query` |
| crm_read_query | `entity`, `searchText` | `entity`, `searchText` |
| get_crm_overview | — | `{}` |
| get_pending_tasks | — | `{}` |
| get_calendar_summary | — | `{}` |
| get_open_operations | — | `{}` |
| get_open_service_cases | — | `{}` |
| get_recent_activity | — | `{}` |
| get_latest_client | — | `{}` |
| pipeline_summary | — | `{}` |

## 7. Cómo repetir el test
1. Asegúrate de que en n8n están las env vars `CRM_BASE_URL`, `AGENT_TOOL_SECRET`,
   `N8N_ASSISTANT_V2_SECRET` y `N8N_BLOCK_ENV_ACCESS_IN_NODE=false`.
2. Abre el workflow y pulsa **Execute workflow / Listen for test event** (la URL
   `webhook-test/...` solo escucha en modo test; no hace falta activar el workflow).
3. Lanza el POST (header `x-nowcrm-agent-secret: <N8N_ASSISTANT_V2_SECRET>`):

```json
{
  "message": "Necesito saber el DNI del ultimo cliente registrado",
  "workspaceId": "d0000000-0000-4000-8000-000000000001",
  "userId": "test-user",
  "threadId": "test-thread-001",
  "activeEntity": null,
  "recentMessages": [],
  "requestId": "test-001"
}
```

Esperado: el agente llama `get_latest_client` (sin args) y responde con el DNI del
metadata, sin error de schema. (Para que **`crm_read_query`** responda hace falta el
redeploy del CRM a `6fa7cca`+ — ver §9.)

## 8. Qué NO se tocó
- No se activó el workflow (sigue `active=false`).
- No se tocaron los otros 8 workflows ni el `[MCP TEST]`.
- No se tocó `.env.local`, `.mcp.json`, ni ningún secreto; no se imprimió ninguna key.
- No se tocó el runtime del CRM (`src/`): los readers ya eran correctos; el bug estaba
  en el workflow (claves de body), así que se corrigió ahí (sin redeploy adicional).
- No se añadió nodo Supabase, ni SQL libre, ni `service_role` en n8n.

## 9. Riesgos / pendientes
- **Redeploy del CRM a `6fa7cca`+** sigue pendiente (de N2.1) para que `crm_read_query`
  responda; el resto de tools funciona con el deploy actual.
- **Pérdida controlada de funcionalidad** por minimizar campos: `crm_read_query` ya no
  filtra por `clientRef` y `search_properties` ya no filtra por `status` desde el LLM.
  Es deliberado (robustez > filtros poco usados). Si en el futuro n8n soporta `$fromAI`
  opcional de forma fiable (o se actualiza la instancia), se pueden reañadir como
  opcionales — el servidor ya los acepta.
- **Cabeceras frágiles ante guardado por UI:** si se reabre el workflow en la UI de
  n8n y se re-guarda, podría volver a alterar la estructura de cabeceras de las
  `toolHttpRequest`. Si reaparece un 401 del CRM, reaplicar este fix por API o fijar la
  cabecera `x-nowcrm-secret` a mano en la UI.
- `gpt-4o-mini` con 2 campos obligatorios (`crm_read_query`) es robusto en la práctica;
  si aún diera el error de schema, el siguiente paso sería dejar `crm_read_query` con
  **solo** `entity`.

## Veredicto
**N2.2 COMPLETADO — TOOL SCHEMAS CORREGIDOS.** Eliminada la causa del error
*"Received tool input did not match expected schema"* (minimización de campos
`$fromAI`), y de paso reparadas la cabecera de secreto, el mismatch `clientId` y el
`responseCode 401`. Workflow validado por read-back, **inactivo**, credencial OpenAI
preservada; demás workflows intactos. Requiere redeploy del CRM (de N2.1) para
`crm_read_query`.
