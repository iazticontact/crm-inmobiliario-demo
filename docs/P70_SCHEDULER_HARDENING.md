# P70 — Scheduler hardening (Wave D)

## Horarios: Europe/Madrid es la verdad

`src/lib/agents/automation-schedule.ts` — `computeNextRunMadrid(schedule, from)`:
- offset REAL por fecha vía `Intl … longOffset` (jamás offsets fijos) → DST primavera/otoño correctos
  (verificado: 2026-03-29 08:00 Madrid = 06:00Z; 2026-10-25 08:00 Madrid = 07:00Z);
- frecuencias: `daily` · `weekdays` (L-V del calendario de Madrid) · `weekly` (weekday 1-7);
- hora 0-23 + minutos 0-59 («ponlo a las 8:30»);
- resultado SIEMPRE estrictamente futuro.

## Claim atómico por ventana

`run_due` reclama cada ventana con el INSERT del run (`aarun_idem UNIQUE(rule_id, scheduled_for)`,
verificado en BD): dos cron triggers/nodos/retries simultáneos → un solo run; el perdedor recibe 23505
→ `skipped_duplicate`. Nunca «seleccionar y ejecutar» sin lock.

## Política de catch-up (anti-tormenta)

Tras downtime, por regla vencida:
1. se ejecuta **UNA sola ventana** (la reclamada, `scheduled_for = next_run_at` original);
2. las ventanas intermedias perdidas NO se ejecutan: quedan auditadas en **UN run `skipped`**
   (`scheduled_for` = ventana más reciente omitida, `result_count` = nº de ventanas,
   `safe_error_code = AUTOMATION_CATCHUP_SKIPPED`), tope 60;
3. `next_run_at` se recalcula SIEMPRE a futuro desde `now`;
4. el run manual (`run_rule_now`, idempotente por minuto) NO altera la ventana programada.

## Recuperación de colgados

Al inicio de cada `run_due`: runs `running` con `started_at` > 15 min → `error`
(`AUTOMATION_TIMEOUT`). Un worker caído nunca bloquea ventanas futuras.

## Estados de run (CHECK real)

`running · success · partial · failed(error) · skipped_duplicate · skipped`. `partial` = alguna fuente
del runner falló (partial handling: una fuente caída no tumba el run). Config corrupta en
`schedule_json` → fallback a horario por defecto sin reventar el dispatcher.

## Edición segura de reglas

`prepare_update_rule` (lee la regla real, devuelve antes/después + `update_hash`) →
`confirm_update_rule` (exige `confirmed:true` + hash; si la regla cambió tras el preview →
`AUTOMATION_UPDATE_CONFLICT` 409). El frontend jamás envía schedule como verdad sin este ciclo.
`set_rule_enabled(true)` recalcula `next_run_at` (jamás ejecuta ventanas de cuando estaba pausada).
Disable reversible; sin hard delete de reglas desde el chat; historial conservado.
