# Phase 2E-2 H12 — Assistant productization (delete fix + UX/personality)

> **Fecha:** 2026-06-16 · **Base:** `d897b3c` · Bugfix de borrado + limpieza UI +
> comportamiento de empleado IA. Cerebro en el CRM (no n8n). Sin `.env.local`,
> sin service_role frontend, sin tocar schema (la migración H8 ya bastaba).

## 1–3. Bug de eliminar — causa y fix
- **Error:** al pulsar "Eliminar" → `Could not find the table 'public.messages'`.
- **Causa exacta:** el handler `archiveConversation` llamaba a
  `deleteConversationPermanently(selected.id, …)` (helper legacy que borra de
  `public.conversations` + `public.messages`, tablas de Inbox/WhatsApp diferidas e
  inexistentes) también para el copiloto interno.
- **Fix:** nuevo `deleteAssistantThread(threadId)` en `assistant-threads.ts`
  (DELETE en `assistant_threads`; por **FK ON DELETE CASCADE** se borran sus
  `assistant_messages`; RLS `at_delete`, client-side, sin service_role). El handler
  del copiloto usa este; Inbox (operador) mantiene el legacy. **Verificado en BD**
  (rol authenticated, RLS, rollback): borrar el hilo deja `threads_left=0,
  msgs_left=0` (cascade OK). No hizo falta migración nueva.

## 4. Limpieza UI (cliente)
- **Badge técnico `lastAgentMode`** ("Agente n8n / Modo respaldo / Agente local"):
  oculto salvo `NOWLABS_INTERNAL`.
- Microcopy: **"Backend agent" → "Copiloto activo"**; **"OpenAI/tools server-side"
  → "Datos reales del workspace"**.
- (Recordatorio: el modo **Inbox** del asistente y sus botones legacy
  teléfono/email/resolver/sentimiento ya están **ocultos al cliente** desde H4; el
  cliente solo ve el Copiloto. Lead Score oculto desde H11.)

## 5. Personalidad (system prompt) — empleado IA
- **No terminar cada respuesta con una pregunta** ("¿quieres revisar algo?");
  responde, aporta y para.
- **"¿Cómo funcionas?"**: explicación honesta y no técnica (copiloto conectado al
  CRM; busca datos reales; prepara acciones; pide confirmación; guarda la
  conversación). Nunca "no tengo detalles técnicos que compartir".
- **"¿Qué puedes hacer?"**: capacidades concretas + 1-2 ejemplos.

## 6. Panel derecho
Microcopy del panel suavizado (Copiloto activo / Datos reales del workspace) y
badge técnico oculto. Un rediseño visual profundo del panel (colapsable / "Ayuda
rápida") queda como follow-up; H12 prioriza el bug + honestidad de textos.

## 7–8. Persistencia y delete verificados
- Persistencia user+assistant: arreglada y verificada en H10 (BD).
- Delete: verificado en BD (cascade + RLS). En navegador: pendiente confirmación
  de Oier (ya no debe salir el error de `public.messages`).

## 9. Auditoría schema del asistente
`assistant_threads`/`assistant_messages`: RLS ON, policies select/insert/update/
delete (threads) + select/insert/delete (messages), GRANT DML a `authenticated`,
índices (ws+last_message_at; thread+created_at), **FK thread_id ON DELETE CASCADE**,
trigger updated_at, workspace_id NOT NULL. **Base correcta para el copiloto** (sin
cambios en H12).

## 10. Qué NO se tocó
Cerebro v2/confirm, executor, n8n, WhatsApp/Inbox routes, Storage, Google,
facturación, `public.conversations`/`messages` (salvo dejar de usarlos en copiloto),
schema/migraciones, `.env.local`, service_role frontend, demo guard.

## 11. Validaciones
`tsc --noEmit` ✅ · `eslint --max-warnings=0` ✅ · `next build` ✅ (46 rutas).

## 12. Riesgos / próximo paso
- Rediseño visual profundo del panel derecho/layout = follow-up (no crítico).
- Smoke (Oier): crear consulta → enviar → recargar → **eliminar (sin error)** →
  empty state/otro hilo; conversación natural ("cómo funcionas", "qué puedes hacer",
  cliente al azar) sin score, sin preguntas en bucle.

## 13. Veredicto
**H12 COMPLETADO — ASISTENTE PRODUCTIZADO (núcleo):** borrado arreglado (hilos
reales + cascade, sin `public.messages`), UI cliente sin etiquetas técnicas
visibles, personalidad de empleado IA (explica cómo funciona, no pregunta en
bucle). Rediseño visual profundo del panel = follow-up.
