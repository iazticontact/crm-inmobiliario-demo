# Fase 2E-2 RT5 — Assistant tools reales (informe)

**Fecha:** 2026-06-15 · **Base:** `dbf342f` · **Política:** [DATA_REALITY_POLICY.md](DATA_REALITY_POLICY.md)

## 1. Objetivo
Que el asistente sea un agente CRM real: lecturas reales del workspace,
preparación de acciones y ejecución **solo tras confirmación**, sin inventar
datos ni usar service_role en frontend.

## 2. Hallazgo de auditoría — la arquitectura ya existe
El asistente ya implementaba el patrón READ / PREPARE / CONFIRM:
- **READ tools** — `/api/agent/tool` ([route.ts](../src/app/api/agent/tool/route.ts)):
  `get_workspace_summary`, `get_client_summary`, `get_crm_overview`,
  `search_clients`, `get_client_360`, `get_pending_tasks`,
  `get_invoices_summary`, `get_calendar_summary`, `get_recent_activity`,
  `get_conversations_summary`, `get_documents_metadata`. Todas read-only y
  `.eq('workspace_id', …)`. El page las llama vía `callAgentTool` +
  `safeToolByIntent` y las renderiza con `formatToolResult`.
- **PREPARE** — `/api/assistant/v2` ([route.ts](../src/app/api/assistant/v2/route.ts))
  devuelve `preparedAction` (no ejecuta). El page la guarda en estado
  `preparedAction` y muestra card de confirmación.
- **CONFIRM / EXECUTE** — `/api/assistant/confirm`
  ([route.ts](../src/app/api/assistant/confirm/route.ts)) ejecuta **solo tras
  confirmación** con `auth.getUser()` (RLS, no admin ciego) para `booking`
  (evento), `task`, `invoice` y `report`.
- **Guardrail anti-invención** — ya añadido en `buildOperationalPrompt`
  ([ai.ts](../src/lib/ai.ts)) en la fase Data Reality.

## 3. Implementado en RT5 (incremento acotado y seguro)
- **Nuevas READ tools reales** en `/api/agent/tool`:
  `get_open_operations` (operaciones con stage ≠ won/lost) y
  `get_open_service_cases` (expedientes con status ≠ resolved/closed). Read-only,
  workspace-scoped, devuelven arrays renderizables por `formatToolResult`.
  Añadidas a `AllowedTool` + `ALLOWED_TOOLS` (route) y a `AgentToolName`
  ([integrations.ts](../src/lib/integrations.ts)).
- **Cableado en el page** (copilot real): si el mensaje menciona
  operaciones/pipeline/negociación → `get_open_operations`; expedientes/trámite →
  `get_open_service_cases`. Mismo camino seguro (`callAgentTool` →
  `formatToolResult`); si no hay datos, el formateador ya responde "No he
  encontrado resultados…". Cierra el hueco de FASE E #4 y #6.
- **Anti-invención (FASE H):** neutralizado el último dato hardcodeado de muestra
  del asistente — el payload del **botón de test n8n** usaba "Lucía Herrera" /
  "Calle Mayor 14"; ahora "Cliente de prueba" + mensaje de prueba genérico.

## 4. Read tools (resumen)
Cubren: resumen CRM, clientes, cliente 360, tareas pendientes, facturas,
calendario, actividad reciente, conversaciones, documentos, **operaciones
abiertas (nuevo)** y **expedientes abiertos (nuevo)**. Todas RLS/workspace.

## 5. Prepare actions
`/api/assistant/v2` prepara acciones; el page mantiene `preparedAction` y permite
editar/cancelar. No escribe en preparación.

## 6. Confirm executor
`/api/assistant/confirm` ejecuta tras confirmación (booking/task/invoice/report)
con `auth.getUser()` + RLS. Cancelar no escribe. Demo mode no escribe.

## 7. Guardrails anti-invención
- Prompt: nunca inventar; si no hay datos → "No encuentro datos reales en este
  workspace"; ejemplos solo si el usuario los pide o en demo.
- READ tools devuelven datos reales o vacío; `formatToolResult` nunca inventa.
- Sin nombres de muestra hardcodeados ya en el asistente.

## 8. Demo mode
Las escrituras del asistente (confirm) están bloqueadas/no persisten en demo;
el page muestra el modo demo y no trata mocks como reales.

## 9. Seguridad
- `service_role` **solo server-side**: `/api/agent/tool` usa service_role pero
  gateado por `x-nowcrm-secret`/`AGENT_TOOL_SECRET` + verificación de existencia
  del workspace + `.eq('workspace_id')`. **No hay service_role en frontend.**
- `/api/assistant/confirm` usa la sesión del usuario (`auth.getUser()`), respeta
  RLS, no ejecuta sin confirmación.
- No se tocó `.env.local`, Auth, Storage, n8n, Google/WhatsApp, schema.

## 10. Validaciones
| Check | Resultado |
|-------|-----------|
| `npx tsc --noEmit` | ✅ |
| `npm run lint -- --max-warnings=0` | ✅ |
| `npm run build` | ✅ (46 rutas) |

## 11. Smoke test (pendiente Oier — `npm run dev -- --webpack`)
Real (copilot): login owner → preguntar "qué operaciones abiertas hay" / "qué
expedientes abiertos hay" → respuesta con datos reales (o "no he encontrado…");
"qué tareas pendientes tengo" / "resumen del CRM" → datos reales; preparar tarea
→ card; Cancelar → no escribe; Confirmar → escribe y aparece. Sin UUIDs, sin
nombres inventados, sin errores RLS.
Demo: confirmar acción → no escribe ("modo demo").

## 12. Riesgos pendientes / diferido (RT5.1)
- **Confirm-execute para operaciones / expedientes / updates / stage-move desde
  el asistente:** hoy el executor `/api/assistant/confirm` cubre
  booking/task/invoice/report. Extenderlo a operaciones/expedientes y a las
  ediciones (RT4.3) es la continuación — no se hizo en este sprint por tamaño/
  riesgo del executor (522 l) y del page (3369 l) con créditos limitados.
- Wiring de intents más rico (ai.ts) para más preguntas naturales.
- Smoke test navegador pendiente.

## 13. Siguiente fase recomendada
**RT5.1** (confirm-execute de operaciones/expedientes/updates desde el
asistente, reutilizando los helpers RT4.x) o **2E-3 (Storage/documents)**.
