# FASE N1.1 — Endurecer el CRM Agent V2 (n8n) antes de importar

> **Fecha:** 2026-06-17 · **Base:** `30c5205` (N1) → este commit ·
> **Alcance:** cerrar gaps read-only del endpoint `/api/agent/tool`, ampliar el
> workflow n8n importable y reforzar docs/evals. **Toca runtime** (readers +
> route) → requiere **redeploy del CRM** antes de probar n8n. Sin secretos, sin
> mutaciones, sin tocar el asistente V1.

---

## 1. Por qué N1 no era hiperperfecto
N1 dejó el workflow con 8 tools pero con gaps reales: faltaba el cliente
nuevo/último, las operaciones y expedientes **por cliente**, las propiedades y un
resumen de pipeline. Y — crítico — `get_client_360` del endpoint **no
seleccionaba `metadata`**, así que el agente n8n NO podía leer el DNI/NIF (mismo
fallo de S9, pero en el endpoint server).

## 2. Cambios en `/api/agent/tool` (runtime)
**Fix crítico:** `getClient360` ahora selecciona y devuelve `metadata` → DNI/NIF y
campos personalizados llegan al agente.

**5 readers nuevos** en `src/lib/agent-tool-readers.ts` (todos READ-ONLY,
`.eq('workspace_id')` en cada query, strings clampados, errores humanos):
- `getLatestClient` — cliente más reciente (+metadata).
- `getClientOpportunities` — operaciones por `clientId`.
- `getClientServiceCases` — expedientes por `clientId`.
- `getPipelineSummary` — operaciones abiertas agrupadas por etapa (conteo+valor).
- `searchProperties` — cartera por texto/estado/ciudad.

Cableados en `route.ts`: `AllowedTool` + `ALLOWED_TOOLS` + `BrainTool` +
`BRAIN_TOOLS` + `brainResultCount`. La auth (`x-nowcrm-secret`), el workspace
check (UUID en `workspaces`) y el bloqueo de mutaciones (410) **no se tocaron**.

### Matriz de tools del endpoint (read-only)
| tool | tabla | workspace-scoped | límite |
|---|---|---|---|
| get_crm_overview | clients/invoices/events/tasks | sí | — |
| search_clients | clients | sí | 20 |
| get_client_360 (+metadata) | clients(+tasks/cal/conv/docs/activity) | sí | 10/tabla |
| get_latest_client (nuevo) | clients | sí | 1 |
| get_client_opportunities (nuevo) | opportunities | sí | 25 |
| get_client_service_cases (nuevo) | service_cases | sí | 25 |
| get_open_operations | opportunities | sí | 25 |
| get_open_service_cases | service_cases | sí | 25 |
| pipeline_summary (nuevo) | opportunities | sí | 500 (agрега) |
| get_pending_tasks | tasks | sí | sí |
| get_calendar_summary | calendar_events | sí | sí |
| get_recent_activity | activities | sí | sí |
| get_documents_metadata | documents | sí | sí |
| search_properties (nuevo) | properties | sí | 25 |

Nadie devuelve secretos ni `workspace_id`/`score` al usuario final (el prompt lo
prohíbe explícitamente); el `lead_score` sale en datos internos pero no se muestra.

## 3. Cambios en el workflow JSON
`n8n/workflows/crm-agent-v2-readonly.json`: de 8 a **14 HTTP-tools** (añadidas
get_latest_client, get_client_opportunities, get_client_service_cases,
get_open_service_cases, pipeline_summary, search_properties), todas al mismo
endpoint con `workspace_id` fijado del payload y secret de `$env`. 22 nodos,
**inactivo**, sin secretos (solo `$env`/placeholders). Prompt actualizado para
rutear las tools nuevas.

## 4. Prompt V2
Reforzado sin encorsetar: usa tools para datos reales; "No consta" si falta;
nunca inventa ni dice "no tengo acceso"; sin capability spam ni emojis por
defecto; honesto con PDF (solo metadata)/factura (no hay módulo)/WhatsApp; JUICIO
CONVERSACIONAL (pausa/gracias/crítica); **read-only** (no ejecuta escrituras);
"los ejemplos son estilo, no plantillas"; si el usuario cuestiona una frase,
interpreta la intención y no repite la respuesta anterior.

## 5. Active entity / memoria
- Memoria prototipo: `Window Buffer Memory`, sessionKey `workspaceId:userId:threadId`.
- `get_latest_client`/`search_clients` (1 resultado)/`get_client_360` resuelven un
  cliente único → el workflow puede devolver `activeEntityUpdate` (la integración
  Next.js futura lo persistirá). activeOpportunity/Task/ServiceCase = fase futura.
- Producción: Postgres/Supabase Chat Memory con el mismo sessionKey (documentado).

## 6. Seguridad
Endpoint: service_role solo server-side, todas las queries workspace-scoped,
mutaciones 410, secret constant-time. Workflow: `workspace_id` del payload (no
LLM), webhook firmado, secretos solo en `$env`. Repo: sin secretos/PII (verificado).

## 7. Limitaciones de V2
Read-only (no escribe). Documentos: solo metadata (sin RAG). Sin facturación/
WhatsApp/Google. `crm_search` global y active entity multi-tipo = fase futura.

## 8. Validaciones
`tsc --noEmit` ✅ · `eslint --max-warnings=0` ✅ · `next build` ✅ (46 rutas) ·
JSON workflow válido (22 nodos, 14 tools, `active:false`).

## 9. Qué NO se tocó
Asistente V1, `/api/assistant/*`, executor/confirm, n8n productivo, `.mcp.json`/
`.env`, RLS, schema, deps, `git reset`. La auth/workspace/410 del endpoint intactas.

## 10. Próximo paso (exacto)
1. **Redeploy del CRM en EasyPanel** (cambió runtime: el endpoint ya sirve las
   tools nuevas).
2. Importar `crm-agent-v2-readonly.json` en n8n (inactivo).
3. Configurar credencial OpenAI + env vars (`CRM_BASE_URL`, `AGENT_TOOL_SECRET`,
   `N8N_ASSISTANT_V2_SECRET`).
4. Probar con payload manual + header del secret; verificar expresiones de tools.
5. Pasar los 55 evals; activar cuando esté validado; luego conectar el CRM al webhook.

## Veredicto
**N1.1 PARCIAL SEGURO — endpoint y workflow V2 endurecidos y mucho más completos.**
Gap del DNI por cliente cerrado (metadata en get_client_360), +5 readers read-only
(latest client, ops/expedientes por cliente, pipeline, propiedades), workflow a 14
tools, prompt reforzado, 55 evals. Validaciones verdes. Requiere **redeploy del
CRM** antes de probar n8n; import/activación los hace Oier.
