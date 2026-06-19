# FASE N2.1 — Perfeccionar CRM Agent V2 en n8n (arquitectura híbrida + tool universal segura)

> **Fecha:** 2026-06-19 · Instancia: `https://primer-proyecto-prueba-n8n.hvdnby.easypanel.host`
> · Workflow `[CRM Inmobiliario] Agent V2 — Read Only` (id `6mps8YoWu3syldUc`),
> **INACTIVO**, sin credenciales reales. Actualizado por **REST API** (PUT). No se
> tocó ningún otro workflow.

---

## 1. Objetivo
Perfeccionar el Agent V2: decidir la arquitectura de acceso a datos (Supabase
directo vs híbrida), añadir una **tool universal segura** para consultas amplias sin
dar al modelo SQL libre ni `service_role`, y mejorar prompt/memoria/tools. Mantener
el workflow inactivo.

## 2. Auditoría del workflow en vivo (antes)
Leído por REST (`GET /api/v1/workflows/6mps8YoWu3syldUc`):
- `active = false`, 22 nodos.
- `OpenAI Chat Model` (gpt-4o-mini) **sin credencial** (pendiente conectar en UI).
- 14 tools HTTP → `POST {{$env.CRM_BASE_URL}}/api/agent/tool`, header
  `x-nowcrm-secret: {{$env.AGENT_TOOL_SECRET}}`.
- Webhook `Check secret` (IF): `x-nowcrm-agent-secret` == `{{$env.N8N_ASSISTANT_V2_SECRET}}`.
- `Window Memory` sessionKey `{{$('Normalize input').item.json.sessionId}}`
  (`workspaceId:userId:threadId`).
- `workspace_id` **fijado** desde `Normalize input` en cada tool (NO lo decide el LLM).
- typeVersions correctos (agent 1.7 / chat 1.2 / memory 1.3 / toolHttpRequest 1.1).

**Conclusión de la auditoría:** la base era sólida y segura. No requería rehacerse.

## 3. Decisión de arquitectura — HÍBRIDA (Opción C)
Se evaluaron tres caminos:
- **A — Nodo Supabase directo en n8n (rechazado).** Daría al workflow una conexión
  a la base con credenciales en n8n y, peor, abriría la puerta a que el LLM
  construya filtros/consultas. Riesgo de fuga entre tenants y de SQL no controlado.
  Exigiría además crear vistas/RPC blindadas (migración aparte) que NO se aprobó.
- **B — Solo tools específicas (statu quo).** Seguro pero rígido: cada consulta nueva
  exige una tool nueva.
- **C — HÍBRIDA (elegida).** Mantener las tools específicas para lo típico **+**
  añadir UNA tool universal segura (`crm_read_query`) servida por el MISMO endpoint
  read-only del CRM (`/api/agent/tool`), con allowlist de entidades, filtros
  controlados, `workspace_id` fijado en servidor y límite acotado. **El LLM elige
  entidad y texto de búsqueda, NUNCA escribe SQL ni ve `service_role`.**

> No se aplicó ninguna migración SQL. No se añadió ningún nodo Supabase. El acceso a
> datos sigue pasando solo por el endpoint server-side del CRM.

## 4. Tool universal segura `crm_read_query` (servidor)
Implementada en el runtime del CRM, **no** como lógica en n8n:
- **Reader** `crmReadQuery(supabase, workspaceId, input)` en
  `src/lib/agent-tool-readers.ts`.
- **Allowlist de entidades** (`CRM_QUERY_ENTITIES`): `clients`, `opportunities`,
  `service_cases`, `tasks`, `calendar_events`, `properties`, `documents`,
  `activities`. Cada entidad define su tabla, columnas devueltas, campos de búsqueda,
  filtros permitidos, columna de fecha y orden. **Lo no listado no es consultable.**
- **Blindajes:**
  - `workspace_id` **fijado** desde el payload (`.eq('workspace_id', …)` siempre);
    el LLM no puede cambiarlo.
  - `limit` **acotado a 20** como máximo (clamp en servidor).
  - **Sin SQL libre:** el modelo solo manda `entity`, `searchText`, `clientRef`
    (UUID), filtros allowlisted y `dateRange`. El servidor construye la query.
  - `searchText` se **sanea** (se quitan `,()%`) y se aplica como `ilike` solo sobre
    las columnas de búsqueda declaradas por entidad.
  - `clientRef` debe ser UUID válido; si no, se ignora.
  - **Documentos: solo metadata** (título/tipo/fechas), nunca contenido.
  - `sanitizeQueryRow` **elimina `workspace_id`** de la salida y solo incluye
    `metadata` en entidades marcadas `includeMeta` (clientes, para DNI/NIF en campos
    personalizados); strings recortados a 500 chars.
  - Soft-delete respetado (`deleted_at IS NULL`) en clientes/operaciones/expedientes.
- **Endpoint** `src/app/api/agent/tool/route.ts`: `crm_read_query` añadida a la
  allowlist (`ALLOWED_TOOLS`/`BRAIN_TOOLS`) y al conteo de resultados. Sigue siendo
  **read-only** (mutaciones → 410) y exige `x-nowcrm-secret` + `workspace_id`.

> **Importante:** este cambio es de **runtime del CRM**. El CRM debe **redeployarse**
> con N2.1 para que `crm_read_query` responda. Hasta entonces el resto de tools
> funcionan, pero la universal devolvería error de tool desconocida.

## 5. Cambios en el workflow n8n (vía REST PUT)
Actualizado `6mps8YoWu3syldUc` (PUT con `{name, nodes, connections, settings}`,
credencial placeholder eliminada para no inyectar un id de credencial falso):
- **+1 nodo** `crm_read_query` (`toolHttpRequest` v1.1): `POST` al endpoint con
  `tool: "crm_read_query"`, `workspace_id` fijado desde `Normalize input`, e `input`
  con `entity`/`searchText`/`clientRef` vía `$fromAI` (el modelo los rellena).
- **+1 conexión** `ai_tool` de `crm_read_query` → `CRM Agent`.
- **Prompt mejorado (LIBERTAD CONTROLADA):** se añadió la guía de cuándo usar la tool
  específica vs la universal, la lista de entidades permitidas, y "decide tú la mejor
  herramienta; no necesitas permiso para consultar; todo es read-only y limitado a
  este workspace". Se conservaron las reglas previas (no inventar, "No consta",
  nunca mostrar UUID/score, juicio conversacional: pausa breve, dar la razón ante
  crítica, capacidades solo si preguntan).
- Total: **23 nodos**, **15 tools HTTP**.

## 6. Verificación (read-back + re-list)
- **Read-back** `6mps8YoWu3syldUc`: `active=false`, 23 nodos, 15 tools (incluida
  `crm_read_query`), chat model **sin credencial**, prompt contiene `crm_read_query`
  y `LIBERTAD CONTROLADA`, conexión `ai_tool` presente.
- **Re-list:** 9 workflows. Intactos: HOLA MUNDO, ARIZAN x4 (incl. Vapi v3 que sigue
  `active=true` como ya estaba), My workflow, 2 ARCHIVADO y `[MCP TEST]`
  (`ZcHDxvyqaAXL0NIa`, sigue inactivo, **no borrado**).
- **Validaciones runtime CRM:** `tsc` OK, `lint` limpio, `next build`
  **✓ Compiled successfully**.

## 7. Seguridad (checklist)
- ❌ Sin nodo Supabase / sin credencial de BD en n8n.
- ❌ Sin SQL libre del modelo. ❌ Sin `service_role` fuera del servidor.
- ✅ `workspace_id` fijado en servidor (no LLM). ✅ Multi-tenant aislado (`.eq`).
- ✅ `limit ≤ 20`. ✅ Documentos solo metadata. ✅ Salida sin `workspace_id`.
- ✅ Read-only (mutaciones → 410). ✅ Workflow inactivo, sin credencial OpenAI.
- ✅ No se tocó `.env.local`/`.mcp.json`/secretos; no se commiteó ningún secreto.
- ✅ No se activó nada; no se borró nada.

## 8. Pendiente (tú, en n8n / deploy)
1. **Redeploy del CRM** con N2.1 (para que responda `crm_read_query`).
2. En n8n: conectar credencial **OpenAI**; configurar env `CRM_BASE_URL`,
   `AGENT_TOOL_SECRET`, `N8N_ASSISTANT_V2_SECRET`.
3. Probar el webhook con un payload de prueba; pasar los evals.
4. **Activar** solo cuando esté validado.

## Veredicto
**N2.1 COMPLETADO — AGENT V2 PERFECCIONADO (HÍBRIDO + TOOL UNIVERSAL SEGURA).**
Workflow actualizado por REST (23 nodos, 15 tools, inactivo, sin credenciales),
prompt con libertad controlada, y `crm_read_query` blindada en el endpoint
read-only del CRM. Requiere **redeploy del CRM** para que la tool universal
responda. Workflows existentes y el `[MCP TEST]` intactos.
