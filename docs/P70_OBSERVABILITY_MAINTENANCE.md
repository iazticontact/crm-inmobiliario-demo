# P70 — Observabilidad y mantenimiento (Wave G)

## Traza estructurada (sin PII, sin secretos, sin cuerpo del mensaje)

### Por turno del asistente — `POST /api/assistant/v2`
- `logInvoke` (una línea JSON por invocación): `event`, `workspaceResolved`, `openAiConfigured`,
  `model` (local:reader / n8n:agent-v2 / gpt-…), `errorCode`, `agentErrorCode`, `hasPreparedAction`,
  `preparedActionType`, `source` (local_reader:<entity> / n8n / ui_action / guard_*), `toolCalls`,
  `durationMs`.
- `[assistant.turn]` (decisión de turno ANTES de leer/escribir): `turnType`, `domain`, `module`,
  `action`, `shouldReadData`, `shouldCallN8n`, `reason`. Permite auditar POR QUÉ un turno leyó o no.
- `requestId` (uuid por request) se propaga a n8n como clave de correlación y de Window Memory.
- El SHA/runtime del deploy se obtiene de `GET /api/agent/diag` (`toolVersion`, `supabaseRef`, `commit`).

### Por acción — tabla `assistant_actions` (audit trail durable)
Cada acción registra su ciclo completo: `status` (prepared→executing→completed|failed|conflict|
cancelled|expired), `created_at`, `confirmed_at`, `executed_at`, `expires_at`, `preview_hash`,
`idempotency_key`, `result_json` (`verified`, `verify_ok`, `verified_at`) y `safe_error_code`. La
idempotencia (confirmar dos veces → mismo resultado, una sola escritura) y el read-after-write quedan
evidenciados en la fila. **No se borra**: es el registro de auditoría.

### Por automatización — tablas `assistant_automation_rules` / `assistant_automation_runs`
Regla: `type`, `enabled`, `schedule_json`, `timezone`, `next_run_at`, `last_run_at`. Run: `scheduled_for`
(ventana reclamada, unique con `rule_id`), `status` (running/success/partial/error/skipped_duplicate/
skipped), `started_at`, `finished_at`, `result_count`, `safe_error_code`. El catch-up y los duplicados
quedan trazados (un run `skipped` con `result_count` = ventanas omitidas).

### Por finding — tabla `assistant_findings`
`finding_type`, `entity_type`/`entity_id`, `fingerprint` (dedupe único por workspace), `severity`,
`status` (open→acknowledged→resolved/dismissed, sin hard delete), `summary` (incluye el criterio
objetivo), `detected_at`, `resolved_at`.

## Mantenimiento (todo DRY-RUN, solo lectura; NUNCA borra el audit trail)

| Script | Qué informa |
|---|---|
| `node scripts/p70-action-maintenance.mjs [--workspace <uuid>]` | acciones por estado, prepared caducadas sin cerrar, executing atascadas, códigos de error |
| `node scripts/p70-automation-maintenance.mjs [--workspace <uuid>]` | reglas activas vencidas / sin next_run_at, runs por estado, runs atascados |
| `node scripts/p70-findings-maintenance.mjs [--workspace <uuid>]` | findings por estado/severidad, ratio resueltos, más antiguo abierto, tipos frecuentes |
| `node scripts/p70-deploy-drift-check.mjs [URL]` | toolVersion staging vs código local + supabaseRef + config |
| `node scripts/p70-health-check.mjs` | staging vivo, n8n activo (41 nodos), datos demo sanos |
| `node scripts/n8n-p70-drift-check.mjs` | hash del workflow vivo vs hash commiteado |

## Resiliencia y seguridad (suites)

- `scripts/p70-chaos-test.mts` — **12/12**: carrera de confirmaciones (idempotencia, una sola
  escritura), acción caducada (ACTION_EXPIRED), conflicto de lock optimista (ACTION_CONFLICT, sin
  sobrescribir), fail-soft de lecturas (reader roto → sin crash ni fabricación), rate-limit, body
  malformado → 400.
- `scripts/p70-red-team.mts` — **78/78** en 14 grupos: prompt/tool injection, exfiltración de
  secretos/PII, SQLi, XSS/HTML/Markdown, Facturación aislada, hard-delete, tablas/campos arbitrarios,
  direct-execute/token manipulado/replay, cross-workspace, abuso de automatizaciones (schedule
  malicioso, sin confirmación, tipo falso), verdad temporal / falso éxito, UI tampering, auth del plano.
- Complementarias: `p70-scheduler-chaos-e2e` (32/32) · `n8n-p70-chaos-e2e` (9/9).
