# FASE S11 — Modal de borrado premium + limpieza segura

> **Fecha:** 2026-06-17 · **Base:** `e4c0093` (S10) → este commit ·
> **Alcance:** sustituir los `window.confirm` nativos por un modal integrado del
> CRM y limpieza segura. Sin tocar executor/confirm del asistente, n8n, schema,
> RLS ni `service_role` frontend.

---

## 1. Problema observado
Al eliminar una conversación en /assistant salía el `confirm` nativo del
navegador ("¿Eliminar permanentemente…?"). Impropio de un CRM premium.

## 2. Confirmaciones nativas encontradas
| Archivo | Acción | Cliente final | Resuelto |
|---|---|---|---|
| `assistant/page.tsx:3056` | eliminar conversación | Sí | ✅ modal |
| `clients/[id]/page.tsx:752` | eliminar documento | Sí | ✅ modal |
| `calendar/page.tsx:1457` | cancelar evento | Sí | ✅ modal |
Re-grep final: **0** `window.confirm` / `confirm(` / `alert(` / `prompt(` reales
en el código (solo quedan menciones en comentarios).

## 3. Solución — componente reutilizable
Nuevo `src/components/ConfirmDialog.tsx` (sin dependencias nuevas):
- Overlay con blur, card centrada, icono, título, descripción, error opcional.
- Botón primario (destructivo en rojo vía `Button variant="danger"`) + Cancelar + X.
- Cierre con **Escape**, overlay y X — **deshabilitados mientras `loading`** (no
  se interrumpe una operación destructiva en curso).
- Controlado: el padre posee `open` y la acción async; props `loading`,
  `loadingLabel`, `error`, `destructive`, `confirmLabel`, `cancelLabel`.
- Accesible: `role="dialog"`, `aria-modal`, `aria-label`.

## 4. Flujos migrados
**Asistente (eliminar conversación):** el botón abre el modal (`archiveConversation`
ahora solo abre); `confirmDeleteConversation` ejecuta el borrado real (copiloto →
`deleteAssistantThread` cascade; inbox → legacy), con `Eliminando…`, y en error
**mantiene el modal abierto con mensaje humano** (no pierde la conversación en UI).
Si el hilo borrado era el activo, selecciona otro o queda empty state limpio.
Limpia caché de mensajes (S6) del hilo borrado.

**Cliente (eliminar documento):** `handleDeleteDocument(doc)` abre el modal con el
título del documento; `confirmDeleteDocument` hace el DELETE y recarga; error
dentro del modal.

**Calendario (cancelar evento):** `requestDelete` mantiene el guard de evento
solo-lectura (toast) y abre el modal; `handleDelete` ejecuta la cancelación
(flujo Google/local intacto); el modal se cierra en el `finally`.

## 5. Estados loading/error
- Asistente y documento: error humano DENTRO del modal (prop `error`), spinner en
  el botón (`Eliminando…`), modal abierto hasta éxito.
- Calendario: mantiene sus toasts existentes (flujo Google con muchos casos), el
  modal muestra spinner y se cierra al terminar.
- Nunca full-page loader; sidebar/topbar estables; sin UUIDs.

## 6. Limpieza de código
- `eslint --max-warnings=0` **garantiza cero imports/vars muertos** en todo el
  repo → no hay imports muertos que limpiar.
- Re-grep confirma 0 confirmaciones nativas reales.
- **No se eliminó nada de forma especulativa** (regla "si hay duda, no borrar"):
  no se encontró un componente/helper con 0 referencias demostrables y seguro de
  borrar sin tocar legacy protegido (Inbox/WhatsApp, n8n, executor, migrations,
  docs, deploy). Candidatos a futuro: barrido de componentes 0-ref con `rg` caso
  a caso (diferido, conservador).

## 7. Qué NO se tocó
Executor/confirm del asistente · lógica de borrado real (solo se cambió el
disparador de confirmación) · n8n · WhatsApp/Meta · Google (flujo de cancelación
intacto) · Storage/RAG · facturación · schema/migraciones · RLS · deps ·
`git reset` · performance S2–S7.

## 8. Validaciones
`tsc --noEmit` ✅ · `eslint --max-warnings=0` ✅ · `next build` ✅
(`✓ Compiled successfully`, 46 rutas).

## 9. Smoke local (build) / checklist navegador (Oier)
Build verde. En navegador: /assistant → Eliminar → **modal integrado** (no confirm
nativo) → Cancelar (no borra) → Eliminar → Confirmar (desaparece, sin full-page
loader, sin alert) → si era activo, UI estable. Ídem documento (ficha cliente) y
cancelar evento (calendario).

## 10. Riesgos pendientes
- Calendario usa toasts para errores (no el `error` del modal) por su flujo
  Google multi-rama; aceptable.
- Smoke navegador pendiente (Oier) tras redeploy.

## Veredicto
**S11 PARCIAL SEGURO — modal de borrado premium en los 3 flujos cliente
(asistente, documento, evento); cero confirmaciones nativas.** Limpieza:
lint-enforced (sin imports muertos), sin borrados especulativos. Validaciones
verdes. Falta smoke navegador (Oier) + redeploy.
