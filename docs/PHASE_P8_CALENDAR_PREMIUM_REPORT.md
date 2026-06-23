# FASE P8 — Calendario premium conectado al CRM

> **Fecha:** 2026-06-24 · Tipos de evento inmobiliarios + panel "Vencen pronto" (trámites/tareas) +
> copy + refresco del seed de ejemplo. **Migración**: CHECK de `type` ampliado (aditivo) + seed del
> workspace de ejemplo. Requiere redeploy.

## 1. Diagnóstico inicial (auditoría)
- **Schema** (`calendar_events`): ya tiene `client_id, property_id, opportunity_id, case_id`, además
  de `type, date, start_hour, start_minute, duration, location, notes, status, start_at/end_at` y
  campos de Google. **El modelo soporta conexión total con el CRM.** `tasks` y `service_cases`
  tienen `due_date` (+ enlaces a cliente/inmueble/operación).
- **Causa real del "vacío":** la página **sí** lee datos reales (`getCalendarEvents`), pero los 8
  eventos de ejemplo estaban en **2026-06-15…19 (pasado)**; hoy es 06-24 → la semana actual y
  "Próximos eventos" salían vacíos. **No era un bug de código, era seed caducado.**
- **"Demo"**: el tipo `demo` (legacy) = en realidad una **visita** a inmueble (las citas de ejemplo
  eran "Visita piso…" con `type:'demo'`). No tenía sentido comercial en la leyenda.
- La página ya es premium (mini-calendario, semana, agenda, Google real, empty states inteligentes).
  No procedía rediseñar: procedía **conectar y refrescar**.

## 2. Qué estaba roto/flojo
- Seed caducado → agenda vacía. · "Demo" en leyenda/tipos. · Sin sección de **vencimientos** de
  trámites/tareas (la conexión con Cartera/Clientes no se veía). · Copy con "disponibilidad" (Google
  no siempre conectado). · Tipos pobres (4) sin Firma/Valoración.

## 3. Qué datos carga ahora
- **Eventos reales** (`getCalendarEvents`) — tras el refresco del seed, en la **semana actual**.
- **"Vencen pronto"** (nuevo): **trámites** (`service_cases`) y **tareas** (`tasks`) abiertos con
  vencimiento en los próximos 14 días o ya vencidos, cargados aparte (`Promise.all`, mapeo por id).
- Mapas de **clientes** e **inmuebles** por id para enlazar.

## 4. Vista semana / tipos
- **Tipos inmobiliarios** (sin "Demo"): **Visita · Llamada · Reunión · Seguimiento · Firma ·
  Valoración · Otro**, con colores premium y leyenda autogenerada. Lookup **tolerante**
  (`styleForType`): un tipo legacy/desconocido ("demo") nunca rompe el render → se muestra como
  Visita/Otro.
- **Duración por defecto por tipo** al elegirlo en "Nueva cita": Visita 60 · Llamada 15 · Reunión 45
  · Seguimiento 30 · Firma 60 · Valoración 45 · Otro 30.

## 5. Panel lateral
- Se mantiene mini-calendario + **"Próximos eventos"** (ya premium, con su empty state).
- **NUEVO "Vencen pronto"**: lista compacta de trámites/tareas con icono (Trámite/Tarea), título,
  **vencimiento** ("vence hoy/mañana/en N días" o "venció hace N días" en rojo), y **enlace** al
  **inmueble** (`/opportunities/properties/[id]`) o al **cliente** (`/clients/[id]`). Badge "N
  vencidos". Empty state claro. Es la conexión visible Agenda ↔ Cartera/Clientes.

## 6. Nueva cita
- Selector de **tipo** = los 7 tipos reales (sin "Demo"); aplica la **duración por defecto** del tipo.
- **Llamada rápida** (botón flotante) auditado: **es real** (abre "Nueva cita" pre-rellena como
  Llamada de 15 min). Se mantiene.
- Placeholder de título → "Visita piso — Calle Mayor 14".

## 7. Conexiones con Clientes/Cartera
- **Vencen pronto** enlaza cada trámite a su **inmueble** (o cliente) y cada tarea a su **cliente**.
- "Próximos eventos" muestra el **cliente** del evento (los eventos llevan `client_id`/`client_name`).
- Los formularios de **evento desde Cliente** (ficha 360) ahora usan los **mismos tipos**
  (Visita/Firma/Valoración…), por coherencia.

## 8. Tareas / vencimientos
- Trámites (`service_cases.due_date`) y tareas (`tasks.due_date`) abiertos → **"Vencen pronto"**.
- Seed de ejemplo refrescado para que haya datos vivos (ver §13).

## 9. Qué NO se tocó
n8n · **Asistente IA / Agente V2** (sigue escribiendo/leyendo `calendar_events` igual; el CHECK es
superset, no rompe) · Auth/onboarding · **Google Calendar** (integración real intacta, no se añadió
nada falso) · Storage/RLS · secretos · service_role (no se usa en frontend) · facturación. Clientes:
solo se alinearon las **opciones de tipo de evento** (mínimo).

## 10. Seguridad
- RLS respetada (todas las lecturas son workspace-scoped vía los helpers existentes). **Sin
  service_role en frontend.** Sin UUIDs visibles. Seed acotado al **workspace de ejemplo**, sin PII.

## 11. Rendimiento
- "Vencen pronto" carga en **un `Promise.all`** (tasks + cases + clients + properties), **mapeo por
  id, sin N+1, sin signed URLs**. Componente self-contained (no interfiere con el estado/efectos del
  grid ni con la sincronización de Google). El grid de eventos no cambió su coste.

## 12. Migración
`20260624_p8_seed_example_calendar_refresh.sql` (aplicada):
1. **CHECK** `calendar_events_type_check` ampliado (aditivo, superset): añade
   `visit/signing/valuation/other`, mantiene `call/meeting/follow-up/demo` (compat. agente/datos).
2. **Seed ejemplo** (idempotente): reancla eventos y tareas a la **semana actual** y migra
   `type='demo'` → `'visit'`. Acotado a `workspace d0000000-…-0001`.

## 13. Datos de ejemplo (verificado)
- Eventos: 8 en la **semana actual** (06-22…06-26), tipos `visit/call/meeting/follow-up`.
- "Vencen pronto": **Tasación adosado Las Encinas** (vence en 2 días) y **Gestión hipoteca chalet Los
  Robles** (en 5 días), ambos con enlace a su inmueble; + tareas vencidas.

## 14. Validaciones
- `npx tsc --noEmit` ✅ · `npm run lint -- --max-warnings=0` ✅ · `npm run build` ✅.
- Scans: sin "Demo" visible · sin pipeline/lead/expediente/probabilidad · sin service_role/secretos ·
  sin UUID visible · "Llamada rápida" no es botón muerto.

## 15. Checklist de staging
- [ ] La **semana actual** muestra eventos (visitas/llamadas/reuniones/seguimiento) con su color.
- [ ] **Leyenda** sin "Demo" (Visita/Llamada/Reunión/Seguimiento/Firma/Valoración/Otro [+ Google]).
- [ ] **"Próximos eventos"** lista citas reales con cliente.
- [ ] **"Vencen pronto"** muestra trámites/tareas con vencimiento + enlace a inmueble/cliente; los
      enlaces abren la ficha correcta; "venció hace N días" en rojo.
- [ ] **Nueva cita**: tipo Visita por defecto; al cambiar tipo cambia la duración; crear refresca sin
      F5; **Llamada rápida** abre cita de 15 min.
- [ ] Evento desde **ficha de cliente** ofrece los nuevos tipos.
- [ ] Workspace vacío → empty states premium, sin "Demo", sin errores. Móvil 390 usable (vista
      agenda/lista).
- [ ] Google Calendar (si conectado) sigue funcionando igual.

## 16. Pendientes honestos (ojo humano / próxima iteración)
- **Nueva cita conectada a entidad**: el formulario captura `clientName` (texto) pero **no** enlaza
  todavía `client_id/property_id/opportunity_id/case_id` con selectores en el alta. Requiere
  extender el tipo `CalendarEvent` (frontend) + el mapeo de `createCalendarEvent/updateCalendarEvent`
  (hoy solo persiste `client_id`) + pickers en el modal (archivo de 2.5k líneas). Se deja
  documentado para hacerlo con seguridad. La conexión **ya es visible** vía "Vencen pronto" + el
  cliente en "Próximos eventos".
- **Detalle de evento**: enlaces directos "ver cliente/inmueble" desde el modal de edición (los
  eventos llevan `clientId`, pero no `propertyId/opportunityId` en el tipo del frontend).

## Veredicto
**P8 PARCIAL SEGURO.** El calendario deja de estar vacío y se siente **premium y conectado**: tipos
inmobiliarios (sin "Demo"), agenda con datos reales en la semana actual, **panel "Vencen pronto"** que
enlaza trámites/tareas con sus inmuebles/clientes, duraciones por tipo y copy limpio — sin tocar
Google/n8n/Asistente/RLS. Queda como **pendiente honesto** el enlazado de entidad (cliente/inmueble/
operación/trámite) **dentro del formulario de Nueva cita**, documentado para una iteración acotada.
