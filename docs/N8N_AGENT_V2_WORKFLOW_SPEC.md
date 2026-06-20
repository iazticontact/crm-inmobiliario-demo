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
| crm_read_query | `crm_read_query` | `{entity, searchText}` (N2.2: la tool envía solo `entity`+`searchText`; el reader sigue aceptando `clientRef`/`filters`/`dateRange`/`limit`) |

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
