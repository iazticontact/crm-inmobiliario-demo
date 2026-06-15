# CRM Inmobiliario — Roadmap de próximas fases

**Fecha:** 2026-06-15 · **Base:** RT3 verificado (`be73f56`+)
**Política transversal:** [DATA_REALITY_POLICY.md](DATA_REALITY_POLICY.md) aplica a todas.

Estado actual: lectura real conectada (dashboard, clientes, ficha profunda,
operaciones, calendario), demo offline intacta, datos reales verificados
(8/7/7/5/10/8/14). Lo que sigue, en orden de valor/riesgo:

## RT4 — Mutaciones controladas ✅ (RT4 + RT4.2 hechas)
- **RT4 (hecho):** crear/completar/reabrir **tareas** + selector de responsable
  real + activity. Ver [PHASE_2E2_RT4_MUTATIONS_REPORT.md](PHASE_2E2_RT4_MUTATIONS_REPORT.md).
- **RT4.2 (hecho):** crear **operaciones / expedientes / eventos** desde la ficha
  + responsable + activity. Ver [PHASE_2E2_RT4_2_MUTATIONS_REPORT.md](PHASE_2E2_RT4_2_MUTATIONS_REPORT.md).
- **RT4.3 (hecho):** edición inline desde la ficha (operaciones: etapa/valor/
  prob/responsable/cierre; expedientes: estado/prioridad/responsable/venc;
  tareas: prioridad/fecha/responsable/desc; eventos: reprogramar) + activity.
  Ver [PHASE_2E2_RT4_3_EDITING_REPORT.md](PHASE_2E2_RT4_3_EDITING_REPORT.md).
- **Pendiente menor:** borrado desde ficha y vínculos cruzados opcionales.

Notas originales de la fase (referencia):
- Crear/editar tareas, operaciones, expedientes y eventos (helpers de escritura
  ya existen en `vertical-queries.ts`/`supabase-queries.ts`).
- **Responsables (RT2.5 efectivo):** al crear/editar, selector de responsable
  desde `profiles`/`workspace_members`; mostrar nombre, nunca UUID; "Sin asignar".
- Confirmaciones, optimistic UI, toasts; bloqueo en modo demo (solo lectura).
- Registrar `activities` (`source: 'ui_manual'`) por cada mutación.

## RT5 — Assistant tools reales (PARCIAL SEGURA)
- **Hecho:** arquitectura real verificada (READ tools `/api/agent/tool`, PREPARE
  `/api/assistant/v2`, CONFIRM `/api/assistant/confirm` con auth+RLS para
  booking/task/invoice/report), guardrail anti-invención, service_role solo
  server. Añadidas READ tools reales `get_open_operations`/`get_open_service_cases`
  + cableado; neutralizado el último dato de muestra ("Lucía Herrera"). Ver
  [PHASE_2E2_RT5_ASSISTANT_TOOLS_REPORT.md](PHASE_2E2_RT5_ASSISTANT_TOOLS_REPORT.md).
- **RT5.1 (executor hecho):** `/api/assistant/confirm` ejecuta ya 6 acciones CRM
  (create_operation, move_operation_stage, create_service_case,
  update_service_case, update_task, update_calendar_event) con auth+RLS y activity.
  Ver [PHASE_2E2_RT5_1_ASSISTANT_CONFIRMED_ACTIONS_REPORT.md](PHASE_2E2_RT5_1_ASSISTANT_CONFIRMED_ACTIONS_REPORT.md).
- **RT5.1b (create_* hecho end-to-end):** el chat **prepara y confirma**
  `create_operation` y `create_service_case` (vía fallback determinista + confirm-card
  + executor RT5.1), con resolución de cliente/candidatos server-side y demo guard.
  Ver [PHASE_2E2_RT5_1B_IMPL_REPORT.md](PHASE_2E2_RT5_1B_IMPL_REPORT.md).
- **RT5.1b-2 (pendiente):** move_operation_stage/update_task/update_service_case/
  update_calendar_event por chat (executor listo; falta emitir el preparedAction
  desde el agente OpenAI — necesita resolución de IDs).
- Sin promesas de WhatsApp/Meta hasta su fase.

## Arquitectura IA a largo plazo y readiness
- Visión/North star + roadmap IA (Storage/RAG/n8n/MCP/personalidad):
  [AI_ASSISTANT_LONG_TERM_ARCHITECTURE.md](AI_ASSISTANT_LONG_TERM_ARCHITECTURE.md).
- Preparación de deploy (sin desplegar):
  [PRE_HOSTINGER_PRODUCTION_READINESS.md](PRE_HOSTINGER_PRODUCTION_READINESS.md).

## 2E-3 — Storage / documents
- Subida/listado/descarga real de documentos del cliente (bucket privado + RLS).
- La ficha ya tiene la pestaña Documentos preparada (demo bloquea subida).

## 2E-4 — Billing / invoices
- Facturas reales del workspace; PDF desde datos reales; estados es-ES.
- No mezclar con demo; empty states.

## 2E-5 — Inbox / conversations / messages
- Bandeja real (la pestaña "Conversaciones" de la ficha es hoy solo lectura).
- WhatsApp Business (Meta Cloud API) como sub-fase posterior, no antes.

## Transversal / deuda técnica
- RT2.5: nombres de responsable (necesita asignaciones reales).
- Limpieza opcional de `title` de actividades verticales ("Oportunidad" en
  data-layer, no visible en UI).
- Rendimiento dev en Windows/OneDrive: considerar mover el repo fuera de OneDrive
  (ver [PHASE_2E2_RT1_5_UX_PERFORMANCE_REPORT.md](PHASE_2E2_RT1_5_UX_PERFORMANCE_REPORT.md)).
