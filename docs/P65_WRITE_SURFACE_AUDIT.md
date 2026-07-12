# P65 — Auditoría de superficie de escritura

## Estado real encontrado
- **No existía** ningún endpoint de escritura para el Asistente: `/api/agent/tool` es read-only por diseño
  (las tools mutantes antiguas devuelven **410 Gone**; comentario explícito en la route).
- La UI escribe vía Supabase client con RLS (drawers/formularios). `updated_at` existe y cambia al editar
  en clients/properties/tasks/opportunities/service_cases (verificado en fases previas).
- No existía persistencia de acciones pendientes, ni idempotencia, ni optimistic lock, ni audit de acciones.

## Verificaciones de modelo relevantes (BD real)
- `tasks.status` tiene CHECK **('pending','done')** — descubierto por el E2E: la primera versión usaba
  'completed' y el UPDATE fallaba → corregido a 'done'. (Ejemplo de por qué el read-after-write importa.)
- `properties.price` numeric; `clients.phone` text; soft-delete (`deleted_at`) en clients/properties.

## Clasificación por entidad (estado tras P65)
| Entidad | Acción | Clase | Estado |
|---|---|---|---|
| Tareas | create / complete | A — implementada E2E | ✅ (`tasks.create`, `tasks.complete`) |
| Cartera | update_price | A — implementada E2E | ✅ (`portfolio.update_price`, optimistic lock) |
| Clientes | update_phone | A — implementada (mismo ciclo) | ✅ (`clients.update_phone`) |
| Clientes | create / update resto / add_note | B — requiere ampliar registro | ⏸ futuro (mismo patrón) |
| Cartera | update_status / características | E — decisión funcional (transiciones + coherencia con Operaciones) | ⏸ |
| Operaciones | create / change_stage / won-lost | E — efectos sobre inmueble; requiere regla confirmada | ⏸ |
| Calendario | create / reschedule / cancel | B — validación fecha/tz | ⏸ |
| Trámites | create / update | B | ⏸ |
| Documentos | subir/editar | D — fuera del asistente | ✕ |
| Comisiones | mutaciones | D (solo lectura permitida) | ✕ |
| Facturación | cualquier acción | **D — PROHIBIDA por construcción** (no existe en el registro) | ✕ |

## Infraestructura creada (aditiva)
- Tabla **`assistant_actions`** (RLS: select por workspace; escrituras solo server-side/service):
  estado del ciclo (prepared→confirmed→executing→completed/cancelled/expired/failed/conflict),
  `preview_hash`, `idempotency_key` (única por workspace), `expected_updated_at`, `result_json`,
  `safe_error_code` → sirve además de **audit log**.
- Registro central (`action-registry.ts`) + token de acción (`action-policy.ts`, prefijo `act.`).
- Endpoint `/api/agent/action` (prepare/confirm/cancel/status) — server-to-server como `/api/agent/tool`.
