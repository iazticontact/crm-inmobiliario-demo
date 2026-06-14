# Fase 2E-2 RT3 — Calendar (plan, NO implementar aún)

**Fecha:** 2026-06-15 · **Base:** `66467a9` · **Política:** [DATA_REALITY_POLICY.md](DATA_REALITY_POLICY.md)
Sigue a [PHASE_2E2_RT2_IMPLEMENTATION_REPORT.md](PHASE_2E2_RT2_IMPLEMENTATION_REPORT.md).

> Documento de planificación. No implementa nada. Define alcance, riesgos y
> orden para conectar el calendario a datos reales respetando real-vs-demo.

## 1. Objetivo
Convertir `/calendar` en una agenda profesional sobre `calendar_events` reales
del workspace (visitas, citas, llamadas), con la ficha de cliente ya mostrando
los eventos vinculados (RT2). Sin prometer integraciones reales no conectadas.

## 2. Estado actual (auditoría rápida)
- Tabla `calendar_events` con 8 filas reales en el workspace demo.
- `getCalendarEvents(workspaceId)` y `getClientCalendarEvents(workspaceId, name)`
  ya existen en `supabase-queries.ts`.
- La ficha de cliente ya muestra "Visitas y citas" reales (tab calendar) con
  empty state.
- `/calendar` ([src/app/(saas)/calendar/page.tsx](../src/app/(saas)/calendar/page.tsx))
  ya aplica el gate demo (`initialEvents` en demo, Supabase en real).
- Existe infraestructura Google Calendar (`/api/integrations/google/calendar/*`)
  — **fuera de alcance de RT3 base**; no tocar en esta fase.

## 3. Alcance RT3 (propuesto)
1. **Vista mensual/lista real**: confirmar que `/calendar` carga eventos reales
   del workspace, ordenados, con estados de carga/empty/error profesionales.
2. **Detalle de evento** (solo lectura): título, fecha/hora, duración, ubicación,
   tipo, cliente vinculado (link a la ficha) y notas.
3. **Vinculación cliente ↔ evento**: mostrar nombre/enlace del cliente si el
   evento tiene `client_id`/`client_name`; nunca inventar.
4. **Naming/UX**: tipos de evento mapeados a es-ES (visita, llamada, firma,
   reunión…); hoy/próximos destacados.
5. **Empty states**: "No hay citas programadas" sin datos de ejemplo en real.

## 4. Fuera de alcance (NO en RT3 base)
- Google Calendar sync real / OAuth (sub-fase RT3.5 si se decide).
- Crear/editar/borrar eventos reales (escritura) salvo que ya exista seguro.
- Envío de invitaciones, recordatorios automáticos, n8n.
- WhatsApp/Meta, invoices, documents, inbox.

## 5. Riesgos
- `calendar_events` usa columnas opcionales (`date`, `start_hour`, etc.) con
  fallback de schema en el data-layer → mapear con tolerancia, sin asumir.
- Zona horaria / formato de hora: reutilizar `buildCalendarEventTimes`
  ([src/lib/calendar-time.ts](../src/lib/calendar-time.ts)) ya existente.
- No romper la demo offline ni el gate `DEMO_MODE_KEY`.

## 6. Orden recomendado
1. Auditar `calendar/page.tsx` y el mapper de `calendar_events`.
2. Vista real + empty/error.
3. Detalle de evento + enlace a ficha de cliente.
4. Naming es-ES + destacar hoy/próximos.
5. Validar tsc/lint/build + smoke test.
6. (Opcional) RT3.5 Google Calendar.

## 7. Pendiente arrastrado de RT2
- Resolver nombre de responsable de tareas (`assigned_to` UUID → join
  `profiles`) — RT2.5, puede entrar antes o junto a RT3.
