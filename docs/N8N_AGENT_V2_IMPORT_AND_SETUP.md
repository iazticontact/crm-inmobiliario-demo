# CRM Agent V2 (n8n) — Importar y configurar

> **Fecha:** 2026-06-17 · Workflow: `n8n/workflows/crm-agent-v2-readonly.json` ·
> **READ-ONLY · importar INACTIVO · sin credenciales reales en el JSON.**

---

## 0. Arquitectura (resumen)
- **Cerebro + memoria:** en n8n (AI Agent + Window Memory).
- **Capa de datos:** el endpoint que YA existe en el CRM:
  `POST /api/agent/tool` (auth `x-nowcrm-secret` = `AGENT_TOOL_SECRET`,
  `service_role` server-side, **toda query filtra `workspace_id`**, mutaciones
  bloqueadas con 410). El agente n8n NO toca Supabase directamente → **no hay
  `service_role` en n8n**.
- **Seguridad de entrada:** el Webhook exige el header
  `x-nowcrm-agent-secret` = `N8N_ASSISTANT_V2_SECRET` (nodo "Check secret").
  `workspace_id` se fija desde el payload (NO lo decide el LLM).

## 1. Variables de entorno en n8n (Settings → Variables / o env del contenedor)
Sin valores aquí; configúralas en n8n:
- `CRM_BASE_URL` — URL pública del CRM, p. ej. `https://staging.crm.tudominio.com`.
- `AGENT_TOOL_SECRET` — el MISMO valor que ya tiene el CRM en su env (gate de
  `/api/agent/tool`). No lo pegues en el chat.
- `N8N_ASSISTANT_V2_SECRET` — secreto que tú inventas; lo enviará el CRM en el
  header del webhook (fase siguiente). Genéralo aleatorio.

## 2. Credenciales en n8n
- **OpenAI** (nodo "OpenAI Chat Model"): crea la credencial *OpenAI account* y
  selecciónala (el JSON trae un placeholder `REPLACE_WITH_OPENAI_CREDENTIAL`).
- **Memoria:** el workflow usa *Window Buffer Memory* (en memoria, sin credencial)
  para prototipo. Para producción, cámbiala a *Postgres Chat Memory* apuntando a
  Supabase/Postgres con `sessionKey = workspaceId:userId:threadId` (ya viene ese
  sessionId calculado en "Normalize input").

## 3. Pasos de importación
1. n8n → **Workflows → Import from File** → `crm-agent-v2-readonly.json`.
2. **Déjalo INACTIVO.**
3. Abre "OpenAI Chat Model" → selecciona tu credencial OpenAI.
4. Configura las 3 variables de entorno (sección 1).
5. **Verifica cada tool HTTP** (search_clients, get_client_360, get_crm_overview,
   get_pending_tasks, get_calendar_summary, get_open_operations,
   get_recent_activity, get_documents_metadata): que la URL sea
   `{{$env.CRM_BASE_URL}}/api/agent/tool`, el header `x-nowcrm-secret` use
   `{{$env.AGENT_TOOL_SECRET}}`, y el `jsonBody` mantenga
   `workspace_id` = `{{$('Normalize input').item.json.workspaceId}}` (fijado por
   el request) y los `$fromAI(...)` del input. *(Nota: las expresiones se
   generaron a mano; revisa que n8n las acepta y reajusta si tu versión difiere.)*

## 4. Prueba manual SIN datos sensibles
Con el workflow abierto (no hace falta activarlo), usa "Execute Workflow" con un
payload de prueba en el Webhook (o un POST con el header del secret). Ejemplo de
body (usa un `workspaceId` real de tu workspace de pruebas; el resto inventado):
```json
{
  "message": "Resumen del CRM",
  "workspaceId": "<UUID-de-tu-workspace>",
  "userId": "test-user",
  "threadId": "test-thread",
  "activeEntity": {},
  "requestId": "test-1",
  "timestamp": "2026-06-17T10:00:00Z"
}
```
Header obligatorio: `x-nowcrm-agent-secret: <N8N_ASSISTANT_V2_SECRET>`.
Espera una respuesta JSON `{ "reply": "...", ... }`. Si el agente llama tools,
verás en el log del CRM líneas `[agent/tool] tool=get_crm_overview workspace=… status=200`.

## 5. Activar (solo cuando esté validado)
1. Prueba varias consultas (ver `N8N_AGENT_V2_COMPARISON_EVALS.md`).
2. Cuando responda bien y seguro → **Activar** el workflow.
3. Copia la **Production Webhook URL** y, en la SIGUIENTE fase, conéctala desde el
   CRM (env del CRM en EasyPanel: `N8N_ASSISTANT_WEBHOOK_URL` +
   `N8N_ASSISTANT_V2_SECRET`). Nunca antes de validar.

## 6. Seguridad (checklist)
- [ ] El JSON no contiene secretos (solo `$env`/placeholders). ✅ (verificado)
- [ ] `AGENT_TOOL_SECRET` solo en env de n8n y del CRM, nunca en repo.
- [ ] `workspace_id` se fija desde el payload, no del LLM (evita cruce de tenant).
- [ ] El webhook rechaza requests sin `x-nowcrm-agent-secret` (nodo Check secret).
- [ ] No se loggea el payload completo en producción.
- [ ] Workflow read-only: `/api/agent/tool` bloquea mutaciones (410).

## 7. Próximo paso
Importar → configurar → probar con los evals → activar → conectar el endpoint del
CRM (Next.js) al webhook de producción. La escritura (crear/editar) se diseñará
en una fase posterior (V2 es solo lectura).
