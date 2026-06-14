# Fase 2E-2 RT3 — Calendario real + RT2.5 responsables + naming (informe)

**Fecha:** 2026-06-15 · **Base:** `be73f56` · **Política:** [DATA_REALITY_POLICY.md](DATA_REALITY_POLICY.md)
Sigue a [PHASE_2E2_RT2_IMPLEMENTATION_REPORT.md](PHASE_2E2_RT2_IMPLEMENTATION_REPORT.md) ·
plan [PHASE_2E2_RT3_CALENDAR_PLAN.md](PHASE_2E2_RT3_CALENDAR_PLAN.md).

## 1. Objetivo
Calendario real (RT3), nombres de responsables (RT2.5) y limpieza de naming, con
seguridad estricta y sin romper nada.

## 2. Verificación de datos (read-only, conector Supabase `ylhdbawrllqygfvllhdo`)
- Counts: clients 8 · properties 7 · opportunities 7 · service_cases 5 · tasks 10
  · calendar_events 8 · activities 14 ✅
- `calendar_events.type` reales = **`call, demo, follow-up, meeting`**.
- `calendar_events`: 7/8 con `client_id` y `client_name`; **no existe columna
  `assigned_to`** en `calendar_events`.
- `assigned_to` poblado: **tasks 0/10, opportunities 0/7, service_cases 0/5**
  (el seed no asigna responsable a nadie).
- `profiles` = 1 (`Demo Owner`), vinculado al workspace demo. 0 filas fuera del ws.

## 3. RT3 — Calendario real (PRIORIDAD 1)
**Hallazgo:** la página `/calendar`
([calendar/page.tsx](../src/app/(saas)/calendar/page.tsx)) **ya estaba conectada
a `calendar_events` reales** y cumple los requisitos de RT3:
- Carga real vía `getCalendarEvents(workspaceId)` con **gate demo** (`DEMO_MODE_KEY`)
  antes de Supabase; sin fallback a mocks en modo real; workspace resuelto, no
  hardcodeado.
- **Tipos en español** ya mapeados para los 4 tipos reales: `eventTypeConfig`
  (demo→Demo, call→Llamada, meeting→Reunión, follow-up→Seguimiento). No hay tipo
  real sin mapear.
- "Próximos eventos" ya muestra título, **fecha relativa**, hora, **cliente
  vinculado** (icono), etiqueta de tipo/Google, badge solo-lectura y empty state
  ("Sin citas próximas").
- Integración Google Calendar existente (no tocada; fuera de alcance RT3 base).

**Decisión:** no se reescribe la página (madura, ~2.300 líneas con Google
Calendar): hacerlo sería riesgo sin ganancia. RT3 base se considera **verificado /
cumplido**.

**Cambio aplicado (hueco real y seguro):** la pestaña **"Visitas y citas" de la
ficha de cliente** mostraba `event.type` en crudo (inglés). Se añadió
`EVENT_TYPE_LABEL` (visit→Visita, meeting→Reunión, call→Llamada, demo→Demo,
follow-up→Seguimiento, task→Tarea, deadline→Vencimiento) con fallback al valor
crudo, aplicado en la línea de detalle y en la badge.

## 4. RT2.5 — Responsables / assigned_to (PRIORIDAD 2)
**Hallazgo:** `assigned_to` está **vacío** en tasks/opportunities/service_cases
(0 filas) y la columna **no existe** en `calendar_events`. Además:
- La UI **no muestra ningún UUID** como responsable (auditado: el único
  `assigned_to` en pantalla es el campo de **texto** `metadata.assigned_to` del
  cliente —"Responsable"— que el usuario escribe, no un UUID).

**Decisión:** no se añade un mapa `profiles` para resolver `assigned_to`, porque
hoy mostraría "Sin asignar" en el 100% de los casos (ruido sin valor) y no hay
UUID que ocultar. La regla queda documentada para cuando el seed/uso real
empiece a asignar responsables: **resolver `profile.id → full_name/email`;
fallback "Sin asignar"; nunca inventar ni mostrar UUID.** Pendiente real → RT2.5
cuando haya datos de asignación (o al implementar mutaciones, RT4).

## 5. Naming (PRIORIDAD 3)
- Auditoría: **no hay "Oportunidad/Oportunidades" visible** en páginas ni
  componentes (única coincidencia: un patrón de detección de intención del
  asistente sobre texto del usuario, no UI).
- El timeline de actividad muestra `description` (no `title`); los `title` de
  `logActivity` con "Oportunidad" **no se renderizan** (el mapper los descarta).
  Sin impacto visible → no se requiere `formatActivityTitle`. Limpieza opcional
  futura del data-layer.

## 6. Data Reality Policy
Modo demo (gate) usa mocks; modo real usa Supabase/RLS; errores → empty/error
profesional, sin fallback a mock; ningún dato ficticio nuevo; `service_role`
solo server-side.

## 7. Demo offline
Intacta. Calendar y ficha conservan su rama demo.

## 8. Archivos tocados
- [src/app/(saas)/clients/[id]/page.tsx](../src/app/(saas)/clients/[id]/page.tsx)
  — `EVENT_TYPE_LABEL` + uso en pestaña de calendario.
- Docs: este informe + [PHASE_2E2_NEXT_PHASES_ROADMAP.md](PHASE_2E2_NEXT_PHASES_ROADMAP.md).

## 9. Validaciones
| Check | Resultado |
|-------|-----------|
| `npx tsc --noEmit` | ✅ |
| `npm run lint -- --max-warnings=0` | ✅ |
| `npm run build` | ✅ (46 rutas) |

## 10. Smoke test (pendiente Oier — `npm run dev -- --webpack`)
Demo: "Ver demo inmobiliaria" → calendario carga; clientes/ficha/tareas/actividad
ok; sin errores. Real: login owner → calendario muestra los 8 eventos reales (o
empty profesional); clientes 8 / inmuebles 7 / operaciones 7; ficha abre; tipos
de evento en español también en la ficha; **sin UUIDs** como responsables; **sin
"Oportunidades"** visible; sin errores RLS.

## 11. Riesgos pendientes
- RT2.5 efectivo (nombres de responsable) cuando existan asignaciones reales.
- Limpieza opcional de `title` de actividades verticales en data-layer.
- Smoke test navegador pendiente.

## 12. Siguiente fase recomendada
Ver [PHASE_2E2_NEXT_PHASES_ROADMAP.md](PHASE_2E2_NEXT_PHASES_ROADMAP.md):
**RT4 (mutaciones controladas)** como siguiente bloque de valor.
