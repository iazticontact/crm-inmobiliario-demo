# P51 — Mapa real del circuito del Asistente

> Trazado desde el código (no teórico). Sirve para saber exactamente dónde se decide leer, dónde se llama a
> n8n y dónde se impone la política de tools.

## A. Frontend
`src/app/(saas)/assistant/page.tsx` → `POST /api/assistant/v2` con:
`{ message, threadId, lastReferencedClientId/Name, lastResults }`. Las **quick actions** y el chat normal
usan la **misma** ruta (`/api/assistant/v2`). No hay rutas alternativas de chat.

## B. Backend — `/api/assistant/v2`
1. Supabase (SSR, RLS) → `auth.getUser()` → `profiles.workspace_id`.
2. Guards de seguridad/coste (crisis, rate-limit, input).
3. **Provider** (P51): `resolveAssistantProvider({ ASSISTANT_PROVIDER, ALLOW_LEGACY_ASSISTANT })`. Default
   `n8n`; el legacy V1 SOLO si `ALLOW_LEGACY_ASSISTANT=true`.
4. Rama n8n (default):
   - Memoria/contexto (`assistant_agent_memory`, `assistant_messages`).
   - **LOCAL-FIRST**: `tryLocalAnswer(...)` → `decideTurn(message)` (P50) decide el turno; turnos no-datos
     (social/help/capacidad/cómo/futuro/meta/corrección/queja/discrepancia/ambiguo) se responden **sin
     leer** y **sin llamar a n8n**. Traza `[assistant.turn]`.
   - Si local no maneja (lectura compleja): **firma Turn Policy Token** (P51) con la decisión + allowedTools
     y llama a `runN8nAssistant({ …, turn, turnPolicyToken })`.
5. Rama legacy V1 (opt-in, blindada): `runNowLabsAgent` + `deterministic-fallback`.

## C. n8n → `/api/agent/tool`
`runN8nAssistant` (`n8n-assistant-client.ts`) POST al webhook `crm-agent-v2` con
`{ message, workspaceId, …, turn, turnPolicyToken }` (header secreto `x-nowcrm-agent-secret`).
n8n (workflow externo) debe **reenviar** `turnPolicyToken` en `x-nowcrm-turn-policy` a cada llamada a
`/api/agent/tool`. **← ESTE PASO REQUIERE EDITAR EL WORKFLOW DE n8n (ver `AGENT_N8N_CONTRACT.md`).**

`/api/agent/tool` (service-role, server-to-server):
- Auth por `x-nowcrm-secret`.
- **P51 enforcement**: bloquea SIEMPRE `get_invoices_summary`; si hay `turnPolicyToken` → verifica firma/
  expiración + `policyAllowsTool` (dominio + read/write); sin token → en modo estricto
  (`AGENT_TOOLS_REQUIRE_POLICY=true`) rechaza, en compat registra `WARN unscoped_tool_call`.
- Dispatch a readers read-only, workspace-scoped.

## D. Legacy / bypass
- `src/lib/assistant-tools.ts` (V1) consulta `invoices` para KPIs. Solo alcanzable si el provider legacy se
  activa → ahora **requiere `ALLOW_LEGACY_ASSISTANT=true`** (P51). Default: inalcanzable.
- No hay otra ruta de chat que responda directamente. Las escrituras van por `/api/assistant/confirm`.

## Dónde se decide leer
- **App**: `decideTurn` (única fuente). No-datos ⇒ no lectura, no n8n.
- **Backend tool endpoint**: impone la decisión vía Turn Policy Token (no confía en n8n).

## Puntos de imposición (enforcement)
1. App no llama a n8n en turnos no-datos (primario, 100% app).
2. Tool endpoint rechaza `get_invoices_summary` siempre.
3. Tool endpoint rechaza lecturas si el token dice `read=false` o la tool no está permitida.
4. Modo estricto (`AGENT_TOOLS_REQUIRE_POLICY=true`) rechaza tools sin token — **activar tras editar n8n**.
