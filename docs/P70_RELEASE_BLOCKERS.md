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

## ✅ Wave B COMPLETA — 2026-07-14 (Playwright E2E real contra staging, 9/9 PASS)
- **Infra**: `playwright.config.ts` (workers=1, staging por defecto, `E2E_BASE_URL` overrideable),
  proyecto `setup` (login REAL por UI con credenciales QA de `.auth/`, storage state con las cookies
  exactas de @supabase/ssr), proyectos `chromium` (desktop) y `mobile` (Pixel 7). `npm run test:e2e`.
- **Specs** (`e2e/`): smoke sesión real · card de acción preview→Cancelar (BD intacta) ·
  Confirmar→aplicado y verificado (BD real cambia; restauración fixture) · persistencia tras refresh
  (card desde metadata.ui con botones activos) · **multitab** (2ª pestaña ve card y su resolución SIN
  recargar, vía BroadcastChannel) · automatización Descartar (neutraliza, cero `[AUTO:` visible) y
  Activar (regla real programada) · findings (card → centro con filtros aria-pressed y carga RLS ok) ·
  móvil (card operable, sin scroll horizontal). Fixtures QA server-side + cleanup verificado por SQL
  (precio restaurado, 0 reglas residuales, 0 pending actions, hilos QA borrados).
- **Bugs reales encontrados y corregidos por la suite**:
  1. **GRANT faltante** (migración `20260714_p70_grant_authenticated_assistant_agentic_tables.sql`,
     aplicada al proyecto real): las policies RLS de SELECT existían pero `authenticated` no tenía GRANT
     en `assistant_actions/findings/automation_rules/automation_runs` → `executeUiAction` no encontraba
     la fila, el centro de findings no cargaba y el confirm textual P66 desde navegador estaba roto
     (latente: los E2E previos usaban service key).
  2. Carrera al crear consulta (mensaje al hilo viejo) — cubierta en spec (espera del toast de creación).
  3. Rate limit real 10 req/min incluye botones — pacing global de 7s entre peticiones en la suite.
- **Deploy**: staging sirve `2026-07-14.p70` (verificado vía /api/agent/diag).

## ⛔ Abierto (P70 los exige todos; ninguno se declara "límite" — son trabajo pendiente)
| # | Ítem | Prio |
|---|---|---|
| 1 | Catálogo ≥15 acciones + ≥1 por módulo editable (hoy 7; faltan calendar/operations/cases) | P1 |
| 2 | Cambio conversacional de horario («cámbialo a las 9») + runners de más tipos de automatización | P1 |
| 3 | Benchmark 750+ con held-out + metamórficos + mutation checks | P1 |
| 4 | Fábrica de regresiones (manifest) + chaos + red-team 75+ | P1 |
| 5 | N8N runtime map nodo a nodo + limpieza + [P70] prompt | P2 |
| 6 | Observabilidad/diagnóstico, rendimiento, mantenimiento, rollback runbook | P2 |
| 7 | Acciones sobre findings desde el centro (resolver/reconocer) — hoy el centro es lectura + chat | P2 |

## Cómo continuar (siguiente sesión)
1. Ampliar registro de acciones (patrón P65/P67 probado) módulo a módulo, con su card ya gratis
   (el contrato UI y las cards son genéricos por action_type).
2. Runners de automatización adicionales sobre el dispatcher P68 + cambio conversacional de horario.
3. Benchmark/regresiones/red-team (waves C-D).

**Verdes hoy:** tsc/lint/build · P66 11/11 · P67 8/8 · P68 7/7 · P69 8/8 · P70 ui-contract 15/15 ·
**Playwright 9/9 contra staging p70** · n8n 15/15+5 con policy.
