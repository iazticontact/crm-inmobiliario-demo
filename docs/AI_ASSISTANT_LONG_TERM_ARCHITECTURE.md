# Arquitectura a largo plazo del Asistente IA del CRM

**Fecha:** 2026-06-15 · **Política transversal:** [DATA_REALITY_POLICY.md](DATA_REALITY_POLICY.md)
· **Decisiones de módulo:** [PRODUCT_DECISION_WHATSAPP_META.md](PRODUCT_DECISION_WHATSAPP_META.md),
[PRODUCT_DECISION_BILLING_INVOICING.md](PRODUCT_DECISION_BILLING_INVOICING.md),
[PRODUCT_DECISION_CALENDAR.md](PRODUCT_DECISION_CALENDAR.md)

> **Actualización 2026-06-15:** `OPENAI_API_KEY` ya está **live** (clave real en
> `.env.local`), por lo que el agente puede probarse end-to-end (pendiente smoke
> navegador). El asistente es el **diferenciador "empleado interno"**: lee todo el
> negocio del workspace (Supabase/RLS), prepara y ejecuta-con-confirmación, y a
> futuro leerá documentos (Storage/RAG) y disparará automatizaciones (n8n/Meta).
> La IA **ajusta tono/personalidad pero nunca** se salta seguridad, confirmación
> ni la política de datos reales.

## 1. North star
Este CRM **no es "un CRM con un chat"**. Es un **CRM operativo con un agente IA
interno real** que lee todo el negocio (de Supabase), entiende contexto, propone
acciones, **ejecuta solo con confirmación** y ahorra trabajo real a una
inmobiliaria. Si no hay datos reales, lo dice — nunca rellena con ejemplos.

## 2. Por qué NO if/else
El cerebro ya es un **agente OpenAI real** (`src/lib/agents/nowlabs-main-agent.ts`:
*"OpenAI Responses API + 28 tools sobre Supabase real. Sin n8n, sin service_role,
sin SQL libre"*), con un **fallback determinista** por reglas como red de
seguridad. La lógica de negocio y el razonamiento viven en el CRM/tools, **no en
n8n ni en un árbol de if/else**. n8n es orquestador externo (fase posterior),
no el cerebro.

## 3. Supabase como fuente de verdad
Datos estructurados (RLS, por workspace): clients, properties, opportunities,
service_cases, tasks, calendar_events, activities, profiles, workspaces, y a
futuro invoices, conversations, documents-metadata. El agente lee estos datos con
tools; nunca inventa.

## 4. Tools internas (capa de capacidades)
- **READ:** `/api/agent/tool` (workspace summary, clientes, 360, tareas, facturas,
  calendario, actividad, conversaciones, documentos, **operaciones/expedientes
  abiertos**) — todas `.eq(workspace_id)`, gateadas por `AGENT_TOOL_SECRET`.
- **PREPARE:** el agente emite `PreparedActionDraft` (no escribe).
- **CONFIRM/EXECUTE:** `/api/assistant/confirm` (auth.getUser + RLS) ejecuta
  booking/task/invoice/report + (RT5.1) create_operation, move_operation_stage,
  create_service_case, update_service_case, update_task, update_calendar_event.

## 5. Confirmación (regla de oro)
Ninguna escritura ocurre sin `preparedAction` confirmado por el usuario. PREPARE
solo prepara; CONFIRM ejecuta tras pulsar Confirmar; Cancelar no escribe nada.
Demo no persiste.

## 6. Storage / documentos (futuro — IA-2)
Buckets privados por workspace; tabla `documents` (metadata); uploads por
cliente/expediente/factura; signed URLs; permisos por workspace; auditoría. No
implementado todavía.

## 7. RAG documental (futuro — IA-3/IA-4)
Extracción de texto (PDF/docx/img + OCR si procede) → chunks → embeddings →
vector search **por workspace** → respuestas **con fuentes citadas**, sin leakage
cross-workspace, vía signed URLs. Diseño, no implementación.

## 8. n8n (futuro — IA-6, orquestador externo)
Emails, WhatsApp oficial (Meta), recordatorios, envío de PDFs, webhooks y
automatizaciones programadas. **No es el cerebro.** El razonamiento sigue en el
CRM/tools. El puente CRM→n8n ya existe y está hardened (fire-and-forget,
SSRF-guard, slug allowlist, secreto server-side) y dormido hasta configurar
`N8N_BASE_URL` en el VPS. Estrategia completa:
[N8N_AUTOMATION_STRATEGY.md](N8N_AUTOMATION_STRATEGY.md).

## 9. MCP (desarrollo/auditoría — IA-7)
Supabase/GitHub MCP para desarrollo con Claude/Codex. No mete secretos en el repo,
no toca proyectos legacy, **no sustituye el runtime del producto** (un cliente
final nunca usa MCP). Las cuatro capas (runtime CRM = cerebro · Supabase = verdad
· n8n = brazo externo · MCP = herramienta de dev) están definidas en
[AI_N8N_MCP_RUNTIME_ARCHITECTURE.md](AI_N8N_MCP_RUNTIME_ARCHITECTURE.md).

## 10. Personalidad por workspace (futuro, configurable)
Settings futuros (en `workspaces.settings` o tabla dedicada): `assistant_name`,
`tone`, `emoji_level`, `language`, `formality`, `business_rules`,
`forbidden_actions`, `default_followup_style`, `agency_brand_voice`.
**Reglas:** la personalidad ajusta el tono, **nunca** se salta seguridad,
confirmación ni la política de datos reales; emojis opcionales/configurables; no
hardcodear personalidad global si se puede evitar.

## 11. Seguridad (no negociable)
- `service_role` solo server-side (route handlers); **jamás en frontend**.
- Aislamiento por workspace + RLS en todas las lecturas/escrituras.
- READ tools gateadas por secreto; CONFIRM con sesión real.
- Sin secretos en repo; sin datos inventados; sin fallback a mock en real.

## 12. Roadmap IA por fases
- **IA-CORE (en curso):** agente real + READ + PREPARE + CONFIRM (executor 6
  acciones CRM hecho; wiring conversacional RT5.1b pendiente).
- **IA-2:** Storage/documents. **IA-3:** ingestion/OCR. **IA-4:** RAG con fuentes.
- **IA-5:** asistente documental ("pásame las facturas de X", "resume este
  expediente", "qué campos faltan", "busca el contrato de reserva").
- **IA-6:** n8n automations (email/WhatsApp/recordatorios/PDF).
- **IA-7:** MCP/devops seguro.

## 12b. Persistencia del copiloto interno (HOY) y memoria inteligente (FUTURO)
**Hoy (implementado, H8/H10):** el historial del copiloto vive en tablas
**dedicadas** `assistant_threads` / `assistant_messages` (RLS por workspace, GRANT
solo a `authenticated`), **distintas** de `conversations`/`messages` (Inbox/WhatsApp).
Persisten user+assistant, se reabren y sobreviven al refresh.

**Futuro (DISEÑO, NO implementado — memoria inteligente segura):**
- `assistant_memories`: `workspace_id`, `user_id?`, `memory_type`
  (preference | business_rule | summary | automation_idea), `content`,
  `source_thread_id`, `confidence`, `approved bool`, `created_at`.
- `assistant_thread_summaries`: `thread_id`, `workspace_id`, `summary`,
  `key_entities`, `next_actions`, `updated_at`.
- Comportamiento: resumir hilos largos cada X mensajes; guardar preferencias/
  reglas de negocio útiles (no datos sensibles innecesarios); usar memorias como
  **contexto ligero**, no verdad absoluta; permitir editar/borrar; **pedir
  confirmación** para memorias importantes.
- **Autoevaluación segura:** registrar fallos, consultas sin respuesta y acciones
  canceladas → generar **"sugerencias para el equipo técnico"**.
- **REGLA DE ORO:** el asistente **NUNCA** auto-modifica código, schema, prompts
  ni automatizaciones; solo **propone** (con confirmación). Nada de auto-mejora
  autónoma. n8n sigue siendo orquestador externo futuro, no el cerebro.

## 13. Qué NO construir todavía
Storage real, RAG runtime, n8n real, WhatsApp/Meta, Google OAuth, billing nuevo,
inbox/conversations. Solo diseño/roadmap.

## 14. Checklist para futuras features del asistente
- [ ] ¿Lee datos reales (Supabase/RLS) y no inventa?
- [ ] ¿Si no hay datos, lo dice ("No encuentro datos reales en este workspace")?
- [ ] ¿Resuelve entidades reales (con candidatos si ambiguo), sin UUIDs en UI?
- [ ] ¿PREPARE no escribe; CONFIRM solo tras confirmación?
- [ ] ¿Demo no persiste y lo indica?
- [ ] ¿Sin service_role en frontend; workspace-scoped; RLS?
- [ ] ¿Activity best-effort que no rompe la acción principal?
- [ ] ¿tsc/lint/build verdes?

---

## N3 — Cerebro = n8n Agent V2 (V1 retirado del runtime) · 2026-06-20
El cerebro del asistente del CRM pasa a ser el **n8n Agent V2** (read-only).
`/api/assistant/v2` enruta por un adapter server-only `src/lib/agents/n8n-assistant-client.ts`
al webhook `/webhook/crm-agent-v2` (cabecera `x-nowcrm-agent-secret`), con `threadId` para
memoria por conversación. Selector `ASSISTANT_PROVIDER` (default `n8n`; `openai/v1/local`
= rollback). **Sin fallback silencioso**: si n8n falla, error humano, nunca el V1.
El V1 (`runNowLabsAgent` + deterministas) queda **legacy** tras el flag (candidato a
cleanup). El executor de escrituras `/api/assistant/confirm` se mantiene intacto para la
futura fase de escritura (preparar+confirmar; n8n no escribe). Ver
`PHASE_N3_CONNECT_CRM_TO_N8N_AGENT_V2_REPORT.md`.

---

## N4 — Memoria pro + cobertura CRM total · 2026-06-21
Memoria de trabajo persistente: tabla `assistant_agent_memory` (entidad activa/previa por
hilo, RLS workspace+usuario, SOLO referencias —sin DNI/email/tel—, escrita por el SERVIDOR
`/api/assistant/v2`, nunca el LLM). Helper `src/lib/agents/assistant-agent-memory.ts`. El
route fija `activeEntity` (+`previous` para "el anterior"). Cobertura: `crm_read_query`
(n8n) ahora envía `searchText`/`clientRef`/`filters` → búsqueda por texto en las 8 entidades
(el server ya lo soportaba). `lead_score` blindado: `stripInternalFields` en `/api/agent/tool`
(el LLM nunca lo ve) + prompt. Suite `docs/evals/agent-v2-crm-evals.json` (105) + runner
`run-agent-evals.mjs` (dry-run, redacta PII). Modelo gpt-4.1-mini@0.2. Ver
`PHASE_N4_AGENT_V2_PRO_MEMORY_AND_FULL_CRM_INTELLIGENCE_REPORT.md`.
