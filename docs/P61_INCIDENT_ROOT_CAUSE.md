# P61 — Causa raíz del incidente (por clase, con evidencia real)

Datos reales del workspace demo (2026-07-09): **0 citas próximas** (último evento 2026-07-02), **0 tareas
pendientes**, **9 clientes**, David Iglesias existe. Es decir, «no hay citas» era el dato correcto — el
fallo era de **forma y estructura**, no de dato.

| # | Síntoma en UI | Causa raíz (verificada) | Fix |
|---|---|---|---|
| 1 | «tengo citas próximas?» → «No hay citas para mostrar» | Respuesta no **answer-first**; no aclara sí/no | `handleAgenda` responde «Citas próximas: **no**…» |
| 2 | Follow-up «no tengo nada?» → smalltalk social | El follow-up de un vacío se clasificaba como social; se perdía el contexto | Gate de **confirmación de vacío**: re-afirma la agenda |
| 3 | «citas o tareas o no?» → solo una fuente | No había consulta **multi-fuente** (calendar + tasks son tablas distintas) | `handleAgenda(calendar+tasks)` responde ambas |
| 4 | «resumen de mi cartera» → «¿entender o tus datos?» | **Regresión P60**: `resumen ambiguo` no reconocía el posesivo «mi cartera» | `summary-intent`: posesivo+módulo → operativo (datos) |
| 5 | «de mi cartera de inmuebles» → «no puedo acceder» | Sin capability de **resumen de cartera con datos** → caía a n8n | `handlePortfolioSummary` (conteo por estado, en vivo) |
| 6 | «ficha completa de David» → «no puedo acceder a clientes» | **`getClient360` usaba `Promise.all`** y consultaba las tablas **inexistentes `conversations`/`messages`** → una sección rechazaba y **tiraba abajo toda la ficha** | Lectura **por sección con degradación parcial** (core primero; secciones opcionales aisladas); se eliminan las tablas inexistentes |

## La causa estructural clave (#6)
`SELECT count(*) FROM information_schema.tables WHERE table_name IN ('conversations','messages')` → **0**.
`getClient360` las consultaba dentro de un `Promise.all`: cualquier rechazo (tabla inexistente) hacía
`throw` de TODO → el caller devolvía «no puedo acceder a los datos de clientes» aunque el **core del cliente
y la lista funcionaran**. Es exactamente la hipótesis del incidente: *«una consulta monolítica falla por
una relación opcional y tira abajo toda la ficha»*.

**Patrón aplicado (general):** el core requerido se lee primero y por separado; las secciones opcionales se
leen de forma independiente y, si una falla, devuelve vacío sin romper la ficha. Nunca «no tengo acceso»
cuando el core sí se leyó.
