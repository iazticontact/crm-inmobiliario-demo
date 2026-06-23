# FASE P8.1 — Calendario 100% conectado: pickers de entidad en "Nueva cita"

> **Fecha:** 2026-06-24 · Cierra el pendiente de P8: "Nueva cita" ahora enlaza de verdad
> `client_id / property_id / opportunity_id / case_id`. **Sin migración** (las columnas ya existían).
> Requiere redeploy.

## 1. Diagnóstico inicial
P8 dejó el calendario premium pero el formulario "Nueva cita" solo guardaba `clientName` (texto): no
enlazaba cliente/inmueble/operación/trámite. La conexión solo se veía en "Vencen pronto".

## 2. Qué faltaba para cerrar P8
Convertir el formulario en CRM real: selectores de cliente/inmueble/operación/trámite, autocompletado
de relaciones, persistencia de los `*_id`, y mostrar el contexto (links) en el evento.

## 3. Columnas/relaciones verificadas (auditoría)
- `calendar_events` **ya tiene** `client_id, property_id, opportunity_id, case_id` (+ `title, type,
  date/start_hour/start_minute/duration, start_at/end_at, location, notes, status, metadata`).
  **No hizo falta migración.**
- `getCalendarEvents` hace `select('*')` → las columnas de enlace ya volvían; faltaba **mapearlas**.
- Datos de ejemplo: de 8 eventos, **7 con cliente, 4 con inmueble, 7 con operación** → el contexto se
  ve en el demo de inmediato.

## 4. Cambios en "Nueva cita"
- **4 selectores** (`EntitySelect`, combobox ligero sin dependencias, busca por texto, muestra
  nombre humano nunca UUID, limpiable):
  - **Cliente** — "Nombre · email · teléfono".
  - **Inmueble** — "Título · Ref · Ciudad".
  - **Operación** — "Título · Cliente · Estado comercial".
  - **Trámite** — "Título · Cliente · Estado · vence".
- **Ubicación** (nuevo campo) — se autocompleta con la dirección del inmueble.
- **Duración por tipo** respeta edición manual (`durationTouched`): solo aplica el default si el
  usuario no tocó la duración.
- Obligatorios: **Tipo, Título, Fecha, Hora**. Todo lo demás opcional. Si no hay datos, el selector
  dice "Sin clientes/inmuebles… disponibles" y **no bloquea** crear la cita.

## 5. Autocompletado inteligente (solo rellena lo vacío; todo editable)
- **Cliente** → guarda `client_id` + nombre.
- **Inmueble** → `property_id`; si la ubicación está vacía, la rellena con la dirección; si no hay
  cliente y el inmueble tiene propietario, lo sugiere; sugiere título si estaba vacío.
- **Operación** → `opportunity_id`; rellena cliente e inmueble si faltan (desde la operación);
  sugiere título.
- **Trámite** → `case_id`; rellena operación si la tiene, y desde ella/su `property_id`
  cliente/inmueble/ubicación; sugiere título.
- Título sugerido por tipo: Visita/Valoración → "{tipo} — {inmueble}"; resto → "{tipo} — {cliente}".
  **Nunca** sobreescribe campos que el usuario ya rellenó.

## 6. Render de eventos (contexto)
- **"Próximos eventos"**: ahora muestra **cliente** + **inmueble** (chip con su título).
- **Detalle/edición** (modal): al editar un evento guardado con vínculos, fila **"Abrir ficha:
  Cliente · Inmueble · Operación"** con enlaces reales (`/clients/[id]`,
  `/opportunities/properties/[id]`, `/opportunities`).
- Celda semanal: se mantiene compacta (hora + título), sin saturar.

## 7. Backend / data path
- `CalendarEvent` (tipo): +`propertyId, opportunityId, caseId`.
- `mapSupabaseCalendarEvent`: mapea los 3 nuevos ids.
- `CalendarEventPayload`: +`propertyId/opportunityId/caseId` (`string | null`).
- `toCalendarEventRow`: escribe `property_id/opportunity_id/case_id` **solo si vienen en el payload**
  (`undefined` → no se toca) para **no borrar relaciones en updates parciales** (p. ej. el
  reprogramado del Asistente, que no envía estos campos).
- `optionalColumns` (create+update): +los 3 (degradación segura si faltara alguna columna).
- `toForm` / `payloadFromCalendarEvent` (calendar page): incluyen los ids + `location`.

## 8. Edición / Delete
- **Edición**: usa los mismos selectores; reprograma fecha/hora/duración; guarda relaciones;
  `loadEvents()` refresca tras guardar (**sin F5**).
- **Cancelar/eliminar**: ya existía (status='cancelled' con fallback a delete, RLS verificada en
  P-anteriores). Copy del ConfirmDialog reforzado: *"No se eliminará el cliente, inmueble, operación
  ni trámite vinculado."*

## 9. Rendimiento
- Entidades CRM cargadas en **un `Promise.all`** (clients+properties+opportunities+cases) en un
  efecto propio keyed por workspace. **Mapas por id con `useMemo`**, opciones con `useMemo`. **Sin
  N+1, sin signed URLs, sin dependencias nuevas.** Estado local tras crear/editar (loadEvents).
- "Vencen pronto" (P8) intacto.

## 10. Seguridad
RLS respetada (helpers workspace-scoped). **Sin service_role en frontend.** Nunca se muestran UUIDs
(los selectores muestran nombres). Sin PII en seed/docs. Sin tocar otros workspaces.

## 11. Qué NO se tocó
n8n · **Asistente/Agente V2** (su reprogramado parcial NO borra los nuevos vínculos, por el mapeo
`undefined`-preserving) · **Google Calendar** OAuth/sync (intacto) · Auth · Storage/RLS · secretos ·
facturación/comisiones. Cartera/Clientes: solo lecturas compartidas (queries existentes) y el tipo
`ServiceCaseRow` +`property_id?` (aditivo).

## 12. Validaciones
`npx tsc --noEmit` ✅ · `npm run lint -- --max-warnings=0` ✅ · `npm run build` ✅. Scans: sin
Demo/pipeline/expediente/lead/probabilidad · sin service_role/secretos · sin UUID visible · sin botón
muerto.

## 13. Archivos
- `src/components/EntitySelect.tsx` (nuevo) · `src/app/(saas)/calendar/page.tsx` (form + pickers +
  autocompletado + render) · `src/lib/types.ts` (CalendarEvent) · `src/lib/supabase-queries.ts`
  (payload/mapper/row/optionalColumns) · `src/lib/vertical-queries.ts` (`ServiceCaseRow.property_id?`).

## 14. Checklist de staging
- [ ] Crear **Visita** con cliente + inmueble → aparece en semana y "Próximos eventos" **sin F5**.
- [ ] Click evento → detalle con **"Abrir ficha: Cliente/Inmueble/Operación"**; los links abren la
      ficha correcta.
- [ ] Crear **Llamada** con cliente (sin inmueble) → 15 min por defecto.
- [ ] Crear **Seguimiento** con **operación** → autorellena cliente/inmueble; título sugerido.
- [ ] Crear cita con **trámite** → autorellena operación/cliente/inmueble.
- [ ] Seleccionar inmueble → **ubicación** se rellena sola (editable).
- [ ] Cambiar tipo cambia la duración solo si no la tocaste.
- [ ] Reprogramar un evento conserva sus vínculos. Cancelar muestra el copy de seguridad.
- [ ] Móvil 390: formulario y selectores legibles. Workspace vacío: "Sin … disponibles", sin bloquear.

## 15. Pendientes honestos
- El reprogramado del **Asistente** sigue sin enviar vínculos (no los borra, pero tampoco los añade):
  es correcto y esperado (la IA reprograma, no reasigna entidades).
- Selector de operación/trámite muestra **todas** (no filtra por cliente/inmueble ya elegido); con
  el volumen típico de una agencia es suficiente. Filtrado contextual = mejora futura opcional.

## Veredicto
**P8.1 COMPLETADO — CALENDARIO 100% CONECTADO AL CRM.** "Nueva cita" es un formulario CRM real:
selectores de cliente/inmueble/operación/trámite con autocompletado seguro, persistencia de los
`*_id`, contexto y enlaces en el evento, edición/cancelación coherentes, rendimiento sin N+1 y sin
tocar Google/n8n/Asistente/RLS. `tsc`/`lint`/`build` en verde. Requiere redeploy.
