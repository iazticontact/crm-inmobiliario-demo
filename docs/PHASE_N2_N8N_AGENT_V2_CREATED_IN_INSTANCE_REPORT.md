# FASE N2 — CRM Agent V2 creado directamente en n8n (vía REST API)

> **Fecha:** 2026-06-18 · Instancia: `https://primer-proyecto-prueba-n8n.hvdnby.easypanel.host`
> · Creado por **REST API** (no import manual), workflow **INACTIVO**, sin
> credenciales reales. No se tocó ningún workflow existente.

---

## 1. Workflows existentes ANTES (8) — intactos
HOLA MUNDO · ARIZAN Outbound Dispatch v2 · My workflow · ARIZAN Vapi v3 (active) ·
[ARCHIVADO] Vapi XML v2 · [MCP TEST] (inactive) · [ARCHIVADO] Vapi v1 · ARIZAN
Scrapper Google Maps v2. **Ninguno modificado.** El [MCP TEST] sigue inactivo (NO
borrado, pendiente tu OK).

## 2-5. Workflow creado
- **Nombre:** `[CRM Inmobiliario] Agent V2 — Read Only`
- **ID:** `6mps8YoWu3syldUc`
- **Estado:** `active = false` (no se ejecuta nada).
- **Nodos:** 22 (todos aceptados por la API).

## 6. Nodos
- `Webhook In` (n8n-nodes-base.webhook, path `crm-agent-v2`, responseNode).
- `Check secret` (IF): compara header `x-nowcrm-agent-secret` con `{{$env.N8N_ASSISTANT_V2_SECRET}}`.
- `Normalize input` (Set): extrae message/workspaceId/userId/threadId/sessionId/
  activeEntity/requestId del body.
- `CRM Agent` (@n8n/n8n-nodes-langchain.agent) con system prompt CRM (read-only).
- `OpenAI Chat Model` (@n8n/n8n-nodes-langchain.lmChatOpenAi, gpt-4o-mini) —
  **sin credencial** (la conectas tú en la UI).
- `Window Memory` (@n8n/n8n-nodes-langchain.memoryBufferWindow), sessionKey
  `workspaceId:userId:threadId`, ventana 12.
- `Respond to Webhook` (200, JSON `{reply, usedTools, activeEntityUpdate, limitations, error, requestId}`).
- `Respond Unauthorized` (401) en la rama del secret fallido.

## 7. Tools configuradas (14 HTTP Request Tools → `/api/agent/tool`)
search_clients · get_client_360 · get_latest_client · get_client_opportunities ·
get_client_service_cases · get_open_operations · get_open_service_cases ·
get_pending_tasks · get_calendar_summary · get_recent_activity ·
get_documents_metadata · pipeline_summary · search_properties · get_crm_overview.
Cada una: `POST {{$env.CRM_BASE_URL}}/api/agent/tool`, header
`x-nowcrm-secret: {{$env.AGENT_TOOL_SECRET}}`, body
`{ "tool": "<nombre>", "workspace_id": "{{$('Normalize input').item.json.workspaceId}}", "input": {...} }`.
**El `workspace_id` se fija del payload, NO lo decide el LLM.**

## 8. Variables/env a configurar en n8n (tú)
- `CRM_BASE_URL` — URL pública del CRM (donde corre `/api/agent/tool`).
- `AGENT_TOOL_SECRET` — el MISMO valor que el CRM (gate de `/api/agent/tool`).
- `N8N_ASSISTANT_V2_SECRET` — secreto del webhook (lo inventas tú; lo enviará el CRM).
> En n8n: Settings → Variables (o env del contenedor). No van en el workflow.

## 9. Credencial OpenAI — PENDIENTE
El nodo `OpenAI Chat Model` se creó **sin credencial** a propósito (no se puede
inyectar una API key por API de forma segura). **Conéctala tú** en la UI: abre el
nodo → selecciona/crea la credencial *OpenAI account*.

## 10. Memoria
`Window Buffer Memory` (prototipo, en memoria del proceso n8n), sessionKey
`workspaceId:userId:threadId` → no mezcla usuarios/workspaces. Producción futura:
Postgres/Supabase Chat Memory con el mismo sessionKey (persistente).

## 11. Webhook
- **Prod URL:** `https://primer-proyecto-prueba-n8n.hvdnby.easypanel.host/webhook/crm-agent-v2`
- **Test URL** (mientras editas): `…/webhook-test/crm-agent-v2`
- Header obligatorio: `x-nowcrm-agent-secret: <N8N_ASSISTANT_V2_SECRET>`.

## 12. Qué NO se tocó
Workflows existentes (ARIZAN/HOLA MUNDO/My workflow/ARCHIVADO), el [MCP TEST] (sigue
inactivo, no borrado), credenciales, runtime del CRM, `.mcp.json`/`.env`. No se
activó ni ejecutó nada.

## 13. Pruebas realizadas
- List antes: 8 workflows. Create OK (id `6mps8YoWu3syldUc`). Read back: active=false,
  22 nodos, 14 tools, chat model sin credencial, webhook `crm-agent-v2`. Re-list: 9
  workflows, los 8 anteriores sin cambios.

## 14. Limitaciones / a verificar en la UI
- Los nodos LangChain se crearon con typeVersions del diseño (agent 1.7 /
  lmChatOpenAi 1.2 / memoryBufferWindow 1.3 / toolHttpRequest 1.1). La API los
  aceptó, pero **abre el workflow en la UI** para confirmar que renderizan sin
  aviso de versión; si tu n8n es más nuevo/antiguo, n8n suele auto-ajustar o pedir
  "update node" (no rompe nada). Revisa también que las expresiones `$fromAI`/
  `jsonBody` de las tools se ven bien.
- Read-only: el agente NO escribe (las tools van a `/api/agent/tool`, que bloquea
  mutaciones con 410).

## 15. Próximo paso EXACTO (tú, en la UI de n8n)
1. Abre `[CRM Inmobiliario] Agent V2 — Read Only`.
2. Conecta la **credencial OpenAI** en el nodo *OpenAI Chat Model*.
3. Configura las **env vars** (`CRM_BASE_URL`, `AGENT_TOOL_SECRET`, `N8N_ASSISTANT_V2_SECRET`).
4. **Execute Workflow** con un payload de prueba (workspaceId real de pruebas +
   header del secret). Verifica la respuesta y los logs `[agent/tool]` del CRM.
5. Pasa los evals (`N8N_AGENT_V2_COMPARISON_EVALS.md`).
6. **Activa** solo cuando esté validado; luego conectamos el CRM Next.js al webhook.

> El CRM debe estar **desplegado con N1.1** (el endpoint `/api/agent/tool` con las
> tools nuevas) para que las 14 tools respondan. Si aún no redeployaste el CRM,
> hazlo antes de probar.

## Veredicto
**N2 COMPLETADO — CRM AGENT V2 CREADO DIRECTAMENTE EN N8N** (vía REST API,
inactivo, 22 nodos, 14 tools, sin credenciales). Pendiente solo lo que requiere la
UI: conectar OpenAI, env vars y probar. Workflows existentes intactos.
