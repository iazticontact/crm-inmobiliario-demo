# Fase 2E-2 RT2 — Ficha de cliente profunda (informe de implementación)

**Fecha:** 2026-06-15 · **Base:** `d67b210` · **Política:** [DATA_REALITY_POLICY.md](DATA_REALITY_POLICY.md)
**Plan previo:** [PHASE_2E2_RT2_TASKS_ACTIVITIES_PLAN.md](PHASE_2E2_RT2_TASKS_ACTIVITIES_PLAN.md)

## 1. Objetivo
Convertir la ficha de cliente en una ficha CRM inmobiliaria profesional: tareas,
actividad, expedientes, inmuebles y operaciones reales de Supabase, con empty
states limpios y sin inventar datos en modo real.

## 2. Archivos tocados
- [src/app/(saas)/clients/[id]/page.tsx](../src/app/(saas)/clients/[id]/page.tsx) — ficha (UI + carga).
- [src/lib/supabase-queries.ts](../src/lib/supabase-queries.ts) — nuevo helper `getClientActivityFeed`.
- [docs/PHASE_2E2_RT2_IMPLEMENTATION_REPORT.md](PHASE_2E2_RT2_IMPLEMENTATION_REPORT.md) — este informe.

No se tocó: rutas, schema/SQL, `.env*`, `.mcp.json`, n8n, Auth, Storage,
`package.json`, ni invoices/documents/inbox.

## 3. Verificación de datos reales (read-only, conector Supabase)
Consultas `SELECT` (sin escrituras) sobre `ylhdbawrllqygfvllhdo`:

| Tabla | Count | Esperado |
|-------|------:|---------:|
| clients | 8 | 8 ✅ |
| properties | 7 | 7 ✅ |
| opportunities | 7 | 7 ✅ |
| service_cases | 5 | 5 ✅ |
| tasks | 10 | 10 ✅ |
| calendar_events | 8 | 8 ✅ |
| activities | 14 | 14 ✅ |

Vinculación por cliente: tasks 9/10 con `client_id`, activities 13/14 con
`client_id`, opportunities 7/7, service_cases 5/5, properties 2/7 (las otras 5
son captaciones sin cliente → empty state correcto). **0 filas fuera del
workspace demo** (`d0000000-…-0001`). Owner `client_admin` vinculado al ws demo.

## 4. Mejoras en la ficha de cliente
- **Header**: además de estado/tipo/área (RT1) y acciones Llamar/Email/Copiar
  (RT1.5), ahora muestra **canal/origen** (`CHANNEL_LABEL`) y **score** real
  (cuando `leadScore > 0`).
- Resumen, contacto, interés y notas editables se mantienen.

## 5. Tareas reales (FASE D)
- **Filtrado robusto**: por `client_id` (preferente) o, si falta, por
  coincidencia de `client_name`. Antes solo se filtraba por substring de nombre.
- **Orden memoizado** (`useMemo`): vencidas → "vence pronto" → resto →
  cerradas; dentro de cada grupo por fecha de vencimiento.
- **UX**: prioridad y estado mapeados a español; **vencidas en rojo**,
  **próximas (≤3 días) en ámbar**; descripción (2 líneas) si existe; título
  tachado si la tarea está cerrada.
- **Mapping estado**: pending/open→Pendiente, in_progress→En curso,
  done/completed→Completada, closed→Cerrada, cancelled→Cancelada (fallback al
  valor crudo). **Prioridad**: low→Baja, normal→Normal, high→Alta.
- `assigned_to` es un UUID de `auth.users` (no un nombre) → **no se muestra**
  para no exponer un id ni inventar nombres. Resolución de nombre del
  responsable queda pendiente (necesita join con `profiles`) → RT2.5.

## 6. Actividad real (FASE E)
- Nuevo helper **`getClientActivityFeed(workspaceId, clientId, clientName)`**:
  consulta `activities` filtrando a nivel de DB por `client_id` **o**
  `client_name ilike`, orden `created_at desc`, limit 20. Resuelve la limitación
  anterior (la ficha dependía del límite global de 12 actividades del workspace).
- **Timeline** con icono por tipo (email/call/message/deal/note), descripción y
  fecha. No se vuelca JSON de metadata. Empty state limpio.
- Naming: el timeline muestra `description` (no `title`), por lo que no aparece
  "Oportunidad" visible. Residual: los `title` que persisten futuras
  `logActivity` ("Oportunidad creada/…") no se muestran en UI (el mapper los
  descarta) → sin impacto visible; alinear a "Operación" queda como limpieza
  menor opcional.

## 7. Expedientes / service_cases (FASE F)
Sección ya existente reforzada: título, tipo, estado (es-ES), **prioridad
cuando no es normal**, vencimiento. Empty state "Sin expedientes abiertos para
este cliente.".

## 8. Inmuebles y Operaciones (FASE G)
- **Operaciones** (no "Oportunidades" en UI): etapa mapeada al pipeline del
  vertical, valor, **probabilidad %** y **fecha de cierre estimada**. Empty
  state "Sin operaciones activas.".
- **Inmuebles**: tipo, operación, ciudad y precio. Empty state "Sin propiedades
  vinculadas a este cliente." (correcto para clientes sin inmueble vinculado).

## 9. Contacto básico
Llamar (`tel:`) / Email (`mailto:`) / Copiar email / Copiar teléfono (RT1.5,
intactos). Sin WhatsApp real: la pestaña es "Conversaciones" (solo lectura).

## 10. Data Reality Policy
- Modo demo (gate `DEMO_MODE_KEY`): mocks demo, escrituras bloqueadas.
- Modo real: Supabase del workspace vía RLS; `getClientActivityFeed` degrada a
  `[]` ante error (sin fallback a mock); empty states profesionales.
- Ningún nombre ficticio nuevo; `service_role` solo server-side.

## 11. Demo offline
Gate y datos demo intactos; la rama demo de la ficha sigue usando
`demoOpportunities/demoServiceCases/demoProperties/demoActivityList`.

## 12. Validaciones
| Check | Resultado |
|-------|-----------|
| `npx tsc --noEmit` | ✅ |
| `npm run lint -- --max-warnings=0` | ✅ |
| `npm run build` | ✅ (46 rutas) |

## 13. Smoke test
DB verificada por consulta read-only (counts arriba). Navegador **pendiente
(Oier)** — `npm run dev -- --webpack`:
- Demo: "Ver demo inmobiliaria" → Clientes → "Ver ficha" → operaciones, tareas,
  actividad y expedientes muestran datos o empty states; sin WhatsApp real.
- Real: login owner → abrir ficha de un cliente con operaciones/tareas/
  actividad reales; verificar vencidas/próximas y badges; sin mocks ni errores
  RLS.

## 14. Riesgos pendientes
- Nombre del responsable de tareas (`assigned_to` = UUID) sin resolver → RT2.5
  (join `profiles`).
- Limpieza opcional de `title` de actividades verticales ("Oportunidad" en
  data-layer, no visible en UI).
- Smoke test en navegador pendiente.

## 15. Siguiente fase recomendada
**RT3 — Calendar** (visitas/citas reales del cliente y del workspace),
respetando la Data Reality Policy. Ver plan en
[PHASE_2E2_RT3_CALENDAR_PLAN.md](PHASE_2E2_RT3_CALENDAR_PLAN.md) si está creado.
