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

## ✅ Wave C COMPLETA — 2026-07-14 (catálogo multimódulo: 21 acciones, 6 módulos editables)
- **Registro ampliado** (`action-registry.ts`): 7 → **21 acciones supported** — clients (5: phone, email,
  name, note, status), portfolio (4: price, status, notes, zone), tasks (6: create, complete, reopen,
  due_date, priority, title), calendar (2: create, reschedule), operations (2: change_stage,
  update_value), cases (2: update_status, update_due_date). Matriz OPERATION_TRANSITIONS (won final,
  lost reactivable) + enums REALES auditados en BD (CHECKs de clients.status, tasks.status,
  calendar_events.type; vocabulario canónico del resto).
- **Unsupported con causa**: clients.update_tax_id y update_nationality (columnas inexistentes,
  auditado information_schema). Ver `P70_ACTION_CATALOG.md`.
- **Executor endurecido**: validaciones semánticas por acción (rangos, enums, transiciones, evento
  Google read-only rechazado, valor de operación cerrada bloqueado por comisiones, reopen solo
  done→pending) + verify read-after-write con igualdad normalizada de timestamps.
- **Parsers composicionales** con orden anticolisión (operations antes que precio; reopen antes que
  complete) + calendario con composición server-side de start_at/end_at en Europe/Madrid (la app
  filtra por start_at — auditado en supabase-queries).
- **Suites nuevas**: parser tests **48/48** (incl. 13 lecturas que jamás se convierten en acción) ·
  action catalog E2E **46/46** (ciclo completo por módulo + invariantes + cleanup verificado) ·
  **grants check 12/12** con sesión authenticated real (check permanente anti-regresión del GRANT) ·
  Playwright `assistant-actions-modules.spec.ts` (calendar/operations/cases por UI).
- Regresiones: P66 11/11 · P70 UI 15/15 · tsc/lint/build ✅.
- **Verificado contra STAGING desplegado** (commit `7ea02be`): action catalog E2E **46/46** con el plano
  remoto + Playwright módulos nuevos **4/4** (calendar/operations/cases por UI real, BD verificada).

## ✅ Wave D COMPLETA — 2026-07-14 (automation catalog + scheduler hardening)
- **Registry único** (`findings-engine.ts` · `AUTOMATION_RULES`): **11 tipos con runner REAL** cada uno
  (fuentes reales, partial handling, resultado estructurado, findings con dedupe por fingerprint
  compartido — data_quality_watch es la auditoría canónica, sin alias duplicados). QA filtrado de
  findings de negocio. Ver `P70_AUTOMATION_CATALOG.md`.
- **Scheduler endurecido** (`/api/agent/automation` + `automation-schedule.ts`): claim atómico por
  ventana (unique verificado), catch-up anti-tormenta (1 ventana + run `skipped` auditado),
  recuperación de colgados (>15min → AUTOMATION_TIMEOUT), `computeNextRunMadrid` con offset REAL por
  fecha (DST primavera/otoño verificados), daily/weekdays/weekly + minutos («a las 8:30»), enable
  recalcula next_run_at. Ver `P70_SCHEDULER_HARDENING.md`.
- **Edición conversacional con preview**: prepare/confirm_update_rule (hash liga confirmación al estado
  leído; conflicto → 409). «Cámbialo a las 9» · «ponlo a las 8:30» · «solo de lunes a viernes» ·
  «todos los lunes» (o rechazo honesto si la frecuencia no está permitida) · pausa/reactiva ·
  «ejecuta ahora» (idempotente por minuto; en pausa → bloqueado) · «¿cuándo se ejecuta?» ·
  configuración · última ejecución · historial (sin UUIDs). Botones de card: Ejecutar ahora / Ver
  ejecuciones / Pausar / Reactivar (quick replies del mismo plano).
- **Migración aplicada+commiteada**: CHECK 3→11 tipos + status `skipped`.
- **Suites**: automation catalog **33/33** (11 tipos ciclo completo + conversacional) · scheduler chaos
  **32/32** (DST, concurrencia, catch-up, colgados, cross-workspace) · Playwright
  `assistant-automations.spec.ts` (staging tras deploy). Regresiones: P66 11/11 · P68 7/7 · P69 8/8 ·
  P70 UI 15/15 · parser 48/48 · action catalog 46/46 · grants 12/12 · tsc/lint/build ✅.
- **Bugs reales cazados por las suites**: skew reloj local vs now() de Postgres que dejaba residuos
  fuera del cleanup (margen 2min + deletes con error-check) · handler de ventas secuestraba «activa la
  reconciliación de operaciones ganadas» (creación de automatización ahora va antes del parser de
  ventas) · residuo enabled rompía la resolución type-less (limpieza total de reglas QA del ws demo).

## 🔶 Wave D — checkpoint histórico (superado)
**Hecho:**
- Auditoría BD completa: `aarun_idem UNIQUE(rule_id, scheduled_for)` EXISTE (idempotencia por ventana
  intacta) · `assistant_findings_fp UNIQUE(workspace_id, fingerprint)` EXISTE (dedupe intacto).
- **Migración aplicada al proyecto real y commiteada**
  (`supabase/migrations/20260714_p70_wave_d_automation_types_and_skipped.sql`): CHECK de
  `assistant_automation_rules.type` ampliado de 3 → **11 tipos** (añade morning_agenda_brief,
  upcoming_appointments_watch, case_deadline_watch, portfolio_data_quality_watch,
  won_operation_reconciliation_watch, action_failure_watch, stale_operations_watch,
  inactive_client_followup_watch) y status `skipped` en runs (ventanas omitidas auditables).

**Siguiente (en orden):**
1. `src/lib/agents/findings-engine.ts` — registry `AUTOMATION_RULE_TYPES` (nombre, criterio, fuentes,
   defaultHour) + `runAutomationRule(supabase, ws, type)` con un runner REAL por tipo y partial
   handling (fuente caída ≠ run caído). Los 3 existentes se mapean; data_quality_watch = detectFindings.
2. `src/app/api/agent/automation/route.ts` — create_rule valida contra el registry (no lista hardcoded);
   `update_rule` (confirmed:true, hour/frequency daily|weekdays, recalcula next_run_at, reread);
   `set_rule_enabled` al ACTIVAR recalcula next_run_at (evita ventana rancia); `run_rule_now`;
   `list_runs`; `run_due` despacha por runner + recuperación de runs colgados (>15 min) + política de
   catch-up: máx 1 ventana recuperada (la más reciente), las omitidas → UN run `skipped` con
   result_count = nº ventanas; `nextRunAtMadrid` con offset REAL por fecha (DST) + weekdays.
3. `src/lib/agents/local-answers.ts` — gestión conversacional: «cámbialo a las 9» / «solo de lunes a
   viernes» → resolver regla + preview antes/después + marcador `[AUTOEDIT:…]` + confirmación →
   update_rule → verify; «pausa/reactívala» (reversible, recalcula next_run_at); «ejecuta ahora»;
   «¿cuándo se ejecuta?»; «¿qué encontró la última vez?»; «muéstrame sus ejecuciones».
   Neutralización: extender `lastLiveAutoPreview`/cancel a los marcadores AUTOEDIT.
4. `src/app/(saas)/assistant/page.tsx` — ampliar el regex de `displayAssistantText` a
   `\[AUTO[A-Z]*:[^\]]{1,80}\]` (los marcadores AUTOEDIT llevan ruleId y NUNCA deben verse).
5. Scripts: `scripts/p70-automation-catalog-e2e.mts` (11 tipos: create→run_now→dedupe→disable→cleanup +
   flujos conversacionales) y `scripts/p70-scheduler-chaos-e2e.mts` (run_due concurrente, misma ventana,
   future/disabled skip, DST invierno/verano, catch-up con skipped, run colgado, cross-workspace).
   Validar contra local (`npx next start -p 3211` + AGENT_ACTION_URL) antes del push, como en Wave C.
6. Ejecutar P69 8/8 (regresión del flujo existente) + P68 7/7 + suites nuevas → commit
   `P70 wave D automation catalog and scheduler hardening` → push → verificar staging.

## ⛔ Abierto (P70 los exige todos; ninguno se declara "límite" — son trabajo pendiente)
| # | Ítem | Prio |
|---|---|---|
| 1 | Wave D: gestión conversacional de automatizaciones + runners completos + scheduler chaos | P1 |
| 2 | Wave E: n8n control tower (runtime map, tools, marker P70, drift) | P1 |
| 3 | Wave F: benchmark 750+ con held-out + metamórficos + mutation + manifest regresiones | P1 |
| 4 | Wave G: chaos + red-team 75+ + observabilidad + maintenance | P1 |
| 5 | Wave H: rollback runbook + performance/accesibilidad + validación final + rc | P1 |
| 6 | Acciones sobre findings desde el centro (resolver/reconocer) — hoy el centro es lectura + chat | P2 |

## Cómo continuar (siguiente sesión)
1. Ampliar registro de acciones (patrón P65/P67 probado) módulo a módulo, con su card ya gratis
   (el contrato UI y las cards son genéricos por action_type).
2. Runners de automatización adicionales sobre el dispatcher P68 + cambio conversacional de horario.
3. Benchmark/regresiones/red-team (waves C-D).

**Verdes hoy:** tsc/lint/build · P66 11/11 · P67 8/8 · P68 7/7 · P69 8/8 · P70 ui-contract 15/15 ·
**Playwright 9/9 contra staging p70** · n8n 15/15+5 con policy.
