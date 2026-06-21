# CRM Agent V2 (n8n) — Especificación técnica

> Workflow: `n8n/workflows/crm-agent-v2-readonly.json` · READ-ONLY · inactivo.

## 1. Flujo
`Webhook In (POST /crm-agent-v2)` → `Check secret (IF)` →
  - true → `Normalize input (Set)` → `CRM Agent (AI Agent)` → `Respond to Webhook`
  - false → `Respond Unauthorized (401)`

El AI Agent tiene conectados:
- `OpenAI Chat Model` (ai_languageModel) — gpt-4o-mini, credencial placeholder.
- `Window Memory` (ai_memory) — sessionKey `workspaceId:userId:threadId`, ventana 12.
- 15 `toolHttpRequest` (ai_tool) → todos a `POST {CRM_BASE_URL}/api/agent/tool`,
  con cabecera `x-nowcrm-secret: {{$env.AGENT_TOOL_SECRET}}`
  (`specifyHeaders: keypair` + `headerParameters`).

## 2. Contrato de entrada (webhook body)
```
message: string         # turno del usuario
workspaceId: string     # UUID del workspace (fija el tenant; NO lo decide el LLM)
userId: string
threadId: string
activeEntity?: object   # { type, id, label } de la entidad activa del hilo (opcional)
recentMessages?: array  # opcional (la memoria de n8n ya guarda historial por sessionId)
requestId?: string
timestamp?: string
```
Header obligatorio: `x-nowcrm-agent-secret: <N8N_ASSISTANT_V2_SECRET>`.

## 3. Contrato de salida
```
reply: string
usedTools: string[]        # (placeholder; rellenar si se instrumenta)
activeEntityUpdate: object|null
limitations: string[]
error: string|null
requestId: string
```

## 4. Mapa de tools n8n → endpoint del CRM (`/api/agent/tool`)
| Tool n8n (incluida) | tool del endpoint | input | Cubre del brief |
|---|---|---|---|
| search_clients | `search_clients` | `{query}` | search_clients |
| get_client_360 | `get_client_360` | `{clientId}` | get_client_profile_full + get_client_field_exact (DNI/NIF/zona… vienen en la 360) |
| get_crm_overview | `get_crm_overview` | `{}` | pipeline_summary parcial / resumen |
| get_pending_tasks | `get_pending_tasks` | `{}` | list_pending_tasks |
| get_calendar_summary | `get_calendar_summary` | `{}` | list_today_events / list_week_events |
| get_open_operations | `get_open_operations` | `{}` | list_open_opportunities |
| get_recent_activity | `get_recent_activity` | `{}` | recent_activity |
| get_documents_metadata | `get_documents_metadata` | `{clientId}` | list_client_documents (solo metadata) |

### N1.1 — gaps cerrados (nuevos readers + tools)
| Tool n8n (añadida) | tool del endpoint | input |
|---|---|---|
| get_latest_client | `get_latest_client` | `{}` (cliente más reciente + metadata/DNI; fija activo) |
| get_client_opportunities | `get_client_opportunities` | `{clientId}` |
| get_client_service_cases | `get_client_service_cases` | `{clientId}` |
| get_open_service_cases | `get_open_service_cases` | `{}` (expedientes abiertos workspace) |
| pipeline_summary | `pipeline_summary` | `{}` (operaciones por etapa: conteo+valor) |
| search_properties | `search_properties` | `{query}` (N2.2: la tool envía solo `query`; el reader sigue aceptando `status`/`city`) |

### N2.1 — tool universal segura (arquitectura híbrida)
| Tool n8n (añadida) | tool del endpoint | input |
|---|---|---|
| crm_read_query | `crm_read_query` | `{entity}` + `limit:10` fijo (N2.3: la tool envía solo `entity` como `$fromAI`; `searchText` se eliminó porque era un `$fromAI` required que el modelo omitía → crash. El reader sigue aceptando searchText/clientRef/filters/dateRange) |

`entity` ∈ allowlist `{clients, opportunities, service_cases, tasks,
calendar_events, properties, documents, activities}`. **Sin SQL libre**: el servidor
construye la query, fija `workspace_id`, acota `limit ≤ 20`, sanea `searchText`
(`ilike` sobre columnas declaradas), elimina `workspace_id` de la salida y solo
expone `metadata` en `clients`; documentos solo metadata. Uso: consultas amplias o
entidades sin tool propia; para lo típico, preferir la tool específica. (Cierra el
gap antes listado como `crm_search`.) Ver `PHASE_N2_1_N8N_AGENT_V2_PERFECTION_REPORT.md`.
> Requiere **redeploy del CRM** (cambio de runtime en `/api/agent/tool`).

**Además:** `get_client_360` ahora incluye `metadata` (DNI/NIF y campos
personalizados) → el agente n8n ya puede leer el DNI por cliente (antes el reader
NO seleccionaba metadata; mismo fallo de S9 pero en el endpoint, corregido aquí).

### Cubierto por get_client_360 (no requiere tool propia)
- Tareas, citas, actividad y documentos **por cliente** ya vienen en `get_client_360`.
- Campo exacto (DNI/NIF/dirección/zona…) → el agente lo extrae del `metadata` que
  devuelve `get_client_360` (no hace falta un endpoint `get_client_field_exact`).

### Aún fase futura (documentado, no implementado)
- `crm_search` global agrupado multi-entidad → **cubierto en N2.1** por
  `crm_read_query` (universal segura, una entidad por llamada).
- `list_available_properties` como tool separada (cubierto por
  `search_properties` con `status=available`).
- Active entity para operación/expediente/tarea (hoy solo activeClient).
- Escritura (V2 es read-only).

> Decisión: V2 read-only reutiliza y AMPLÍA el endpoint existente (seguro,
> probado, workspace-scoped) en vez de duplicar queries Supabase en n8n. Los gaps
> se cierran añadiendo readers read-only al endpoint del CRM (cambio pequeño y
> testeable), nunca metiendo `service_role` en n8n.

## 5. Memoria
- Prototipo: `memoryBufferWindow` (en memoria del proceso n8n), sessionKey
  `workspaceId:userId:threadId`, ventana 12 mensajes.
- Producción: `Postgres Chat Memory` (Supabase/Postgres) con el mismo sessionKey →
  memoria persistente por workspace+usuario+hilo. Guardar SOLO historial y, si se
  quiere entidad activa, `{type,id,label}` (no PII completa).

## 6. Seguridad
- Webhook firmado (`N8N_ASSISTANT_V2_SECRET`); rechaza sin header.
- `workspace_id` fijado desde el payload (no LLM) → sin cruce de tenant.
- Datos vía endpoint con `AGENT_TOOL_SECRET` (server-to-server), `service_role`
  solo dentro del CRM, todas las queries `.eq('workspace_id', …)`, mutaciones 410.
- Sin secretos en el JSON (solo `$env`/placeholder).

## 7. Limitaciones de V2
- Read-only (no crea/edita/borra). Las acciones se diseñarán en una fase posterior
  (preparar intención + confirmación, sin que el LLM ejecute directo).
- No lee contenido de documentos (solo metadata; sin RAG).
- No facturación, WhatsApp ni Google sync (módulos futuros).

## 8. Riesgo de import
El JSON de nodos langchain de n8n es sensible a versión. Tras importar, revisa:
typeVersions (agent 1.7 / lmChatOpenAi 1.2 / memoryBufferWindow 1.3 /
toolHttpRequest 1.1 / if 2 / set 3.4 / webhook 2 / respondToWebhook 1.1) y las
expresiones `jsonBody`/`$fromAI`. Si tu n8n es más nuevo/antiguo, ajusta en la UI.

## 9. Schemas de tools — historia y SOLUCIÓN FINAL (N2.2 → N2.6)
**N2.2–N2.5 (obsoleto):** se intentó arreglar el error
`Received tool input did not match expected schema / Required` ajustando los `$fromAI`
del `jsonBody` de las `toolHttpRequest`. **NO funcionó.** En N2.6 se demostró (por
`promptTokens` invariante entre ejecuciones reales) que **en esta versión de n8n el nodo
`toolHttpRequest` NO registra el schema del modelo a partir del `$fromAI`** → bug conocido
(n8n issues #17241/#14399/#13440). Cualquier tweak del `jsonBody` es invisible para OpenAI.

**N2.6 (SOLUCIÓN FINAL, probada en vivo):** las **15 tools son `@n8n/n8n-nodes-langchain.toolCode`**
(Code Tool), NO `toolHttpRequest`. Cada una:
- `specifyInputSchema: true` + `inputSchema` **permisivo**
  `{type:object, properties:{…opcional…}, additionalProperties:true}` → **acepta
  llamadas vacías** (clave para no romper por `Required`).
- `jsCode` hace `this.helpers.httpRequest` a `{{$env.CRM_BASE_URL}}/api/agent/tool`,
  cabecera `x-nowcrm-secret = {{$env.AGENT_TOOL_SECRET}}`, body `{tool, workspace_id, input}`
  con `workspace_id` fijado desde `$('Normalize input')` (NUNCA del LLM) y try/catch que
  devuelve `{ok:false,error:'crm_unreachable'}` si el CRM falla (no crashea el agente).

**Reglas vigentes:** usar `toolCode` (no `toolHttpRequest`); schema permisivo; `workspace_id`
desde `Normalize input`; `systemMessage` con prefijo `=` (N2.4); contrato del CRM intacto
(`{tool, workspace_id, input}`) → sin redeploy de runtime. Ver
`PHASE_N2_6_N8N_AGENT_HARD_SCHEMA_FIX_REPORT.md`.

## 10. Conexión con el CRM (N3) · 2026-06-20
El CRM llama a este workflow como cerebro del asistente. Webhook de producción
`/webhook/crm-agent-v2` (**workflow ACTIVO**), cabecera `x-nowcrm-agent-secret` =
`N8N_ASSISTANT_V2_SECRET`. Payload: `{ message, workspaceId, userId, threadId,
activeEntity, recentMessages, requestId }`. Respuesta (Respond to Webhook):
`{ reply, usedTools, activeEntityUpdate, limitations, error, requestId }` — `reply` es
`$json.output` del AI Agent. Lado CRM: adapter `src/lib/agents/n8n-assistant-client.ts`
+ `/api/assistant/v2` (provider `n8n` por defecto). `sessionId` de la Window Memory =
`workspaceId:userId:threadId` → memoria por conversación. Ver
`PHASE_N3_CONNECT_CRM_TO_N8N_AGENT_V2_REPORT.md`.

## 11. N4 — memoria + cobertura · 2026-06-21
`crm_read_query` (toolCode) ahora acepta `searchText`/`clientRef`/`filters` además de
`entity` (el reader server ya lo validaba; ilike seguro, workspace-scoped) → cubre búsqueda
por texto en las 8 entidades. El CRM pasa `activeEntity` con `.previous` (memoria de hilo
en `assistant_agent_memory`, escrita por el servidor). Prompt (~4815 chars): "el anterior"
→ `activeEntity.previous`; lead score NUNCA se muestra; sin cierres de relleno. El endpoint
`/api/agent/tool` elimina `lead_score` del resultado (`stripInternalFields`). gpt-4.1-mini@0.2.

## 12. N4.1 — activeEntityUpdate (entidad resuelta) · 2026-06-21
El AI Agent tiene `returnIntermediateSteps=true`. Un nodo **Build Response**
(`n8n-nodes-base.code`) entre `CRM Agent` y `Respond to Webhook` deriva
`activeEntityUpdate` (+`usedTools`) de `intermediateSteps` (datos REALES de las tools,
no del texto): resultado único claro → {type,id,label,source,confidence}; varios/ninguno
→ null. Respond devuelve `{reply, usedTools, activeEntityUpdate, ...}`. El usuario solo ve
`reply`. El CRM (`/api/assistant/v2`) persiste `activeEntityUpdate` por tipo en
`assistant_agent_memory` y recuerda cliente activo/previo (+ entidad no-cliente reciente
en `activeEntity.recent`). Prompt +1 línea (recent). Ver
`PHASE_N4_1_AGENT_V2_ACTIVE_ENTITY_UPDATE_REPORT.md`.

## 13. N4.1.1 — prioridad mensaje vs memoria (hotfix saludo) · 2026-06-21
Síntoma: "Hola?" respondía "Perfecto, te espero" (Window Memory de un cierre/pausa previo
contaminaba; recentMessages iba vacío y además el workflow NO lo consume). Fix: se sustituyó
el bloque `JUICIO CONVERSACIONAL` por **PRIORIDAD MENSAJE vs MEMORIA** (principios): el
mensaje actual manda; memoria solo ante referencia contextual real ("su/este/el anterior/
eso/vuelve"); saludo/reapertura = inicio fresco; "te espero"/cierres solo si el mensaje
actual lo pide. Solo prompt (n8n), sin redeploy CRM. Evals: categoría `reopen` 12/12 + sin
regresión. Ver `PHASE_N4_1_1_GREETING_MEMORY_CONTAMINATION_HOTFIX_REPORT.md`.

## 14. N4.2 — calidad conversacional premium · 2026-06-21
Prompt 5603→7895 chars: nueva intro de persona (copiloto interno, no bot), bloque
**PERSONALIDAD Y ESTILO** + **GUIA DE ESTILO** (8 ejemplos de tono, no plantillas) y ficha
estructurada (bullets + "No consta"); recortadas prohibiciones de tono redundantes. Reglas
de datos/tools/memoria/seguridad/PRIORIDAD intactas. **Build Response** ahora ELIMINA
cualquier UUID del `reply` (el id sigue interno en activeEntityUpdate) → el usuario nunca
ve UUIDs ni aunque los pida. Solo n8n, sin redeploy. Evals: conversation_quality_premium
20/20 + regresión completa (148 casos). Ver `PHASE_N4_2_CONVERSATIONAL_QUALITY_PREMIUM_REPORT.md`.
