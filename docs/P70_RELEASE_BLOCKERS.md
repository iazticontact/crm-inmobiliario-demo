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

## ⛔ Abierto (P70 los exige todos; ninguno se declara "límite" — son trabajo pendiente)
| # | Ítem | Prio |
|---|---|---|
| 1 | UI visual de acciones (cards + botones actionId, estados, refresh/multitab) | P1 |
| 2 | UI visual de automatizaciones | P1 |
| 3 | Centro visual de findings (ruta + filtros + estados + dashboard) | P1 |
| 4 | Playwright E2E consumiendo `.auth/` (la sesión YA existe; falta instalar/ejecutar los specs) | P1 |
| 5 | Catálogo ≥15 acciones + ≥1 por módulo editable (hoy 7; faltan calendar/operations/cases) | P1 |
| 6 | Cambio conversacional de horario («cámbialo a las 9») + runners de más tipos de automatización | P1 |
| 7 | Benchmark 750+ con held-out + metamórficos + mutation checks | P1 |
| 8 | Fábrica de regresiones (manifest) + chaos + red-team 75+ | P1 |
| 9 | N8N runtime map nodo a nodo + limpieza + [P70] prompt | P2 |
| 10 | Observabilidad/diagnóstico, rendimiento, mantenimiento, rollback runbook | P2 |

## Cómo continuar (siguiente sesión)
1. `node scripts/p70-create-qa-session.mjs` (regenera sesión si expiró) → instalar Playwright →
   spec mínimo login+chat con `.auth/qa-session.json`.
2. UI cards (contrato AssistantUiMessage ya especificado en P66/P67 docs) → wiring en la respuesta del chat.
3. Ampliar registro de acciones (patrón P65/P67 probado) módulo a módulo.
4. Runners de automatización adicionales sobre el dispatcher P68.

**Verdes previos re-verificados hoy:** n8n 15/15+5 con policy, staging `2026-07-14.p69`, árbol limpio.
