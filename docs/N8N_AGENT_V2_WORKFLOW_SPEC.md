# CRM Agent V2 (n8n) — Especificación técnica

> Workflow: `n8n/workflows/crm-agent-v2-readonly.json` · READ-ONLY · inactivo.

## 1. Flujo
`Webhook In (POST /crm-agent-v2)` → `Check secret (IF)` →
  - true → `Normalize input (Set)` → `CRM Agent (AI Agent)` → `Respond to Webhook`
  - false → `Respond Unauthorized (401)`

El AI Agent tiene conectados:
- `OpenAI Chat Model` (ai_languageModel) — gpt-4o-mini, credencial placeholder.
- `Window Memory` (ai_memory) — sessionKey `workspaceId:userId:threadId`, ventana 12.
- 8 `toolHttpRequest` (ai_tool) → todos a `POST {CRM_BASE_URL}/api/agent/tool`.

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
| get_client_360 | `get_client_360` | `{client_id}` | get_client_profile_full + get_client_field_exact (DNI/NIF/zona… vienen en la 360) |
| get_crm_overview | `get_crm_overview` | `{}` | pipeline_summary parcial / resumen |
| get_pending_tasks | `get_pending_tasks` | `{}` | list_pending_tasks |
| get_calendar_summary | `get_calendar_summary` | `{}` | list_today_events / list_week_events |
| get_open_operations | `get_open_operations` | `{}` | list_open_opportunities |
| get_recent_activity | `get_recent_activity` | `{}` | recent_activity |
| get_documents_metadata | `get_documents_metadata` | `{client_id}` | list_client_documents (solo metadata) |

### Tools del endpoint disponibles pero NO incluidas aún (añadir = duplicar nodo, cambiar `tool`)
- `get_open_service_cases` → list_service_cases.
- `get_client_summary` / `get_workspace_summary` → variantes de resumen.
- `get_conversations_summary`, `get_invoices_summary` (módulos dormidos; no usar en V2).

### Gaps reales (NO existen en `/api/agent/tool` todavía → fase futura)
- `get_latest_client` (cliente nuevo/último): hoy se aproxima con `search_clients`.
  Recomendado: añadir el reader al endpoint del CRM cuando se quiera soportar
  "el último cliente registrado".
- Operaciones/expedientes/tareas/documentos **por cliente** (`get_client_*`): el
  endpoint los da a nivel workspace o vía `get_client_360` (incluye tareas/
  calendario/actividad/documentos del cliente, pero NO opportunities/service_cases
  por cliente). Para per-cliente de operaciones/expedientes: extender el endpoint.
- Propiedades (`search_properties`, `list_available_properties`): no hay tool en el
  endpoint. Fase futura (añadir reader + tool).

> Decisión: V2 read-only reutiliza el endpoint existente (seguro, probado,
> workspace-scoped) en lugar de duplicar 18 queries Supabase en n8n. Los gaps se
> cierran añadiendo readers al endpoint del CRM (cambio pequeño y testeable), no
> metiendo `service_role` en n8n.

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
