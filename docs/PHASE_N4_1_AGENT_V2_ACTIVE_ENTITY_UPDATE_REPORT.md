# FASE N4.1 — Persistir entidades resueltas por el Agent V2 (`activeEntityUpdate`)

> **Fecha:** 2026-06-21 · HEAD previo `9b776fd` · Workflow n8n `6mps8YoWu3syldUc`
> (ACTIVO, `gpt-4.1-mini`@0.2). Toca runtime CRM (`src/`) + **migración** → requiere
> **redeploy del CRM**. Sin tocar `.env.local`/`.mcp.json`/secretos, workflows antiguos,
> Google/WhatsApp, escrituras de negocio, SQL libre. La memoria la escribe el SERVIDOR,
> nunca el LLM.

---

## 1. Gap que se cerró
N4 persistía la entidad activa que enviaba la UI, pero cuando el agente resolvía una
entidad por nombre dentro de n8n ("Dame datos sobre Oier") esa entidad solo vivía en la
Window Memory, no se persistía en `assistant_agent_memory`. N4.1 hace que el Agent V2
**devuelva `activeEntityUpdate`** y el CRM lo **persista** → "su / este cliente / el
anterior / qué operaciones tiene" funcionan también con memoria persistente.

## 2. Diseño elegido (Opción B — robusta y sin tocar la naturalidad)
**Un nodo Code "Build Response" deriva `activeEntityUpdate` de los DATOS REALES de las
tools, NO del texto del LLM.** Se activó `returnIntermediateSteps` en el AI Agent →
su salida incluye `intermediateSteps: [{action:{tool,toolInput}, observation}]` con el
JSON real de cada tool. El nodo recorre esos pasos y, con regla de **resultado único
claro**, decide la entidad activa:
- `get_client_360` / `get_latest_client` → `result.client` → client.
- `search_clients` → si **1** resultado → client (si varios/ninguno → no persiste).
- `search_properties` / `get_documents_metadata` → si 1 → property / document.
- `crm_read_query` → si 1 fila → su `entity`.
- `get_client_opportunities` / `get_client_service_cases` → mantienen el client activo.

El usuario **solo ve texto natural** (`reply`); el `activeEntityUpdate` viaja
server-to-server. Descartada la Opción A (pedir JSON al LLM) por frágil.

Salida del workflow: `{ reply, usedTools, activeEntityUpdate:{type,id,label,source,confidence}|null, ... }`.

## 3. Cambios en n8n
- AI Agent: `returnIntermediateSteps = true`.
- Nuevo nodo **Build Response** (`n8n-nodes-base.code`) entre `CRM Agent` y
  `Respond to Webhook`; deriva `activeEntityUpdate` + `usedTools` de `intermediateSteps`.
- `Respond to Webhook`: usa la salida de Build Response (`reply`/`usedTools`/`activeEntityUpdate`).
- Prompt (+1 línea, ~4938 chars): "ese/este" referido a propiedad/documento/operación →
  `activeEntity.recent`. (El LLM NO genera el JSON; lo deriva el nodo.)

## 4. Cambios en el CRM
- `n8n-assistant-client.ts`: el tipo `activeEntity` admite `previous` y `recent`; el
  adapter ya normaliza `activeEntityUpdate` de la respuesta.
- `assistant-agent-memory.ts` reescrito: slots **por tipo** (`active`/`previous` por
  `entity_type`), `loadThreadMemory` devuelve `client` + `previousClient` + `recent`
  (no-cliente más reciente), `validateActiveEntityUpdate` (type permitido + UUID).
- `/api/assistant/v2`: construye `activeEntity` (cliente activo + previous + recent) para
  enviar a n8n y, **tras** la respuesta, persiste con `saveActiveEntity` la entidad que el
  agente resolvió (`validateActiveEntityUpdate(n8n.activeEntityUpdate)`), con fallback al
  cliente de la UI. Escritura server-side, fail-soft.

## 5. Memoria active / previous (migración `20260621_n4_1`)
Slots **por tipo**: índice único parcial `(thread_id,user_id,entity_type)` para
`active_entity` y para `previous_entity`. Así resolver una propiedad/documento **no
machaca** el cliente activo (regla 6). Al cambiar el activo de un tipo, el anterior pasa
a `previous` de ese tipo → "el anterior" (cliente). Verificado por MCP: client+property
activos coexisten; duplicado del mismo tipo bloqueado por el índice.

## 6. Seguridad
Solo **referencias** (type/id/label), nunca DNI/email/teléfono. RLS por workspace+usuario;
escritura solo server-side (nunca el LLM). `validateActiveEntityUpdate` exige type
permitido + UUID; el id ya es workspace-scoped (solo puede venir de una tool
workspace-scoped). UUIDs nunca se muestran al usuario (regla del prompt + sanitizado).
Sin secretos/PII en el diff.

## 7. Evals (ejecutados en vivo)
- **`active_capture` 4/4** (hilos frescos, determinista): "Dame datos sobre Oier" →
  `activeEntityUpdate` client; "último cliente" → client; "Hola" → null; "pipeline" → null
  (no machaca memoria).
- **`memory_chain` 7/7**: Oier → su DNI → busca Soler → vuelve al anterior → qué
  operaciones → busca propiedades → su email. El runner **simula la persistencia del
  route** (arrastra `activeEntityUpdate` al siguiente turno) → certifica persist/recall
  contra el agente real **sin redeploy**. Continuidad correcta; la propiedad no machaca
  al cliente activo.
- Regresión 15/15. Suite total **116 casos**. Runner: dry-run sin env, redacta PII,
  hilos únicos por run (Window Memory fresca).

> Nota honesta: gpt-4.1-mini a veces responde desde Window Memory sin re-llamar a una
> tool → en ese turno no emite `activeEntityUpdate` (correcto: la entidad no cambió). La
> emisión se certifica en turnos de resolución limpia (`active_capture`).

## 8. Validaciones
`tsc` ✅ · `lint --max-warnings=0` ✅ · `build` ✅. Migración aplicada+verificada (índices,
coexistencia por tipo). Workflow read-back (24 nodos, Build Response, returnIntermediateSteps,
gpt-4.1-mini). Backup sincronizado.

## 9. Archivos tocados
- NUEVO `supabase/migrations/20260621_n4_1_agent_memory_per_type_active.sql`
- `src/lib/agents/assistant-agent-memory.ts` (reescrito, por tipo + validate)
- `src/app/api/assistant/v2/route.ts` (persiste activeEntityUpdate, recall por tipo)
- `src/lib/agents/n8n-assistant-client.ts` (tipo activeEntity +previous +recent)
- `docs/evals/agent-v2-crm-evals.json` (+memory_chain, +active_capture) +
  `docs/evals/run-agent-evals.mjs` (simula memoria + lee activeEntityUpdate)
- `n8n/workflows/crm-agent-v2-readonly.json` (backup: Build Response) + docs

## 10. Limitaciones pendientes
- **No hay readers get-by-id para no-clientes** → `activeEntity.recent` permite REFERIR
  la propiedad/documento por label, pero re-leer su detalle por id requiere readers 360
  por entidad (fase futura). El cliente sí tiene `get_client_360(clientId)` → detalle
  completo.
- "vuelve al anterior" respondido sin tool no refresca `activeEntityUpdate` (lo cubre la
  Window Memory en sesión; en frío, el activo se recupera del último turno de resolución).
- Full E2E desde `/assistant` requiere **redeploy del CRM** (runtime + migración).

## Veredicto
**N4.1 COMPLETADO — RESOLVED ENTITY MEMORY PERSISTED.** El Agent V2 devuelve
`activeEntityUpdate` derivado de datos reales de tools (no del texto), el CRM lo persiste
por tipo en `assistant_agent_memory` (sin PII, RLS, server-side) y lo recuerda
(activo/previo/recent). Certificado en vivo (active_capture 4/4, memory_chain 7/7,
regresión 15/15). `gpt-4.1-mini`@0.2. tsc/lint/build verdes. **Requiere redeploy del CRM**
para el E2E desde `/assistant`.
