# P71 — Invariantes finales protegidos

> Invariantes globales que deben cumplirse SIEMPRE, con el mecanismo que los garantiza y el test/gate que se
> pone en ROJO si se rompen. «prod» = producción; «probe» = `scripts/p71-mutation-probe.mts`. Fecha 2026-07-18.

## Identidad
| # | Invariante | Garantía | Detector |
|---|---|---|---|
| 1 | Una entidad resuelta pertenece al workspace autenticado | RLS + `.eq('workspace_id', ws)` en todos los readers | mut `reader-ignores-entity`/`workspace-scoped-reads`; benchmark gate workspace; soak cross-ws |
| 2 | Un ID del frontend nunca es autoridad | la route resuelve ws/actor de la sesión; `uiAction` solo lleva actionId; el token se re-firma server-side | red-team actionId/workspace tampering; grants |
| 3 | Un pronombre no cambia de tipo en silencio | `conversation-references` resuelve por tipo; demostrativo temporal excluido | metamorphic (mismo entityId); It2/It3 |
| 4 | Una ambigüedad relevante no se resuelve arbitrariamente | `resolveExplicitClientScope` N→aclara; `handleChatAction` varios→pregunta; extremo/ordinal deterministas | mut `silent-entity-choice`; intelligence gate wrong-entity |
| 5 | Un fallo de resolución no degrada a global | span débil sin match → se ignora; fuerte → «no encuentro»; nunca la activa | mut `scoped-empty-to-global`; intelligence gate global-leakage; soak |

## Datos
| # | Invariante | Garantía | Detector |
|---|---|---|---|
| 6-8 | Datos actuales de lectura viva; ConversationState/lastResults nunca son fuente | los readers consultan en el turno; `confirm_prior`→reconsulta | mut `confirm-from-cache`; realtime E2E; soak |
| 9 | Read-after-write tras mutación | `/api/agent/action` confirm relee y compara (`verify_ok`) | mut `verify` (45/46); realtime E2E |
| 10 | Partial nunca se presenta como complete | verify exige TODOS los campos; agenda multi-fuente marca parcial | action-catalog; benchmark |

## Acciones
| # | Invariante | Garantía | Detector |
|---|---|---|---|
| 11-12 | No ejecuta sin preview ni confirmación válida | plano P65 prepare→confirm; `latestPendingAction` obligatorio | P66; mut `confirmacion-sin-pending`; concurrency |
| 13 | Confirmar 2× = una sola mutación | idempotency_key + estado terminal | **p71-concurrency** (doble-confirm) |
| 14-16 | Preview expirada/cancelada/superseded no ejecuta | expiry, ACTION_CANCELLED/CONFLICT | concurrency (confirm-tras-cancel); action-catalog |
| 17 | Acción cross-workspace no ejecuta | workspace de la sesión, no del body | action-catalog (404 ws ajeno); red-team |
| 18-19 | Campos no permitidos / proposedChanges fabricados = rechazo | `findDeniedField` (allow/forbidden del registry) | action-catalog; mut `permitir-invoice` |
| 20 | Success requiere verify | `verify_ok` gobierna status=completed | mut `verify` |

## Automatizaciones
| # | Invariante | Detector |
|---|---|---|
| 21-28 | opt-in · disabled no ejecuta · dedupe trigger/findings · edición con preview · next_run Europe/Madrid · sin tormentas · run persistido | automation-catalog 34/34 · scheduler-chaos 32/32 · P67/P68/P69 · mut `quitar-dedupe` |

## Contexto
| # | Invariante | Detector |
|---|---|---|
| 29-30 | local-first y n8n comparten estado; sin segundo cerebro | **p71-n8n-handoff** 6/6; contrato F3.5 |
| 31 | pendingIntent nunca ejecuta directo | mut `question-opens-action`; intelligence gate false-action; soak |
| 32 | temporalScope no secuestra acciones | mut `temporal-hijacks-action`; action-catalog (calendar) |
| 33 | entityScope y temporalScope componen | mut `temporal-pisa-entidad`; It3 composición |
| 34 | cambio de tema limpia scopes incompatibles | soak (inyecciones cada 5-10 turnos); It2 |
| 35 | fallo de n8n no corrompe estado válido | context-policy keep-prior; n8n-chaos 9/9; handoff E |

## Seguridad
| # | Invariante | Detector |
|---|---|---|
| 36 | Facturación aislada | benchmark gate invoicing; fuzz; red-team |
| 37-38 | service_role/workspace nunca desde el navegador | route usa sesión+RLS; red-team |
| 39-41 | SQL/HTTP arbitrario y hard-delete imposibles desde el Asistente | tools cerradas (readers + registry); red-team; fuzz |
| 42-44 | secretos/UUID/JSON/stacks nunca visibles; cross-ws leak=0 | red-team 78/78; fuzz 30/30; soak higiene; UI contract 15/15 |
