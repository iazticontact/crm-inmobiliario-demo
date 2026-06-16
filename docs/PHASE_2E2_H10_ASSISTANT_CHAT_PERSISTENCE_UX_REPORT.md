# Phase 2E-2 H10 — Assistant chat persistence fix + intelligent-memory design

> **Fecha:** 2026-06-16 · **Base:** `29ffe16` · Fix de persistencia del chat interno
> + diseño (no implementación) de memoria. El cerebro sigue en el CRM (no n8n).
> Sin `.env.local`, sin service_role frontend, sin `public.conversations`.

## 1. Problema detectado
En el navegador, las consultas del asistente "existían" pero **los mensajes del
usuario no se guardaban** y el hilo no se comportaba como un chat ChatGPT-like.
**Evidencia en producción:** `assistant_threads = 1` pero `assistant_messages = 0`
(hilo creado, cero mensajes persistidos).

## 2. Causa EXACTA
`ensureRealConversation()` (en `assistant/page.tsx`) seguía con la rama de H7
`if (OFFLINE_FORCE_DEV || !ASSISTANT_CONVERSATION_PERSISTENCE)` → para el copiloto
en modo real creaba una **conversación offline con un UUID nuevo** y la dejaba
seleccionada, **pisando el hilo real** creado por "Nueva consulta". Al enviar,
`appendThreadMessage(thread_id = ese UUID offline)` insertaba en
`assistant_messages` con un `thread_id` **inexistente** en `assistant_threads` →
**violación de FK** → el insert fallaba (fail-soft `void`) → **ningún mensaje se
guardaba**. Además, el efecto de carga podía pisar el mensaje optimista con una
lectura vacía de BD (race).

## 3. Fix implementado (`assistant/page.tsx`)
- **`ensureRealConversation` (copiloto):** rama dedicada que **reutiliza el hilo
  real** si ya hay uno seleccionado (`isUuid(selected.id)`) o **crea un
  `assistant_thread` real** con `createAssistantThread` (RLS, client-side). Ya no
  crea conversaciones offline en modo real. La rama `OFFLINE_FORCE_DEV` se deja
  solo para el escape de dev.
- **Anti-race en la carga de mensajes:** la lectura de BD ya **no pisa** mensajes
  optimistas locales con un resultado vacío (`if (realMessages.length === 0 &&
  existing.length > 0) return prev`).
- La rama legacy de Inbox (createAssistantConversation) queda solo para inbox
  (copiloto retorna antes); se simplificó su microcopy.

## 4. Cómo se guardan user/assistant ahora
1. Enviar → `ensureRealConversation` devuelve/crea el **hilo real** (UUID en
   `assistant_threads`).
2. `appendLocalMessage(user)` (UI optimista) + `appendThreadMessage(role=user)`
   (BD, RLS, fail-soft) + autotítulo desde el primer mensaje.
3. `/api/assistant/v2` responde.
4. `appendLocalMessage(ai)` + `appendThreadMessage(role=assistant, prepared_action)`.
5. `last_message_at` se actualiza (touch en `appendThreadMessage`).

## 5. Cómo se reabren los hilos
- Mount: `listAssistantThreads(workspaceId)` → lista de hilos.
- Seleccionar: `listThreadMessages(threadId)` ordenados por `created_at` asc →
  user + assistant. Tras refresh, el hilo y sus mensajes siguen.

## 6. Verificación (DB, rol `authenticated`, RLS, rollback)
Simulado el flujo completo: crear thread + insert `user` + insert `assistant`
(con `prepared_action`) + select → **user_msgs=1, assistant_msgs=1** ✅. RLS
permite al usuario; `anon` sin DML; sin leakage. (Transacción revertida.)

## 7. UX / personalidad
- UX: empty state + placeholder ya mejorados en H8; sin rediseño grande en H10
  (el foco fue el bug de persistencia). Polish visual profundo del layout sigue
  como follow-up recomendado.
- Personalidad: ya reforzada (H8/H9: majo/cercano, emoji ligero, off-topic). Sin
  cambios en H10.

## 8. EXTRA — Memoria inteligente y autoevaluación (DISEÑO, no implementado)
**Auditoría:** no existen tablas de memoria (`assistant_memory`,
`assistant_preferences`, `workspace_ai_settings`, `business_rules`, `*summaries`,
`*suggestions`, `*feedback`) → 0 resultados. **No se implementa ahora** (regla:
nada de auto-mejora autónoma peligrosa). Arquitectura futura documentada en
[AI_ASSISTANT_LONG_TERM_ARCHITECTURE.md](AI_ASSISTANT_LONG_TERM_ARCHITECTURE.md)
§Memoria: tablas propuestas `assistant_memories` (preference|business_rule|summary
|automation_idea, con `approved`/`confidence`) y `assistant_thread_summaries`;
**regla de oro:** el asistente NUNCA auto-modifica código/schema/prompts/automatizaciones;
solo guarda contexto, resume hilos, detecta preferencias y **propone** mejoras
(con confirmación). Autoevaluación = registrar fallos/consultas-sin-respuesta/
acciones canceladas → "sugerencias para el equipo técnico", nunca aplicar solo.

## 9. Qué NO se tocó
Cerebro v2/confirm, executor de escritura, n8n, WhatsApp/Inbox, Storage, Google,
facturación, `public.conversations`/`messages`, schema (sin migración en H10),
`.env.local`, service_role frontend, demo.

## 10. Validaciones
`tsc --noEmit` ✅ · `eslint --max-warnings=0` ✅ · `next build` ✅ (46 rutas).

## 11. Smoke (Oier, navegador)
1. `/assistant` → "Nueva consulta" → "Resumen del CRM" → ves **mensaje usuario +
   respuesta**. 2. **Recarga** → ambos siguen. 3. Reabre el hilo → historial
   completo. 4. "Qué ha pasado recientemente" → actividades reales. 5. Segunda
   consulta → dos hilos. 6. "Crea una operación para Lucía Herrera" → card →
   Cancelar/Confirmar. 7. Demo no persiste. Pásame counts (espero
   `assistant_messages` con roles user+assistant).

## 12. Counts (antes → tras tu smoke)
Antes (real, pre-fix): `assistant_threads=1, assistant_messages=0` (bug). Tras el
smoke con el fix: `assistant_messages` debe subir con user+assistant.

## 13. Veredicto
**H10 COMPLETADO — ASSISTANT CHAT PERSISTENCE OK (fix verificado en BD).** Falta
tu confirmación en navegador (el fix corrige justo lo que viste: 1 hilo / 0
mensajes → ahora persisten user+assistant). Memoria inteligente: diseñada, no
implementada (segura).
