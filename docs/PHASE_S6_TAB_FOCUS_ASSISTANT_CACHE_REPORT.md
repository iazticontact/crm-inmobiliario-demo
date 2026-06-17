# FASE S6 — Tab-focus lag fix + assistant SWR cache

> **Fecha:** 2026-06-17 · **Base:** `935acba` (S5) → este commit ·
> **Alcance:** eliminar el lag de 1-2s al volver de otra pestaña/ventana, y hacer
> la reentrada/cambio de hilo del Asistente instantáneos con cache
> stale-while-revalidate **seguro multi-tenant**. Sin tocar agente OpenAI, tools,
> `/api/assistant/v2`, `/api/assistant/confirm`, executor, prompts, n8n, schema,
> RLS ni `service_role`.

---

## 1. Problema observado (usuario)
Al cambiar de pestaña/ventana del navegador y volver al CRM, el asistente/CRM
"procesa", se queda cargando o laguea 1-2 s.

## 2. Causa exacta encontrada
Supabase emite `TOKEN_REFRESHED` (y a veces `SIGNED_IN`/`INITIAL_SESSION`) cuando
la pestaña recupera el foco. Los DOS suscriptores de identidad —
`WorkspaceIdentityProvider` y `useCurrentUser`— hacían
`clearWorkspaceIdentityCache(); run()` en **cada** evento, y `run()` pone
`isLoading=true` y **re-resuelve identidad por red** (getUser → profiles →
workspaces).

> Es decir: cada vuelta a la pestaña **vaciaba el cache de identidad y re-resolvía
> 3 round-trips**, metiendo toda la app (Sidebar/Topbar/Asistente) en estado de
> carga 1-2 s, sin que el usuario cambiara de usuario. **Esa era la causa.**

## 3. Eventos auth/focus auditados
| Listener | Antes | Ahora |
|---|---|---|
| `WorkspaceIdentityProvider` (onAuthStateChange) | clear + run en **todo** evento | **solo** `SIGNED_OUT` o cambio real de `user.id` → clear + run; token refresh/foco = **no-op** |
| `useCurrentUser` (onAuthStateChange) | clear + run en **todo** evento | idem: solo sign-out o cambio de user |
| `supabase-queries` invalidation (S3) | clear en SIGNED_OUT/cambio user | sin cambios (ya correcto) |
| `assistant-cache` (S6, nuevo) | — | clear en SIGNED_OUT/cambio user |
| `calendar/page` visibility/focus refetch | refetch al volver foco | **sin tocar** (intencional del calendario; no bloquea) |

Resultado: volver a la pestaña con el **mismo usuario** ya **no** re-resuelve
identidad, no pone loading global, no remonta nada → sin lag.

## 4. Cache de threads (FASE C)
Nuevo módulo client-only `src/lib/assistant-cache.ts`:
- `getCachedThreads/setCachedThreads`, clave **`userId::workspaceId`**, TTL 120s.
- Al entrar a `/assistant`: si hay cache, pinta los hilos **al instante** (sin
  loader) y revalida en silencio (`loadConversations({ silent: true })`).
- Sincronización automática vía efecto write-through con `conversationList` +
  `selectedIds` → cubre crear/borrar/resolver sin código extra.
- Revalidate silencioso **preserva la selección** del usuario (no le cambia el
  hilo visible) y **no borra** los mensajes cargados.

## 5. Cache de messages (FASE D)
- `getCachedMessages/setCachedMessages/removeCachedMessages`, clave
  **`userId::workspaceId::threadId`**, TTL 120s.
- Al seleccionar un hilo: si hay mensajes cacheados, se pintan **al instante**; el
  loader "Cargando mensajes..." solo aparece si no hay nada que mostrar.
- Write-through con `localMessages` del hilo activo → cubre el mensaje optimista
  del usuario y la respuesta del asistente.
- Si la revalidación falla, se **conserva** lo mostrado (no se vacía).
- Al borrar un hilo: `removeCachedMessages` limpia su cache.

## 6. Stale-while-revalidate sin loaders agresivos (FASE E)
- `assistantReady` (full loader) sigue siendo latch de una vez (S5): nunca
  reaparece tras el primer mount.
- Estados ya diferenciados: `assistantReady` (inicial), `loadingConversations`
  (lista), `loadingMessages` (hilo activo, solo si no hay cache), `isTyping`
  (envío). No se añaden estados nuevos innecesarios.
- Durante revalidación nunca se sustituye contenido visible por un loader.

## 7. Cambios en auth/focus handling (FASE F)
Provider y `useCurrentUser` ahora guardan el `user.id` resuelto en un ref y solo
re-resuelven si el evento es `SIGNED_OUT` o el `user.id` cambió. `TOKEN_REFRESHED`
/ `SIGNED_IN` repetido / `INITIAL_SESSION` del mismo usuario = no-op. La seguridad
auth no se toca (la sesión sigue refrescándose sola en supabase-js); solo se evita
la UX pesada.

## 8. Seguridad multi-tenant
- Cache **keyed por `userId(::workspaceId(::threadId))`** → imposible leer datos de
  otro usuario/workspace.
- **Solo memoria** del navegador (sin localStorage/sessionStorage); F5 = limpio.
- **Bypass server-side** (`typeof window`) → nunca cache de proceso compartido.
- Invalidación por `onAuthStateChange`: `SIGNED_OUT` y cambio de `user.id` vacían
  todo el cache del asistente.
- RLS intacta; `service_role` solo server; las queries siguen filtrando por
  `workspace_id`.

## 9. Demo mode
La cache solo se escribe en modo real (`isRealMode && workspaceId && user.id`).
En demo no se cachea (clave inválida → no-op). `clearWorkspaceIdentityCache` en
logout + el listener de `assistant-cache` cubren la limpieza.

## 10. Query audit (FASE K)
- `assistant_threads` por `workspace_id` (`idx_assistant_threads_ws_recent`).
- `assistant_messages` solo del hilo activo (`idx_assistant_messages_thread`).
- Sin `public.messages`/`public.conversations`, sin query global, sin fetch de
  inbox/whatsapp en copilot (S5), sin carga de CRM core al entrar. **Sin migración.**

## 11. Limpieza de código (FASE J)
Sin código muerto que retirar (`eslint --max-warnings=0` ya lo garantiza). No se
borró legacy protegido (Inbox/WhatsApp, n8n, executor, migrations, docs).

## 12. Qué NO se tocó
Agente OpenAI / tools / v2 / confirm / executor · prompts · n8n · WhatsApp/Meta ·
Google · Storage/RAG/PDF · facturación · schema/migraciones · RLS · deps ·
`git reset` · calendar focus-refetch (intencional). Skeletons S2 y latch S5 intactos.

## 13. Validaciones
`tsc --noEmit` ✅ · `eslint --max-warnings=0` ✅ · `next build` ✅
(`✓ Compiled successfully`, 46 rutas).

## 14. Smoke local (estático/build)
Build verde. Lógica revisada para el checklist FASE H: volver de pestaña (mismo
user) → sin re-resolución de identidad, sin loader global; reentrada a /assistant
→ hilos desde cache al instante; cambiar de hilo → mensajes desde cache;
crear/enviar/borrar → sin loader global; F5 → limpio; logout → cache vaciada.

## 15. Smoke staging (pendiente, Oier)
Confirmar en navegador: /assistant → crear hilo → enviar → esperar respuesta →
cambiar de pestaña 30-60s → volver: **sin** "Preparando Asistente IA", **sin** lag
fuerte, hilos y mensajes visibles, input responde. Dashboard↔Asistente reentrada
instantánea. F5 limpio. Logout → login (otro user) sin datos previos.

## 16. Riesgos pendientes
- Mensajes sin paginación (futuro).
- La cache es por pestaña/memoria (no compartida entre pestañas) — correcto.
- AuthGate sigue intacto (no bloqueante); unificación futura opcional.

## 17. Próximo paso
Redeploy EasyPanel + smoke navegador del tab-switch (FASE H).

## Veredicto
**S6 PARCIAL SEGURO — CAUSA DEL LAG AL VOLVER DE PESTAÑA ELIMINADA + ASISTENTE
CON CACHE SWR.** El re-resolver identidad en cada evento de foco (la causa real)
está corregido; reentrada/cambio de hilo instantáneos vía cache segura
multi-tenant. Validaciones verdes. Falta el smoke en navegador (Oier) para firmar.
