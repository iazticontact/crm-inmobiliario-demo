# Phase 2E-2 H9 — Assistant full CRM intelligence coverage

> **Fecha:** 2026-06-16 · **Base:** `27432fd` · El cerebro sigue en el CRM (no n8n).
> Sin `.env.local`, sin service_role en frontend, sin SQL libre del modelo, sin
> escribir sin confirmación. READ/intelligence coverage.

## 1. Objetivo
Asegurar que el copiloto puede consultar TODO el CRM **actual** en lenguaje
natural vía tools reales y seguras (workspace-scoped, RLS), sin if/else ni inventar.

## 2. Auditoría — cobertura ANTES (hallazgo clave)
El agente (`nowlabs-main-agent.ts`) **ya tenía ~40 tools** cubriendo casi todo el
CRM. **No** había que construir 12 tools nuevas (habría sido duplicar). Gaps reales
detectados: (a) **no había tool de actividad real** — el agente solo tenía
`recent_messages`/`recent_conversations` (Inbox, diferido y vacío), pero **no
exponía** el reader `getRecentActivity` que lee `public.activities` (14 filas
reales); (b) **no había política off-topic** en el system prompt.

## 3. Cobertura por dominio (DESPUÉS)
| Dominio | Tools (read) | ¿Cubierto? |
|---|---|---|
| workspace/summary | `crm_overview`, `workspace_overview`, `list_pending_items`, `recommended_actions`, `automation_recommendations` | ✅ |
| clients | `list_clients`, `search_clients`, `select_client_by_ordinal`, `hot_leads`, `get_client_context`, `latest_clients`, `oldest_client` | ✅ |
| properties | `list_properties` | ✅ |
| operaciones (opportunities) | `list_opportunities` | ✅ |
| expedientes (service_cases) | `list_service_cases` | ✅ |
| tasks | `pending_tasks` | ✅ |
| calendar_events | `upcoming_events`, `search_calendar_events`, `check_calendar_conflicts` | ✅ |
| **activities** | **`recent_activity` (NUEVO en H9)** | ✅ (antes ❌) |
| acciones (prepare→confirm) | `prepare_booking/task/invoice`, `prepare_reschedule/cancel/cleanup`, `create_opportunity`, `update_opportunity_stage`, `create_service_case`, `update_service_case_status`, `create_property`, `update_property_status` | ✅ |
| invoices (futuro) | `pending_invoices`, `overdue_invoices` (sin tabla → vacío) | ⏳ futuro |
| conversations/whatsapp (futuro) | `recent_messages`, `recent_conversations`, `summarize_inbox_status` (Inbox diferido) | ⏳ futuro |
| documents/storage (futuro) | `getDocumentsMetadata` (reader; sin tabla) | ⏳ futuro |

## 4. Tools existentes
~40 (ver §3). Read + prepare/confirm. Todas workspace-scoped, RLS, sin SQL libre.

## 5. Tools nuevas / ajustadas (H9)
- **`recent_activity`** (NUEVO): wrapper `toolRecentActivity` en `assistant-tools.ts`
  (lee `public.activities`, workspace-scoped, RLS, read-only, límite 15) + tool def
  + dispatch en el agente + import. Resuelve "qué ha pasado recientemente" con
  datos REALES (antes leía Inbox vacío).
- Reutiliza helpers existentes; cero duplicación de la lógica de otros dominios.

## 6. Dominios cubiertos vs. futuros
- **Cubiertos hoy:** workspace, clients, properties, operaciones, expedientes,
  tasks, calendar, activities, acciones confirmadas.
- **Futuros (documentados, NO en H9):** invoices (facturación), documents/storage
  + RAG, conversations/messages (Inbox/WhatsApp Meta). Sus tools existen pero
  devuelven vacío hasta que existan tablas/integración.

## 7. Personality / off-topic
- **Personalidad:** ya reforzada en H8 (majo/cercano "compañero de equipo", emoji
  ligero, anti-relleno) en el agente y el fallback. Se mantiene.
- **Off-topic (NUEVO H9):** sección "ALCANCE (CRM del negocio)" en el system
  prompt: si la petición es claramente fuera del negocio (recetas, cultura general,
  código…), responde 1 frase amable, reconduce al CRM y **no llama tools** (ahorra
  tokens). No ser borde.

## 8. Arquitectura (no cambia)
User → `/api/assistant/v2` → agente OpenAI → tools internas → Supabase/RLS →
respuesta grounded → preparedAction → confirm card → `/api/assistant/confirm`.
n8n NO participa. Sin SQL libre del modelo; tools con allowlist server-side.

## 9. Eval suite
`docs/ASSISTANT_CRM_INTELLIGENCE_EVALS.md` — **46 evals** (clientes 8, operaciones
8, expedientes 6, tareas 6, calendario 5, actividad/resumen 5, acciones 4,
negativos/off-topic 4), cada una con prompt, tools esperadas, criterio de aprobado.

## 10. Smoke (pendiente navegador, Oier)
Ejecutar §11 de evals + el smoke READ/ACTIONS/NEGATIVE del prompt. A nivel código:
tool nueva cableada y validada (tsc/lint/build verdes). Recomendado verificar A1
("qué ha pasado recientemente" → debe listar actividades reales, no "nada").

## 11. Qué NO se tocó
Cerebro (flujo v2/confirm), executor de escritura, n8n, WhatsApp/Inbox, Storage,
Google, facturación, `.env.local`, service_role frontend, RLS, schema (no migración
en H9), demo. No se duplicaron tools existentes.

## 12. Validaciones
`tsc --noEmit` ✅ · `eslint --max-warnings=0` ✅ · `next build` ✅ (46 rutas).

## 13. Riesgos / próximo paso
- **Opcional futuro:** `crm_global_search` (búsqueda cross-dominio agrupada) y
  tools de detalle por entidad (`get_operation_detail`/`get_service_case_detail`);
  hoy se cubren con `list_*` + `get_client_context`. No bloquean.
- **Próximo:** smoke navegador con la suite de evals; luego facturación/Storage/RAG
  añadirán sus tools cuando existan sus tablas.

## 14. Veredicto
**H9 COMPLETADO — ASSISTANT FULL CRM CORE COVERAGE.** Todos los dominios del CRM
actual son consultables en lenguaje natural vía tools reales; añadida la tool de
actividad real (gap) y la política off-topic; eval suite de 46 casos; sin tocar el
cerebro/n8n ni inventar datos.
