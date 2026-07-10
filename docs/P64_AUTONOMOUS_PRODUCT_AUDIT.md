# P64 — Auditoría autónoma del producto (hallazgos priorizados)

Inspección del runtime completo (UI→route→motor→readers→n8n→DB) tras P63. Cada hallazgo con evidencia,
causa raíz y estado.

| # | Prio | Hallazgo | Causa raíz | Estado |
|---|---|---|---|---|
| 1 | **P1** | Ficha mostraba una **cita pasada (24/06) como «próxima»** y podía contar tareas completadas como pendientes | `getClient360` lista TODOS los eventos/tareas sin clasificación temporal; `handleClientDetail` contaba sin filtrar | ✅ FIX: `assistant-temporal.ts` (próxima=fecha≥hoy Madrid; vencida=pendiente+fecha<hoy; completada nunca pendiente) + ficha con etiquetas veraces («Citas próximas: X · pasadas: Y») |
| 2 | **P1** | «resumen del día con mis datos», «resumen ejecutivo», «cómo va el negocio» → **entity unknown → n8n** (riesgo de alucinación) | No existía capability de resumen operativo global | ✅ FIX: `handleExecutiveSummary` — 5 fuentes vivas en paralelo (Cartera, Operaciones, Citas, Tareas, Trámites) con degradación parcial y prioridades objetivas |
| 3 | **P1** | **Dobles asteriscos visibles** en el chat (markdown crudo: «**8**», «**Ficha…**») | Los generadores emiten `**…**` y la UI no lo renderiza | ✅ FIX: sanitizador único en `tryLocalAnswer` (toda respuesta local sale limpia) |
| 4 | **P1** | El sanitizador rompía la resolución de ofertas (cabecera «**Módulo** —» ya llega sin asteriscos en el hilo) | `resolveOfferedModules` solo reconocía cabecera con `**` | ✅ FIX: cabecera plana «Módulo — …» también manda en exclusiva (regresión cazada por p62-incident) |
| 5 | P2 | Marcador de versión desplegada obsoleto (p56) | TOOL_CONTRACT_VERSION sin bump desde P56B | ✅ FIX: `2026-07-10.p64` (verificación de deploy) |
| 6 | P2 | n8n sin las reglas P63/P64 (módulo explícito, verdad temporal, Sí/No primero, texto limpio) | Prompt del agente anterior a estos contratos | ✅ FIX REAL EN VIVO: bloque [P64] añadido por API (PUT 200, verificado, 15/15 tools intactas) |
| 7 | P2 | Acciones con confirmación (crear/editar desde chat) | Requiere action registry + endpoints de escritura + pendingAction persistente | ⏸ NO implementado (declarado): sin backend de escritura seguro expuesto al asistente; no se simula |
| 8 | P3 | Playwright UI E2E | Sin sesión QA | ⛔ BLOCKED — TEST_SESSION_MISSING |

Descartado en esta fase (con motivo): registries formales completos, subworkflows n8n, panel de diagnóstico,
performance budgets — sin clase de fallo activa que los exija; construirlos sin integración violaría la
regla «cada abstracción debe integrarse en el runtime real».
