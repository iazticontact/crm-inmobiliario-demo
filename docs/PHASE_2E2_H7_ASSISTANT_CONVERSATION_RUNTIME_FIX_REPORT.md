# Phase 2E-2 H7 — Assistant: decouple internal consultations from public.conversations

> **Fecha:** 2026-06-15 · **Base:** `2fb9625` · Bugfix runtime del asistente
> (solo `assistant/page.tsx`). **No se tocó n8n, Inbox, WhatsApp, schema,
> migraciones, ni el cerebro (`/api/assistant/v2`, `/api/assistant/confirm`).**

## 1. Error inicial
En `/assistant`, al pulsar **"Nueva consulta"** (y al enviar mensaje):
> "No se pudo crear la conversación. Could not find the table
> 'public.conversations' in the schema cache - code=PGRST205".

## 2. Causa exacta
La página del asistente persistía la conversación y los mensajes en
`public.conversations` / `public.messages`, **pero esas tablas no existen** (van
con Inbox/WhatsApp, fase diferida). En modo real:
- `createDemoConversation` → `createAssistantConversation(...)` → INSERT en
  `conversations` → **PGRST205** → toast de error (bloquea antes de poder
  consultar al asistente).
- `sendMessage` / `appendAssistantMessage` → `createMessage(...)` → INSERT en
  `messages` → mismo problema; además un guard bloquea `conversation_id` no-UUID.

## 3. Qué tabla faltaba
`public.conversations` (y `public.messages`). **Deferidas** junto con Inbox/
WhatsApp (no se crean en H7; ver decisión WhatsApp/arquitectura).

## 4. Por qué NO se usa `public.conversations`
Es la tabla de **conversaciones de cliente (Inbox/WhatsApp)**, una fase futura.
El **copiloto interno del CRM** no debe depender de ella. El historial del
asistente, si algún día se persiste, será una tabla **propia y distinta**
(`assistant_threads` / `assistant_messages`), no las conversations de WhatsApp.

## 5. Fix aplicado (mínimo, flag-based, sin tocar el cerebro)
Nuevo flag en `assistant/page.tsx`:
```ts
const ASSISTANT_CONVERSATION_PERSISTENCE: boolean = false
```
Mientras es `false`, el asistente corre como **sesión LOCAL en memoria** (reusa la
maquinaria offline ya existente, que usa ids UUID, así que los guards aguas abajo
pasan). Puntos gateados:
- `ensureRealConversation`: con persistencia off → crea conversación local
  (offline) en vez de `createAssistantConversation` (no INSERT en conversations).
- `appendAssistantMessage` y `sendMessage`: con persistencia off → **no** llaman a
  `createMessage`/`updateConversationScoped` (no INSERT en messages); siguen
  haciendo `appendLocalMessage` (UI) y llamando a `/api/assistant/v2`.
- `createDemoConversation`: con persistencia off → rama local (no INSERT).

**Lo que NO cambia:** el cerebro (`/api/assistant/v2` prepare + `/api/assistant/
confirm`) no usa conversation_id obligatorio; las **acciones confirmadas siguen
persistiendo de verdad** (operaciones/tareas/expedientes/eventos + `activities`)
vía RLS. Prepared actions y confirm cards intactas.

## 6. Cómo queda el asistente ahora
- "Nueva consulta" → crea una consulta **local** (sin error de tabla).
- El usuario pregunta → `/api/assistant/v2` responde con **datos reales** del CRM.
- Aparecen **prepared actions** → **Confirmar** llama a `/api/assistant/confirm`
  → escribe la entidad real + activity. **Cancelar** no escribe.
- El historial del chat es **local de la sesión** (no persiste todavía); sin mocks
  en modo real, sin inventar datos.

## 7. Qué queda futuro (no en H7)
- `assistant_threads` / `assistant_messages` (persistencia propia del asistente),
  **separadas** de las conversations de WhatsApp → poner el flag a `true`.
- Inbox / WhatsApp / `conversations` / `messages` (fase Meta + n8n).

## 8. Qué NO se tocó
`.env.local`, schema/migraciones, n8n, WhatsApp/Meta, Google, Storage,
`/api/assistant/*`, RLS, service_role frontend. Sin features nuevas. El modo
Inbox del asistente ya estaba oculto al cliente (H4); solo se usa el Copiloto.

## 9. Validaciones
`tsc --noEmit` ✅ · `eslint --max-warnings=0` ✅ · `next build` ✅ (46 rutas).

## 10. Smoke
Pendiente en navegador (Oier). Checklist en §11.

## 11. Próximo paso (Oier, navegador)
1. Hard refresh. 2. Login real → `/assistant`. 3. "Nueva consulta" → **sin error
PGRST205**. 4. "Resumen del CRM" → responde con datos reales. 5. "Qué operaciones
abiertas tengo". 6. "Crea una operación para Lucía Herrera" → **confirm card** →
Cancelar (no escribe) → repetir y Confirmar (aparece en pipeline + activity).
7. Negative: "Crea una operación para ClienteQueNoExiste" / "Borra este cliente"
→ no inventa, no escribe, sin error de tabla. 8. Demo: asistente no persiste.
Pásame counts/consola para certificar.
