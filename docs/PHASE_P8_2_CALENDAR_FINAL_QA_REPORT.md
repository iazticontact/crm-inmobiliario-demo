# FASE P8.2 — Calendario final QA polish + preparación Dashboard

> **Fecha:** 2026-06-24 · Pasada quirúrgica de copy/UX + fix de scroll del modal (móvil). Sin
> rediseño, **sin migración**, Google/n8n/Asistente/RLS intactos. Requiere redeploy.

## 1. Diagnóstico visual
- La semana, "Próximas citas" y "Vencen pronto" se ven bien y con datos reales.
- **Copy mezclaba "evento" y "cita"**: modal "Nuevo/Editar/Ver evento", botón "Crear evento",
  "Cancelar evento", "Próximos eventos", toasts "Evento creado/actualizado".
- **Bug móvil real:** el modal de cita no tenía `max-height`/scroll (con ~11 campos podía
  desbordar/cortar el footer en 390px).
- **"Vencen pronto"** podía verse alarmista en demo (muchos vencidos del seed) y sin tope visible.
- Label **"Min"** algo seco.

## 2. Cambios exactos (alto valor, bajo riesgo)
- **Copy "evento" → "cita"** (visible): modal **"Nueva cita / Editar cita / Ver cita"**, botón
  **"Crear cita"**, **"Cancelar cita"** (botón + ConfirmDialog), **"Próximas citas"**, toasts
  **"Cita creada/actualizada"**. (Se mantiene `EventType`/`calendar_events`/etc. en código interno.)
- **Subcopy del modal** (solo al crear): *"Programa una visita, llamada, firma o seguimiento."*
- **Fix scroll modal (móvil):** contenedor `flex max-h-[calc(100vh-2rem)] flex-col`; cuerpo
  `flex-1 overflow-y-auto`; cabecera/footer `shrink-0` → el footer (Crear/Guardar) siempre visible y
  el formulario hace scroll. No desborda en 390px.
- **Label "Min" → "Minuto".**
- **"Vencen pronto":** tope **5 visibles** + línea **"y N más"**; badge de vencidos **ámbar** (no
  rojo alarmista); empty **"Sin vencimientos próximos."**
- **ConfirmDialog de cancelar:** copy ya reforzado *"No se eliminará el cliente, inmueble, operación
  ni trámite vinculado."*

## 3. Qué queda igual (no se tocó por tocar)
- Estructura de la semana/agenda, mini-calendario, leyenda (ya sin "Demo", colores premium), flujo de
  Google, autocompletado y selectores de P8.1, panel "Próximas citas" (ya mostraba hora/tipo/cliente/
  inmueble), data path. La celda semanal sigue compacta (hora + título) a propósito.

## 4. UX final de "Nueva cita"
Cabecera "Nueva cita" + subcopy. Campos: Título* · Fecha · Tipo · Hora · **Minuto** · Duración ·
**Cliente · Inmueble · Operación · Trámite** (selectores con búsqueda) · Ubicación · Notas. Footer:
Cerrar / **Crear cita**. Obligatorios: Tipo, Título, Fecha, Hora. Modal con scroll (móvil OK).

## 5. Panel lateral
- **Próximas citas:** hora · tipo (punto de color) · cliente · inmueble; empty con CTA "Nueva cita".
- **Vencen pronto:** hasta 5 trámites/tareas (vencidos primero), badge ámbar "N vencidos", "y N más",
  enlaces a inmueble/cliente; empty "Sin vencimientos próximos."

## 6. Vista semana
Eventos reales por día/hora con color por tipo; click → modal de detalle/edición; empty state con CTA.
Sin cambios estructurales (ya era premium).

## 7. Detalle / edición / cancelación
El modal de edición muestra tipo, fecha/hora/duración, cliente/inmueble/operación/trámite (selectores)
+ ubicación + notas + **"Abrir ficha: Cliente · Inmueble · Operación"**. Cancelar usa ConfirmDialog
con copy de seguridad (no borra entidades). Guardar refresca **sin F5**.

## 8. Rendimiento
Sin cambios de coste: carga CRM en `Promise.all` + mapas `useMemo` (P8.1), "Vencen pronto" en un
`Promise.all` (P8), sin N+1, sin signed URLs, estado local tras crear/editar/cancelar. Esta fase es
solo copy + CSS (scroll) → **0 queries nuevas**.

## 9. Seguridad
RLS respetada · workspace-scoped · sin service_role en frontend · sin UUID visible · sin PII en docs.

## 10. Validaciones
`npx tsc --noEmit` ✅ · `npm run lint -- --max-warnings=0` ✅ · `npm run build` ✅. Scans: Demo=0 ·
pipeline/expediente/lead/probabilidad=0 · service_role=0 · UUID visible=0 · botón muerto=0.

## 11. Checklist de staging
- [ ] Crear **Visita** con cliente + inmueble → aparece en semana sin F5; "Próximas citas" la lista.
- [ ] Click cita → detalle con links a fichas; cancelar → copy de seguridad, no borra entidades.
- [ ] Crear **Llamada** (15 min), **Seguimiento** con operación, cita con **trámite** (autorellena).
- [ ] Reprogramar conserva vínculos. "Vencen pronto" ≤5 + "y N más", badge ámbar.
- [ ] **Móvil 390:** el modal de cita hace scroll y el botón "Crear cita" es accesible (no se corta).
- [ ] Workspace vacío: empty states con CTA, sin "Demo".

## 12. Datos recomendados para el Dashboard final (siguiente fase)
El Calendario y el resto de módulos ya exponen, vía helpers RLS, lo necesario para un Dashboard
premium. Recomendado alimentarlo con (todo workspace-scoped, `Promise.all`, mapas por id):

| Tarjeta Dashboard | Fuente | Helper / filtro |
|---|---|---|
| **Citas de hoy** | `calendar_events` | `getCalendarEvents({from,to})` filtrando `date === hoy`, no `cancelled` |
| **Próximas visitas** | `calendar_events` | `type='visit'`, `date >= hoy`, orden por fecha (top 3–5) |
| **Llamadas pendientes** | `calendar_events` | `type='call'`, `date >= hoy` |
| **Vencimientos críticos** | `service_cases` + `tasks` | `due_date` próximo/vencido, abiertos (reutilizar lógica de `UpcomingDeadlinesPanel`) |
| **Operaciones en seguimiento** | `opportunities` | `listOpportunities` no terminales (`commStateOf != won/lost`) + valor potencial |
| **Trámites vencidos** | `service_cases` | abiertos con `due_date < hoy` |
| **Inmuebles activos / histórico** | `properties` | `isClosedPropertyStatus` (activos vs vendidos/alquilados/archivados) |
| **Comisiones pendientes / cobradas** | `opportunities` | `commission_status` + `commissionOf` (de la pestaña Comisiones) |
| **Tareas del día** | `tasks` | `due_date === hoy`, abiertas |

Sugerencia: extraer un `getDashboardSnapshot(workspaceId)` que haga **un** `Promise.all` de
`calendar_events + opportunities + service_cases + tasks + properties + clients` y derive todas las
tarjetas con `useMemo`, reutilizando `commStateOf/commStateLabel`, `isClosedPropertyStatus`,
`commissionOf` y la lógica de vencimientos. Así el Dashboard no duplica queries ni reglas.

## Veredicto
**P8.2 COMPLETADO — CALENDARIO FINAL PREMIUM.** Copy coherente ("cita" en todo lo visible), modal con
scroll usable en móvil, "Vencen pronto" calmado y acotado, y panel lateral claro. Sin rediseño, sin
migración, sin tocar Google/n8n/Asistente/RLS. `tsc`/`lint`/`build` en verde. Documentados los datos
del Calendario/CRM que alimentarán el **Dashboard final** (siguiente fase). Requiere redeploy.
