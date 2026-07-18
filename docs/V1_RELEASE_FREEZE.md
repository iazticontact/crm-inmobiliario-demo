# V1 — Release freeze

> Congelación de la versión tras superar la matriz completa de gates. A partir de aquí, solo P0/P1, bug real
> reproducido o requisito comercial explícito aprobado. Fecha: 2026-07-18.

## Identidad de la release
| | |
|---|---|
| Rama | `main` = `origin/main` |
| Tag | `v1.0.0-rc1` (apunta al commit de congelación) |
| Runtime (staging) | `2026-07-17.p71-rc` |
| Bundle desplegado | producto de `main` (los commits finales de tests/docs no alteran el bundle de Next) |
| n8n workflow hash | `952900d3c8f3e6c0` · 41 nodos · markers `[P70 FINAL RELEASE CANDIDATE]` + `[P71 ADAPTIVE CONVERSATIONAL INTELLIGENCE]` · active |
| Migraciones | **ninguna en P71** (estado en `assistant_agent_memory` con JSON versionado) |
| Puntos de recuperación | `p70-before-p71-553ed64` (553ed64) · `p71-rc-before-final-freeze` (a01fb66) |

## Commits P71 (553ed64 → v1.0.0-rc1)
`4ee8f04` core · `bee1797` pending+temporal · `59cf00e` composición · `e722408` candidato · `64aea3e` runtime ·
`6592fc0` EOL harness · `cbd0b60` merge · `4aefd69` n8n consume estado · `bcfaf36` frontera n8n ·
`da26d28` botón bootstrap · `a01fb66` docs · `9e6ab72` hardening tests · `07e5b67` Playwright determinista ·
`9a0012d` timeout switch · (+ commit de docs de freeze).

## Arquitectura (una frase)
mensaje → ConversationState → acto comunicativo → capability registry → resolución de entidad/referente →
QueryScope (entidad+periodo+filtros+agregado componibles) → plan → readers/tools reales → evidencia actual →
validación → respuesta → stateUpdates. Estado compartido entre local-first y n8n. La memoria comprende;
la BD es la fuente de datos.

## Matriz de test (verde al SHA congelado)
**Hardening P71**: soak adversarial 1748 turnos/0 excepciones/0 violaciones (p50 63ms·p95 147ms·p99 305ms) ·
fuzz 30/30 · metamorphic 14/14 · concurrencia 10/10.
**P71**: intelligence 325 (100%) · held-out 120 (100%) · 8 gates críticos 0 violaciones · black-box 22/22 ·
mutations 10/10 · realtime 7/7 · It2 12/12 · It3 10/10 · unit 15/15 · sonda 0 delegaciones · n8n handoff 6/6.
**P70**: benchmark 100%/held-out 100% · mutation oficial **9/9** (7 harness + verify 45/46 + GRANT 11/12) ·
parser 48/48 · P65 10/10 · P66 11/11 · P67 6/6 · P68 7/7 · P69 8/8 · UI 15/15 · action-catalog 46/46 ·
automation-catalog 34/34 · grants 12/12.
**Infra**: n8n verify 17/17 · e2e 11/11 · chaos 9/9 · drift OK · chaos 12/12 · scheduler-chaos 32/32 ·
tool-policy strict 7/7 · health OK · deploy verificado.
**Playwright**: 14/14 repetido (×3 suite completa + ×5 automations) — flakiness eliminada.
**tsc / lint / build**: verdes.

## Documentación de release
`P71_FINAL_INVARIANTS.md` · `P71_FAULT_CONTAINMENT_MATRIX.md` · `P71_SOAK_RESULTS.md` ·
`P71_DISASTER_RECOVERY_VERIFICATION.md` · `P71_N8N_STATE_CONTRACT.md` · `P71_FINAL_ARCHITECTURE_AUDIT.md` ·
`P71_ANTI_OVERFIT_AUDIT.md` · `P71_FINAL_CODE_REVIEW.md` · `P71_FABLE_REVIEW_HANDOFF.md` ·
`P70_MUTATION_RESULTS.md`.

## P0 / P1 / P2
- **P0 = 0 · P1 = 0.**
- **P2 conocidos** (documentados, no bloqueantes): (1) typo en el lexema nuclear degrada al cerebro n8n
  (diseño local-first); (2) topónimo Capitalizado tras «de»+periodo puede pedir una aclaración de más
  (protege el gate wrong-entity); (3) composición temporal cliente-scoped cubre calendar/tasks/operations/
  cases (cartera no es temporal); (4) relación cliente→trámites cae a ficha (no hay reader scoped dedicado).

## Riesgos externos
`/api/agent/diag.commit = "unknown"` (no deriva del SHA git): el SHA desplegado se verifica por ventana de
deploy secuencial + comportamiento observable, no por el endpoint. EasyPanel/Supabase/n8n son dependencias
gestionadas fuera del repo (backups y rollback documentados en disaster recovery).

## Garantía honesta (no «infalible»)
- Fallos conocidos dentro de la matriz validada: **0**.
- Fallos peligrosos silenciosos en las pruebas: **0** (mutación 9/9 + 10/10, red-team 78/78, soak/fuzz limpios).
- Cualquier fallo inesperado degrada de forma segura (fault-containment verificado).
- Rollback disponible y verificado; observabilidad por turno; versión congelada.
- No se afirma imposibilidad matemática de fallo: se afirma el máximo estándar práctico alcanzado.

## Regla de congelación
A partir de `v1.0.0-rc1`: sin cambios salvo P0, P1, bug real reproducido o requisito comercial aprobado.
No «mejorar por mejorar». Uso real controlado.
