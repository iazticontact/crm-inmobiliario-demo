# P70 — Catálogo de automatizaciones (Wave D)

**11 tipos supported con runner REAL** (fuentes reales, resultado estructurado, run record persistido,
findings con dedupe, partial handling). Registry único: `src/lib/agents/findings-engine.ts`
(`AUTOMATION_RULES`). La BD (CHECK), el endpoint, el parser, la UI y n8n validan contra ese registro.
`data_quality_watch` es la auditoría global canónica (NO existe un `data_quality_audit` separado):
orquesta las reglas de calidad y comparte fingerprints con los watchers específicos → cero duplicados.

| Tipo | Vigila | Findings | Dedupe |
|---|---|---|---|
| data_quality_watch | auditoría global de coherencia | por regla | spwwo/wowsp/ownp/owc/pmp/porph/tov:<id> |
| daily_executive_brief | resumen ejecutivo multi-fuente | 1/día | brief:<fecha> |
| morning_agenda_brief | citas/tareas de HOY (verdad temporal Madrid) | 1/día | agenda:<fecha> |
| overdue_tasks_watch | pending + due_date < hoy | por tarea | tov:<id>:<due> |
| upcoming_appointments_watch | citas en 24h no canceladas (jamás pasadas) | por cita | appt:<id>:<fecha> |
| case_deadline_watch | trámites vencidos (warning) / ≤3 días (info) | por trámite | casedl:<id>:<due> |
| portfolio_data_quality_watch | publicado sin precio, vendido sin ganada, cliente huérfano | por inmueble | pmp/spwwo/porph:<id> |
| won_operation_reconciliation_watch | ganada sin inmueble cerrado/sin inmueble/sin cliente | por operación | wowsp/ownp/owc:<id> |
| action_failure_watch | acciones failed/conflict 24h o executing >15min (QA filtrado) | por acción | actfail/actstuck:<id> |
| stale_operations_watch | abierta ≥30d sin tarea futura ni cita futura (sugerencia) | por operación | staleop:<id> |
| inactive_client_followup_watch | activo/lead con op abierta, ≥60d sin actividad (sugerencia) | por cliente | inactcli:<id> |

## Gestión conversacional (todas con verificación read-after-write)

- Crear: «activa <tipo> a las 8[:30] [de lunes a viernes | todos los lunes]» → preview opt-in → confirmar.
- Editar: «cámbialo a las 9», «ponlo a las 8:30», «solo de lunes a viernes», «todos los lunes» →
  **preview antes→después SIN escribir** (hash liga la confirmación al estado leído; conflicto → 409)
  → confirmar → next_run_at recalculado → card actualizada. Frecuencias fuera de `allowedFrequencies`
  → rechazo honesto.
- «Pausa …» / «reactívala» (reversible; al reactivar se RECALCULA next_run_at, jamás ventana rancia).
- «Ejecuta ahora» (regla en pausa → bloqueado honesto; doble clic mismo minuto → no duplica).
- «¿Cuándo se ejecuta?» · «muéstrame su configuración» (horario + criterio) · «¿qué encontró la última
  vez?» · «muéstrame sus ejecuciones» (sin UUIDs/JSON).
- Botones de card: Confirmar/Descartar (previews) · Ejecutar ahora / Ver ejecuciones / Pausar /
  Reactivar (quick replies del mismo plano conversacional).

## Suites

- `scripts/p70-automation-catalog-e2e.mts` — **33/33**: ciclo completo por tipo (preview→create→
  schedule→run→dedupe→disable) + gestión conversacional completa + guardas.
- `scripts/p70-scheduler-chaos-e2e.mts` — **32/32**: DST/medianoche/weekdays/weekly, run_due
  concurrente, catch-up, colgados, config corrupta, cross-workspace. Ver `P70_SCHEDULER_HARDENING.md`.
- Playwright `e2e/assistant-automations.spec.ts` — UI real contra staging.
