# FASE S5 — Assistant performance deep fix + legacy cleanup seguro

> **Fecha:** 2026-06-16 · **Base:** `bbb7427` (S4) → este commit ·
> **Alcance:** arreglar a fondo la fluidez del **Asistente IA** (entrar lento,
> lag, vuelve a pantalla de carga completa). Sin tocar el cerebro OpenAI, tools,
> `/api/assistant/v2`, `/api/assistant/confirm`, prepared actions, n8n, schema,
> RLS ni `service_role`.

---

## 1. Problema observado (usuario)
- Entrar en la pestaña Asistente tarda más que el resto.
- A veces, **ya dentro**, vuelve a una **pantalla de carga completa**.
- Se lagea / se siente menos fluido que Dashboard/Clientes/Operaciones/Calendario.

## 2. Causa exacta encontrada
El loader a pantalla completa está gateado por `assistantReady`
([assistant/page.tsx:3031]). `loadConversations()` ponía `setAssistantReady(false)`
en **cada** ejecución no-silenciosa. Y el efecto de montaje reejecutaba
`loadConversations` cada vez que cambiaba su identidad (`[updateDiagnostics,
userLoading, userWorkspaceId]`).

`updateDiagnostics` es estable (`useCallback([])`), **pero `userLoading` se
alterna true→false en CADA evento de Supabase auth** (token refresh ~horario,
foco de pestaña, etc.) vía `useCurrentUser`. Resultado:

> **Cada token refresh re-disparaba `loadConversations` → `setAssistantReady(false)`
> → flash del loader a pantalla completa + recarga de TODOS los hilos**, aunque
> el usuario no hiciera nada. Esa era la "pantalla de carga que vuelve sola" y el
> lag intermitente.

Además, al **entrar** en `/assistant`, `useCurrentUser` reejecutaba su propia
cadena de identidad por-montaje (tick `userLoading` true→false) antes de cargar
los hilos → entrada más lenta de lo necesario.

## 3. Cambios aplicados al Asistente
**(0) Identidad desde el provider S3, no `useCurrentUser`.**
`const { currentUser, isLoading: userLoading } = useWorkspaceIdentity()`
(drop-in: misma forma `{ currentUser, isLoading }`). El provider ya está resuelto
en el layout autenticado y **no se desmonta** al navegar, así que al entrar en
`/assistant` el `workspaceId` está disponible **sincrónicamente** (sin tick de
`getUser`) y se elimina una segunda suscripción `onAuthStateChange` en la página.

**(1) Loader a pantalla completa = latch de una sola vez.**
Se eliminó `setAssistantReady(false)` de `loadConversations`. `assistantReady`
arranca `false`, pasa a `true` tras la primera carga y **nunca vuelve a false** →
los refrescos en segundo plano (token refresh, crear/resolver, cambio de
workspace) actualizan la lista **en sitio**, sin flash de "Preparando el
Asistente IA".

**(2) Carga de hilos UNA vez por workspace.**
El efecto de montaje ahora usa `loadedWorkspaceKeyRef` (clave = `workspaceId` o
`'no-workspace'` para demo): solo carga hilos cuando la clave cambia. Los eventos
de auth que alternan `userLoading` **ya no** re-fetchean todos los hilos ni
re-disparan el loader. (Solo un cambio real de workspace recarga.)

**(3) Inbox/WhatsApp settings solo en modo inbox.**
El efecto que leía `getInboxAgentSettings` + `getWhatsappConnection` ahora se
salta si `assistantMode !== 'inbox'`. Inbox es operador-interno; el modo
**copilot** (por defecto, cara-cliente) ya no dispara esas 2 lecturas en cada
entrada. Carga perezosa al cambiar a inbox.

## 4. Cambios en loading states (FASE C)
- `assistantReady` → **solo primer mount** (latch). Nunca pantalla completa en
  acciones internas.
- Lista de hilos: `loadingConversations` (spinner local) en cargas no
  silenciosas; `silent` lo omite (S4) para crear/resolver.
- Mensajes: `loadingMessages` (local, en el área de chat) solo del hilo activo.
- Envío: `isTyping` (pensando) local; el input se deshabilita solo al enviar.
- No se añadieron estados nuevos (los existentes ya cubren la separación pedida);
  evitar churn.

## 5. Cambios en thread list / message flow (FASE E)
- **Sin cambios de fetch** (ya correctos): hilos por `workspace_id` (orden
  `last_message_at desc`), mensajes solo del hilo activo (`listThreadMessages(
  selected.id)`), preservación de mensajes optimistas (no pisa con carga vacía),
  envío optimista, borrado optimista local con rollback de error (toast). Lo que
  faltaba era no **re-disparar** esas cargas por eventos de auth → resuelto en §3.
- `modeConversations` ya está `useMemo`; `msgs` (mensajes del hilo) ya `useMemo`.

## 6. Cambios en renders / memoización (FASE F)
No se añadió memoización nueva: los derivados calientes (`modeConversations`,
`msgs`) ya están memoizados; `filteredConvs`/`assistantStats` son cálculos
triviales sobre listas pequeñas (no fuerzan re-render de hijos memoizados). La
ganancia real venía de **dejar de reejecutar efectos** (§3), no de micro-memo.
Se evita sobre-optimizar.

## 7. Panel derecho (FASE G)
Las tarjetas técnicas (Estado operativo/Sentimiento/Estado técnico/Factura) ya se
gatearon en H13 tras `NEXT_PUBLIC_NOWLABS_INTERNAL`. Tras §3, el panel en modo
copilot **no dispara fetches remotos** (inbox/WhatsApp solo en modo inbox). Sin
cambios adicionales necesarios.

## 8–10. Limpieza de código (FASE I)
- **Eliminado:** la dependencia del Asistente de `useCurrentUser` (sustituida por
  `useWorkspaceIdentity`). Import de `useCurrentUser` retirado del Asistente.
- **Verificado seguro:** `useCurrentUser` sigue exportado y usado por
  dashboard/settings/opportunities/inbox/VerticalPreferenceCard (no se elimina el
  hook). `eslint --max-warnings=0` ya garantiza **cero imports/vars muertas** en
  todo el repo (no hay basura de imports que limpiar).
- **NO eliminado (por seguridad):** rutas Inbox/WhatsApp, n8n bridge dormido,
  executor del asistente, `public.conversations`/legacy para Inbox (operador),
  docs históricos, migrations. Un barrido amplio de componentes "0 referencias"
  queda **diferido** (requiere verificación ripgrep por archivo; no se hacen
  borrados especulativos en este pase).

## 11. Query audit (FASE J)
- `assistant_threads`: índice `idx_assistant_threads_ws_recent (workspace_id,
  last_message_at DESC)`. Carga por `workspace_id`.
- `assistant_messages`: índice `idx_assistant_messages_thread (thread_id,
  created_at)`. Carga solo del hilo activo.
- **Sin** `public.messages`/`public.conversations` para el copiloto interno
  (assistant_threads/messages). Sin query global sin `workspace_id`. RLS intacta.
- Mensajes sin paginación aún (aceptable para tamaños actuales); paginación =
  mejora futura. **Sin migración** en S5.

## 12. Seguridad multi-tenant
El cambio (0) usa el mismo cache/provider S3 (keyed por `user.id`, invalidación
por auth, bypass server-side). Nada de `service_role` en frontend; RLS intacta;
demo mode preservado (clave `'no-workspace'` carga demo). Los cambios son de
control de carga/UI, no tocan datos ni el executor.

## 13. Qué NO se tocó
Cerebro OpenAI / tools / `runNowLabsAgent` · `/api/assistant/v2` ·
`/api/assistant/confirm` / executor · prepared actions · prompts · n8n ·
WhatsApp/Meta · Google · Storage/RAG/PDF · facturación/billing · schema/
migraciones · RLS · deps · `git reset`. Resto de páginas no se tocaron (ya
optimizadas en S2–S4).

## 14. Validaciones
- `tsc --noEmit` ✅ · `eslint --max-warnings=0` ✅ · `next build` ✅
  (`✓ Compiled successfully`, 46 rutas).

## 15. Smoke local (estático/build)
Build verde. Lógica revisada para el checklist FASE K: entrar→shell sin re-tick
de identidad; crear/enviar/reabrir/cambiar/eliminar sin loader completo; token
refresh ya **no** re-dispara loader ni recarga de hilos; demo carga; F5 recarga
limpio.

## 16. Smoke staging (pendiente, Oier)
Confirmar en navegador: entrar a /assistant fluido; dejar la pestaña abierta y
esperar/forzar refresh de sesión → **no** debe aparecer "Preparando el Asistente
IA" sola; crear/enviar/eliminar sin flash; sin `public.messages`; sin errores
consola; sin datos de otro workspace.

## 17. Riesgos pendientes
- Re-entrar en /assistant aún re-fetchea hilos (estado se pierde al desmontar);
  un cache de hilos por workspace (estilo S3) lo haría instantáneo — **diferido**
  por sensibilidad multi-tenant/complejidad.
- Mensajes sin paginación (futuro).

## 18. Próximo paso
Redeploy EasyPanel + smoke navegador del Asistente. Opcional futuro: cache de
hilos por workspace + paginación de mensajes + unificar AuthGate con el resolutor.

## Veredicto
**S5 PARCIAL SEGURO — ASISTENTE SIN LOADER RECURRENTE Y MÁS RÁPIDO AL ENTRAR.**
Causa raíz (token refresh re-disparando el loader/recarga) eliminada; entrada más
rápida vía provider S3; 2 queries menos en copilot; limpieza segura. Validaciones
verdes. Falta el smoke en navegador (Oier) para firmar "10/10".
