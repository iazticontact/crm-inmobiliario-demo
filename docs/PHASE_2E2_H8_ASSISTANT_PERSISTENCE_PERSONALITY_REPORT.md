# Phase 2E-2 H8 — Asistente: persistencia real + personalidad + UX

> **Fecha:** 2026-06-16 · **Base:** `33f4c8d` · El cerebro sigue en el CRM (no n8n).
> Sin tocar `.env.local`, sin service_role en frontend, sin romper prepare/confirm
> ni demo. Migración aplicada (ver §6).

## 1. Estado Git inicial
HEAD `33f4c8d` (H7.1), working tree limpio.

## 2. Auditoría (qué estaba bien / qué mal)
- **Sólido (se conserva):** el cerebro real — `/api/assistant/v2` (prepare) +
  `/api/assistant/confirm` (execute), agente OpenAI (`nowlabs-main-agent.ts`, 28
  tools), prepared actions/confirm cards, guardrails anti-invención, demo guard.
- **Roto/filler:** la persistencia leía/escribía `public.conversations`/`messages`
  (Inbox/WhatsApp, inexistentes → PGRST205 silenciado); la única "persistencia"
  era sesión local en memoria/localStorage; muchos paneles de diagnóstico.
- **Decisión de arquitectura:** crear persistencia **dedicada** del copiloto
  (`assistant_threads` + `assistant_messages`), **independiente** de Inbox/WhatsApp,
  con RLS por workspace. Repointar la carga/creación/escritura del módulo a estas
  tablas. No mover nada del cerebro a n8n.

## 3. Decisión de arquitectura para persistencia
Tablas nuevas (no se reutiliza `conversations` porque es de Inbox/WhatsApp):
- `assistant_threads(id, workspace_id, user_id, title, status, last_message_at, …)`
- `assistant_messages(id, workspace_id, thread_id, role, content, message_type,
  prepared_action jsonb, metadata jsonb, created_at)`
RLS por workspace vía `current_workspace_ids()`; threads además exigen
`user_id = auth.uid()` al insertar. **GRANT DML solo a `authenticated`** (lección
H6B), `anon` sin DML. Persistencia **client-side con RLS** (nunca service_role).

## 4. Cambios implementados
- **Schema:** migración `20260616_2e2_assistant_threads.sql` (tablas + RLS +
  índices + trigger updated_at + grants). **Aplicada** al proyecto (§6).
- **Runtime lib:** `src/lib/assistant-threads.ts` — `listAssistantThreads`,
  `createAssistantThread`, `listThreadMessages`, `appendThreadMessage`,
  `renameAssistantThread` (devuelven formas `Conversation`/`Message`).
- **Wiring (`assistant/page.tsx`):**
  - Carga: el copiloto lista **hilos reales** (`listAssistantThreads`) en vez de
    `getAssistantConversations` (conversations).
  - "Nueva consulta": crea un **thread real** (`createAssistantThread`) y lo abre.
  - Reabrir hilo: carga sus mensajes con `listThreadMessages`.
  - Enviar: persiste mensaje de usuario y de asistente con `appendThreadMessage`
    (fail-soft); autotítulo del hilo desde el primer mensaje (`renameAssistantThread`).
  - → Las consultas **persisten, se reabren y sobreviven al refresh**. Ya no es
    "session-only". El cerebro (`v2`/`confirm`) y las acciones confirmadas
    (operaciones/tareas + activity vía RLS) **no se tocan**.
- **Personalidad (FASE D):** `nowlabs-main-agent.ts` (PERSONALIDAD Y TONO) más
  **majo y cercano** (compañero de equipo), cálido sin relleno, emoji ligero
  cuando aporta; mismo ajuste en el **fallback determinista** (`ai.ts`).
- **UX (FASE C/E):** empty state del copiloto más premium y claro ("Tu copiloto
  del CRM, listo… 👋", explica que se guardan las consultas), placeholder del
  input más útil. *(Rediseño visual profundo del layout = follow-up recomendado;
  no se reescribe la página de 3,4k líneas en caliente para no arriesgar el flujo
  que funciona.)*

## 5. Archivos tocados
- `supabase/migrations/20260616_2e2_assistant_threads.sql` (nuevo)
- `src/lib/assistant-threads.ts` (nuevo)
- `src/app/(saas)/assistant/page.tsx` (wiring + UX copy)
- `src/lib/agents/nowlabs-main-agent.ts` (personalidad)
- `src/lib/ai.ts` (personalidad fallback)
- docs (este report + smoke report)

## 6. Migración: nombre / aplicada / verificación
- **Nombre:** `2e2_assistant_threads` (archivo `20260616_2e2_assistant_threads.sql`).
- **Aplicada:** SÍ, al proyecto `ylhdbawrllqygfvllhdo` (vía MCP `apply_migration`,
  `{"success": true}`). También versionada en el repo.
- **Verificación RLS (como rol `authenticated`, auth.uid() = usuario real):**
  insert de thread + message OK; select OK (threads_visible=1, messages_visible=1),
  en transacción con rollback → sin datos de prueba. Grants correctos
  (authenticated), anon sin DML.
- **Counts:** las tablas nuevas quedan vacías (0 threads/0 messages) hasta que
  Oier use el asistente; el resto del esquema/seed **intacto**.

## 7. Qué NO se tocó
Cerebro del asistente (v2/confirm/agente), n8n, Inbox/WhatsApp, Storage, Google,
`.env.local`, service_role en frontend, RLS de tablas core, demo mode, prepare→
confirm. El copiloto **no** depende de `conversations`/`messages`.

## 8. Validaciones
`tsc --noEmit` ✅ · `eslint --max-warnings=0` ✅ · `next build` ✅ (46 rutas).

## 9. Smoke tests ejecutados (a nivel DB) + pendiente navegador
- DB: insert/select de threads+messages bajo RLS como el usuario real ✅ (rollback).
- **Navegador (Oier):** ver §11 checklist.

## 10. Riesgos pendientes
- El rediseño visual profundo del layout (columna derecha, jerarquía) queda como
  follow-up; H8 entrega persistencia real + personalidad + UX copy.
- `prepared_action` se guarda en `assistant_messages` solo si se pasa; el render de
  la card sigue viniendo del estado en vivo (no se rehidrata la card al reabrir un
  hilo — futuro menor).
- La migración debe entrar al provisioning de staging/prod (igual que la de grants).

## 11. Próximo paso (Oier, navegador) — smoke
1. Hard refresh → `/assistant`. 2. "Nueva consulta" → **Consulta interna lista**,
sin error. 3. "Resumen del CRM" / "Qué operaciones abiertas tengo" / "Qué
expedientes abiertos hay" / "Qué tareas pendientes tengo" → responde con datos
reales y **tono más majo**. 4. **Refresca la página** → la consulta y sus mensajes
**siguen ahí** (persistencia real); ábrela desde la lista. 5. Crea **otra** consulta
→ ambas en la lista. 6. "Crea una operación para Lucía Herrera" → card → Cancelar
(no escribe) → repetir y Confirmar (aparece en pipeline + activity). 7. Negativos:
cliente inexistente / "borra este cliente" → no inventa, no escribe. 8. Demo: no
persiste. Pásame counts/consola.

## 12. Veredicto
**H8 COMPLETADO (núcleo):** persistencia real de consultas internas (tablas
dedicadas + RLS + runtime), personalidad mejorada y UX más clara, todo validado y
sin tocar el cerebro/n8n. Rediseño visual profundo = follow-up recomendado.
