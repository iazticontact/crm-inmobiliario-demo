# P71 — Matriz de contención de fallos (fault-containment)

> Comportamiento ante fallos INDEPENDIENTES. «Degradación segura» = sin inventar datos, sin cambiar de
> entidad, sin ejecutar acción, sin falso éxito, sin corromper el estado válido. Evidencia = mecanismo del
> código + gate que lo cubre. Fecha 2026-07-18.

## A · Supabase
| Fallo | Comportamiento | Cobertura |
|---|---|---|
| timeout / 500 / conexión lenta | reader devuelve `{error}` → handler responde mensaje humano seguro (`humanError`/`fail`), nunca inventa | assistant-errors; benchmark; soak (0 excepciones en 1748 turnos) |
| query parcial | solo error si TODO lo pedido falló; si hay dato válido se conserva con prefacio honesto | context-policy `keep_prior_on_error`; handleAgenda degradación parcial |
| row desaparece entre resolve/read | detalle por id → «ya no encuentro X (puede haberse eliminado)» | readEntityDetailById; realtime E2E |
| row cambia entre preview/confirm | optimistic lock → `ACTION_CONFLICT` (no aplica) | action-catalog; concurrency |
| RLS deny / grant missing | lectura vacía/segura; sin fuga | mut `workspace-scoped-reads`; grants 12/12 |

## B · n8n
| Fallo | Comportamiento | Cobertura |
|---|---|---|
| timeout / 500 / unreachable | `runN8nAssistant` fail-soft → error honesto al usuario; **sin fallback legacy silencioso**; estado previo intacto | route error paths; n8n-chaos 9/9; handoff E |
| JSON inválido / bad response | `normalizeReply` null → `n8n_bad_response` → mensaje seguro | n8n-chaos |
| tool inexistente / parcial | la tool devuelve `{ok:false,error}`; el agente no inventa | n8n-e2e 11/11 |
| stateUpdates malformados | `validateActiveEntityUpdate` descarta lo inseguro antes de persistir | route; handoff |
| workflow inactive / stale | drift-check detecta hash; verify 17/17 valida contrato | n8n-drift; n8n-verify |

## C · Frontend
| Fallo | Comportamiento | Cobertura |
|---|---|---|
| doble click / request duplicado | idempotency_key → una sola mutación | **concurrency** doble-confirm |
| refresh durante preview/execute | cards se reconstruyen desde `metadata.ui` persistida; la acción vive en `assistant_actions` | Playwright (reload); action-catalog |
| dos pestañas | estado por hilo re-cargado de BD (solo refs); sin doble acción | realtime E2E (dos pestañas); soak interleave |
| sesión caducada | route 401 → mensaje humano | route auth |
| «Nueva consulta» durante bootstrap | botón deshabilitado hasta resolver workspace (no click muerto) | fix da26d28; Playwright determinista |

## D · Scheduler
| Fallo | Comportamiento | Cobertura |
|---|---|---|
| cron duplicado / restart / doble run mismo minuto | dedupe por ventana (skipped_duplicate); `run_due` idempotente | scheduler-chaos 32/32; automation-catalog dedupe |
| deploy durante run / stale running | recuperación; next_run recalculado (nunca ventana antigua) | scheduler-chaos; P68 |
| DST / clock skew | next_run en Europe/Madrid; margen anti-skew en cleanup | scheduler-chaos; automation-catalog |

## E · Memoria / ConversationState
| Fallo | Comportamiento | Cobertura |
|---|---|---|
| vacío | `emptyState()`; opera sin contexto | unit; soak |
| v1 | `upgradeConversationState` → `upgraded` conservando lo seguro | unit; mut `v1-discarded` |
| v2 parcial / JSON corrupto | validador runtime descarta lo inválido; nunca rompe el turno | unit (v1 parcial); fuzz |
| entidad eliminada / referencia obsoleta | se reconsulta por id → «ya no encuentro X» | realtime E2E; soak |
| pendingIntent expirado | validador lo descarta (TTL 6 min); un «sí» tardío no confirma | unit; soak (pending residual=0) |

## Resumen de resiliencia observada
- **Soak 1748 turnos**: 0 excepciones, 0 violaciones de invariante, estado acotado, latencia p99 305 ms, BD limpia.
- **Fuzz 30/30**: 0 crash, 0 XSS, 0 mutación, 0 fuga, 0 acceso a Facturación ante entradas hostiles.
- **Concurrencia 10/10**: doble-confirm idempotente, confirm+cancel terminal único coherente.
