# P70 — RELEASE BLOCKERS (estado honesto)

**Veredicto de fase: `P70 NOT COMPLETE`** — el spec exige el alcance completo simultáneo y prohíbe el
cierre por vertical. Con la capacidad de esta sesión se ha resuelto el bloqueo P1 más antiguo
(TEST_SESSION_MISSING) y verificado el estado; el resto queda ABIERTO y listado aquí sin maquillaje.

## ✅ Resuelto en esta sesión
| Ítem | Estado |
|---|---|
| Preflight (repo limpio HEAD P69, n8n activo 15+5 tools, staging p69, strict) | ✅ verificado |
| **TEST_SESSION_MISSING (P1 histórico)** | ✅ **RESUELTO**: `scripts/p70-create-qa-session.mjs` — usuario QA idempotente (`qa.p70.assistant@nowcrm-qa.test`) vía service-role **solo en script local**, membresía `workspace_members` rol `comercial` (descubierto: el RLS real usa `current_workspace_ids()` → workspace_members, NO profiles), sesión real emitida (`signInWithPassword`), **RLS verificado con la sesión QA (clients=9)**, storage en `.auth/` **git-ignored** (añadido a .gitignore), sin credenciales impresas ni commiteadas |
| Hallazgo de auditoría documentado | El rol de membresía tiene CHECK (`owner/admin/comercial/solo_lectura`); `profiles.workspace_id` NO gobierna el RLS de datos |

## ✅ Wave A COMPLETA — 2026-07-14 (commit «P70 wave A complete agentic UI»)
- **Contrato UI compartido** `src/lib/assistant/ui-contract.ts` (kinds/estados/acciones + validador
  runtime; inválido → null → fallback textual, el chat nunca rompe).
- **Emisión estructurada backend** (`LocalAnswer.ui`): acciones (`action_preview`/`action_result`/
  `action_status`), automatizaciones (`automation_preview`/`automation_result`/`automation_status`)
  y findings (`finding` con criterio separado). La route `/api/assistant/v2` expone `ui` validado.
- **Cards frontend** (componentes puros en `assistant/page.tsx`): `AssistantActionCard` (estados +
  Confirmar/Cancelar/Modificar), `AssistantAutomationCard` (Activar/Descartar como quick-reply del
  flujo P69 probado), `AssistantFindingsCard` (severidades + link al centro). Cero parsing de texto.
- **Botones por actionId**: el navegador envía SOLO `{uiAction, actionId, threadId}`;
  `executeUiAction` (server) carga la fila real por RLS/workspace, re-firma el token y reutiliza el
  plano P65. Nunca se aceptan proposedChanges del cliente; `[ui:*]` jamás llega al cerebro general.
- **Persistencia + refresh**: `ui` viaja en `assistant_messages.metadata.ui`; `listThreadMessages` lo
  recupera y las cards se repintan tras refresh. Mensajes antiguos/ui inválido → solo texto.
- **Multitab seguro**: BroadcastChannel notifica el threadId; la pestaña receptora RELEE de BD con su
  sesión (RLS). Previews cuya acción ya se resolvió ocultan botones (`resolvedActionIds`); el doble
  confirm está probado idempotente (no re-aplica).
- **Automatización neutralizable**: descartar un preview deja `[AUTO:cancelled]` (y activar deja
  `[AUTO:done]`) — un «confirma» posterior NO re-activa nada (`lastLiveAutoPreview`).
- **Centro visual de findings** `/assistant/findings`: dashboard de conteos, filtros por estado y
  severidad, criterio objetivo en claro, lectura directa con RLS (policy verificada), estados vacíos.
- **Higiene visible**: sin JSON/UUID/tokens/stacks; `[AUTO:…]` y `**` se ocultan al renderizar.
- **Verificado**: tsc/lint/build ✅ · P66 11/11 ✅ · P67 8/8 ✅ · P68 7/7 ✅ · P69 8/8 ✅ ·
  **nuevo P70 UI-contract E2E 15/15** (`scripts/p70-ui-contract-e2e.mts`).

## ⛔ Abierto (P70 los exige todos; ninguno se declara "límite" — son trabajo pendiente)
| # | Ítem | Prio |
|---|---|---|
| 1 | Wave B: Playwright E2E con `.auth/qa-session.json` (smoke staging + cards/refresh/multitab/mobile) | P1 |
| 2 | Catálogo ≥15 acciones + ≥1 por módulo editable (hoy 7; faltan calendar/operations/cases) | P1 |
| 3 | Cambio conversacional de horario («cámbialo a las 9») + runners de más tipos de automatización | P1 |
| 4 | Benchmark 750+ con held-out + metamórficos + mutation checks | P1 |
| 5 | Fábrica de regresiones (manifest) + chaos + red-team 75+ | P1 |
| 6 | N8N runtime map nodo a nodo + limpieza + [P70] prompt | P2 |
| 7 | Observabilidad/diagnóstico, rendimiento, mantenimiento, rollback runbook | P2 |
| 8 | Acciones sobre findings desde el centro (resolver/reconocer) — hoy el centro es lectura + chat | P2 |

## Cómo continuar (siguiente sesión)
1. Wave B: `node scripts/p70-create-qa-session.mjs` (regenera sesión si expiró) → `npm i -D @playwright/test`
   → specs con `storageState: '.auth/qa-session.json'` contra staging (cards, botones, refresh, multitab,
   mobile, automatizaciones, findings) + fixtures QA con cleanup.
2. Ampliar registro de acciones (patrón P65/P67 probado) módulo a módulo.
3. Runners de automatización adicionales sobre el dispatcher P68.

**Verdes previos re-verificados hoy:** n8n 15/15+5 con policy, staging `2026-07-14.p69`.
