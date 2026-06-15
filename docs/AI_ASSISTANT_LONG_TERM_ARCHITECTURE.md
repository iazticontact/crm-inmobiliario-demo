# Arquitectura a largo plazo del Asistente IA del CRM

**Fecha:** 2026-06-15 · **Política transversal:** [DATA_REALITY_POLICY.md](DATA_REALITY_POLICY.md)

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
CRM/tools.

## 9. MCP (desarrollo/auditoría — IA-7)
Supabase/GitHub MCP para desarrollo con Claude/Codex. No mete secretos en el repo,
no toca proyectos legacy, no sustituye el runtime del producto.

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
