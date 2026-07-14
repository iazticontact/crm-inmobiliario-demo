# P70 — Catálogo multimódulo de acciones (Wave C)

**21 acciones supported** sobre el plano P65 (prepare → confirm → execute → verify), 6 módulos
editables. Registro único: `src/lib/agents/action-registry.ts`. Ninguna acción sin confirmación,
sin idempotencia ni sin read-after-write. Facturación excluida por construcción.

## Supported (21)

| # | Acción | Tabla | Campos | Semántica dura (executor) |
|---|---|---|---|---|
| 1 | clients.update_phone | clients | phone | formato ES |
| 2 | clients.update_email | clients | email | formato email |
| 3 | clients.update_name | clients | name | 1-120 chars |
| 4 | clients.update_note | clients | notes | 1-1000 chars |
| 5 | clients.update_status | clients | status | CHECK real: active/lead/inactive/churned |
| 6 | portfolio.update_price | properties | price | > 0 |
| 7 | portfolio.update_status | properties | status | matriz PORTFOLIO_TRANSITIONS |
| 8 | portfolio.update_notes | properties | notes | 1-1000 chars |
| 9 | portfolio.update_zone | properties | area | 1-80 chars |
| 10 | tasks.create | tasks | title, due_date, priority… | insert con status='pending' (server) |
| 11 | tasks.complete | tasks | status | SOLO `done` (CHECK pending\|done; nunca `completed`) |
| 12 | tasks.reopen | tasks | status | SOLO done→pending |
| 13 | tasks.update_due_date | tasks | due_date | YYYY-MM-DD |
| 14 | tasks.update_priority | tasks | priority | high/normal/low |
| 15 | tasks.update_title | tasks | title | 1-160 chars |
| 16 | calendar.create | calendar_events | title,type,date,hora,duración,start_at,end_at,client_name,location | type del CHECK real; start_at/end_at compuestos por el SERVIDOR en Europe/Madrid (la app filtra por start_at) |
| 17 | calendar.reschedule | calendar_events | date,hora,duración,start_at,end_at | eventos Google (is_read_only) y cancelados RECHAZADOS; fecha/hora no indicadas se completan del estado actual |
| 18 | operations.change_stage | opportunities | stage | matriz OPERATION_TRANSITIONS (won final; lost reactivable) |
| 19 | operations.update_value | opportunities | value | > 0; BLOQUEADO en won/lost (alimenta comisiones) |
| 20 | cases.update_status | service_cases | status | vocabulario canónico (open…closed) |
| 21 | cases.update_due_date | service_cases | due_date | YYYY-MM-DD |

## Unsupported (con causa técnica, auditada en BD)

| Acción pedida | Causa |
|---|---|
| clients.update_tax_id | La tabla `clients` NO tiene columna de NIF/CIF (auditado information_schema). |
| clients.update_nationality | No existe columna `nationality`; `country` es un concepto distinto y no se mapea en silencio. |

En su lugar se añadió `clients.update_status` (columna real con CHECK, valor de negocio directo).

## Invariantes verificados (suites)

- Una lectura JAMÁS se convierte en acción (13 casos negativos en parser tests).
- `done`, nunca `completed` (CHECK real + validación executor + test).
- El navegador nunca aporta workspace/proposedChanges/actionType/entityId como verdad (route v2 → executeUiAction).
- No Facturación (ACTION_UNKNOWN), no hard delete (no hay acción delete), no cambios relacionados
  silenciosos (valor de operación cerrada bloqueado; evento Google read-only bloqueado).
- Optimistic lock en todos los updates; idempotencia en confirm; verify read-after-write con igualdad
  normalizada de timestamps.

## Suites

- `npx tsx --tsconfig tsconfig.json scripts/p70-parser-tests.mts` — 48 checks puros (parsers + transiciones + registro).
- `npx tsx --tsconfig tsconfig.json scripts/p70-action-catalog-e2e.mts` — 46 checks E2E (ciclo completo por módulo + invariantes + cleanup). `AGENT_ACTION_URL` para elegir plano (staging por defecto).
- `node scripts/p70-grants-check.mjs` — 12 tablas con SELECT probado con sesión `authenticated` REAL (previene la regresión del GRANT cazada en Wave B).
- Playwright `e2e/assistant-actions-modules.spec.ts` — calendar/operations/cases por UI real contra staging.
