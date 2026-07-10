# P62 — Análisis del incidente real (por clase, con causa raíz verificada)

Reproducido contra el motor real ANTES del fix (`decideTurn` + `tryLocalAnswer`):

| # | Síntoma en UI | Clasificación antes | Causa raíz | Fix |
|---|---|---|---|---|
| 1 | «Que hacemos ofreceme algo» → genérico | ambiguous → n8n | No existía la clase *offer_request* | `detectOfferRequest` → oferta local concreta (3 opciones) |
| 2 | «Venga va muestramela» → «no puedo acceder» | ambiguous → n8n | No existía resolución de OFERTA pendiente; n8n sin plan | `detectAcceptance` + `resolveOfferedModules` (del propio texto del hilo) → ejecuta la lectura ofrecida o UNA aclaración |
| 3 | «en el calendario me puedes mirar?» → «no puedo consultar» | ambiguous → n8n | «mirar» no era señal de lectura; gate de agenda exigía palabra de existencia | READ_SIGNALS += mira/mirar/vistazo; gate de agenda acepta verbos de lectura → answer-first |
| 4 | «Sí» tras «¿Quieres que te muestre tus datos actuales?» → re-explica | ambiguous → n8n | Sin estado pendingOffer; la aceptación no se conectaba con la oferta | La aceptación resuelve la oferta del último mensaje del asistente (cabecera de módulo manda en exclusiva) |
| 5 | «explícame todo el crm resumido» → solo Calendario | module_explanation/calendar | El módulo del contexto GANABA a una petición global explícita | Regla dura: alcance global («todo el CRM», «en general») → tour, antes que la herencia de módulo |
| 6 | «Hello que tal» → no manejado | ambiguous → n8n | Saludo bilingüe/coloquial no reconocido | greeting acepta hello/hi |
| 7 | (Descubierto por el test) contexto contaminado | — | El prefijo «asistente:» del hilo se resolvía como módulo Asistente | Se limpia el prefijo de hablante en los resolvedores de contexto |

## Regla nueva del contrato
Una ACEPTACIÓN breve («sí», «vale», «venga», «muéstramela»):
1. nunca re-explica la pantalla; 2. nunca cae a n8n sin plan; 3. ejecuta la lectura ofrecida si la oferta es
única o resoluble (módulo explícito > singular/género > única opción); 4. si hay varias opciones sin
resolver → UNA aclaración concreta («¿La cartera, las operaciones o las citas?»); 5. «sí explícame» NO es
aceptación de datos (pide explicación). Una petición GLOBAL siempre resetea el módulo del contexto.

## Verificación
`scripts/p62-real-incident-check.mts` (transcript completo, motor real, mock realista): **7/7 PASS**.
n8n: preflight OK (workflow activo 6mps8YoWu3syldUc, 24 nodos, 15/15 tools con policy header, backup en
temp). NO se modificó: estas clases se resuelven localmente ANTES de n8n; n8n queda para lo no cubierto,
bajo contrato (strict re-verificado 7/7 en vivo).
