# FASE P13 — Pulido UI/UX del Asistente IA + protección de coste/abuso

> **Fecha:** 2026-06-26 · Dos entregas en una fase: **(A)** limpieza visual del módulo `/assistant`
> (conversaciones renombrables, timestamps humanos, fuera metadata técnica) y **(B)** **protección de
> coste obligatoria** — un megaprompt o un mensaje gigante ya **no gasta tokens** (se bloquea antes de
> llamar a n8n/OpenAI). Sin tocar prompt del agente, n8n vivo, credenciales, webhook, tools, memory,
> RLS/Auth/Storage.

---

## PARTE A — Pulido UI/UX

### 1. Problema
La lista de conversaciones mostraba **timestamps ISO crudos** (`2026-06-26T12:33:15.092042+00:00`),
**pills repetidas** (`web`, `Neutral`, `Asistente IA`) y un **preview duplicado** del propio título.
El cabecero tenía un badge de canal `web` y botones de teléfono/email que no encajan con un asistente
de CRM. Todo eso "quedaba fatal" y restaba sensación de producto vendible.

### 2. Timestamps humanos
Dos helpers puros en `assistant/page.tsx` (sin dependencias, nunca devuelven ISO ni `+00:00`):
- `humanTimeShort(iso)` → hora corta `14:33` (mensajes). Si el valor ya viene corto (mensajes locales),
  lo deja igual.
- `humanRelativeDate(iso)` → lista: hoy `14:33`, ayer `Ayer`, esta semana `Mié`, más antiguo `25 jun`.

Aplicados a la hora de cada burbuja (`{humanTimeShort(msg.timestamp)}`) y a la lista
(`{humanRelativeDate(conv.timestamp)}`). Fuente del dato sin cambios (sigue siendo `last_message_at` /
`created_at`): **solo se formatea en render**, no se toca la BD.

### 3. Metadata técnica oculta
- **Lista:** eliminadas las 3 pills (`channel`/`sentiment`/`assistantMode`) en modo Asistente IA. El
  preview ya no duplica el título: si hay un último mensaje distinto se muestra; si no, subtítulo
  discreto `Consulta del CRM`. (En modo Inbox se conservan canal/sentimiento, que ahí sí aportan.)
- **Cabecero:** fuera el badge `web` y el `· intent`; en Asistente IA un subtítulo honesto
  `Asistente IA · datos reales del CRM`. Botones de teléfono/email **ocultos** en Asistente IA (se
  conservan en Inbox, donde teléfono/email tienen sentido). Se mantienen **Resolver** y **Eliminar**.
- **Panel derecho:** la identidad ya no muestra `web · intent` en Asistente IA (mismo subtítulo
  honesto). Las tarjetas técnicas (lead score, sentimiento, estado técnico, último documento) ya
  estaban **gateadas** tras `NEXT_PUBLIC_NOWLABS_INTERNAL` → invisibles en producción.

### 4. Renombrar conversaciones (humano y editable)
- **Cabecero:** lápiz → editor inline (ya existía); **Enter** guarda, **Escape** cancela, `maxLength=60`,
  trim, fallback no vacío. Sincroniza lista + cabecero y persiste con `updateConversationTitle`
  (→ `renameAssistantThread`, RLS por workspace, optimista con rollback best-effort).
- **Lista:** **doble clic** sobre una conversación la selecciona y abre ese mismo editor
  (`startEditingTitleFor`), con `title="Doble clic para renombrar"`. Sin segundo estado de edición
  duplicado.

### 5. Auto-títulos limpios y deterministas
`generateAutoTitle` reforzado: detecta **saludos/relleno** (`hola`, `buenas`, `test`, `gracias`…) →
`Nueva consulta`; nuevo `cleanTitleFromText` elimina saltos de línea y bloques de código y **acota la
longitud cortando por palabra** (≤45 chars + `…`). Se mantienen los títulos por intención
("Próximas citas", "Facturas pendientes", "Informe de {cliente}", …). Nunca produce ISO ni metadata.

---

## PARTE B — Protección de coste / abuso (OBLIGATORIO)

### 6. Por qué
Un megaprompt pegado por error en el Asistente **gastó tokens** innecesariamente. La protección debe
ser de **producto/backend**, no solo de prompt: si la entrada es abusiva, **no se llama a n8n/OpenAI**.

### 7. Módulo central `src/lib/assistant-guard.ts`
Puro y sin dependencias, **reutilizado en frontend (aviso/bloqueo) y backend (validación dura)**:
- `ASSISTANT_LIMITS`: límites configurables por env con defaults seguros.
- `checkAssistantInput(text, { hard })`: longitud (normal vs absoluto backend) + detección de
  megaprompt.
- `looksLikeMegaprompt(text)`: patrones ("Eres un…", "Actúa como…", "System prompt", "Ignora
  instrucciones", "Prompt maestro", "Fase P…", "No toques…", "Claude Code"…), cabeceras de plan
  (Objetivo/Entrega/Validaciones), recuento de bullets/cabeceras, y código/JSON. Umbral conservador
  (`MIN_LEN_TO_INSPECT=320`) para **no** bloquear consultas normales.
- `truncateHistory(messages)`: recorta el historial enviado al agente (pocos mensajes, chars/mensaje,
  descarta gigantes) → control de payload/tokens.
- `checkRateLimit(key)`: ventana deslizante en memoria por `usuario:workspace` (best-effort).

### 8. Frontend (`assistant/page.tsx`)
- `sendMessage`: **pre-chequeo** con `checkAssistantInput` antes de tocar la red; si bloquea, `toast`
  humano y **no** se envía.
- Composer: contador de caracteres al acercarse al límite, **botón de enviar deshabilitado** si se
  supera, borde de aviso, y placeholder que aclara el alcance ("Pregunta por clientes, inmuebles,
  citas o comisiones…").

### 9. Backend (`/api/assistant/v2/route.ts`)
Antes de cualquier llamada a n8n/OpenAI:
- `checkRateLimit` → si excede, responde mensaje humano y **corta** (sin tokens).
- `checkAssistantInput(message, { hard: true })` → si bloquea (`too_long`/`megaprompt`), responde el
  mensaje humano correspondiente y **corta** (sin tokens).
- El historial (`recentMessages`) pasa por `truncateHistory` antes de enviarse al agente.
- Logs sin secretos ni contenido completo (solo `reason`, `user`, `ws`, `len`).

### 10. Mensajes humanos (sin tecnicismos)
- Demasiado largo: *"El mensaje es demasiado largo para el asistente del CRM. Resume la petición o
  divídela en partes más pequeñas."*
- Megaprompt: *"Esto parece una instrucción técnica o un prompt largo. El Asistente IA está limitado a
  consultas y acciones del CRM. Para trabajo técnico usa Claude Code o tu entorno de desarrollo."*
- Rate limit: *"Has alcanzado temporalmente el límite de uso del asistente. Espera un momento y vuelve
  a intentarlo."*

### 11. Variables de entorno (`.env.example`)
`NEXT_PUBLIC_ASSISTANT_MAX_INPUT_CHARS` (2000), `NEXT_PUBLIC_ASSISTANT_WARN_AT_CHARS` (1700),
`ASSISTANT_MAX_INPUT_CHARS` (2500, backend), `ASSISTANT_MAX_HISTORY_MESSAGES` (8),
`ASSISTANT_MAX_HISTORY_CHARS_PER_MESSAGE` (600), `ASSISTANT_RATE_LIMIT_PER_MINUTE` (10). Todas
opcionales con default seguro.

### 12. ¿System Message en n8n?
La protección principal es **frontend/backend** (no gasta tokens porque corta antes de llamar). No se
añade microparche al prompt vivo: el master está congelado y gestionado por re-pegado, y un límite en
el prompt **no evita** el gasto de tokens. Documentado como decisión consciente.

---

## 13. Evals añadidos
`src/lib/agents/__evals__/assistant-guard.evals.ts`: casos de `checkAssistantInput` (consulta normal
pasa, consulta media pasa, gigante → too_long, "Eres un…"/plan de fase/código → megaprompt), casos de
`truncateHistory` (recorte por nº de mensajes, por chars/mensaje, descarte de gigantes) y un sanity de
no-falso-positivo. Incluye `runAssistantGuardEvals()` para enchufar un runner futuro. **Verificado**
con un script desechable: **todos los casos PASS** (incluido el no-falso-positivo en consultas
naturales largas).

## 14. Validaciones
`npx tsc --noEmit` ✅ · `npm run lint -- --max-warnings=0` ✅ · `npm run build` ✅.
Scans en `/assistant`: 0 renders de `timestamp` crudo · 0 `+00:00`/ISO visible · 0 "Copiloto" visible ·
pills `web`/`Neutral`/`Asistente IA` retiradas del Asistente IA · tarjetas técnicas gateadas.

## 15. Archivos tocados
| Archivo | Cambio |
|---|---|
| `src/lib/assistant-guard.ts` | (P13) módulo de protección de coste/abuso (compartido front/back) |
| `src/app/api/assistant/v2/route.ts` | rate limit + `checkAssistantInput(hard)` + `truncateHistory` antes de n8n/OpenAI |
| `src/app/(saas)/assistant/page.tsx` | helpers de hora humana, lista/cabecero/panel limpios, doble-clic renombrar, auto-título limpio, guard + contador en composer |
| `.env.example` | variables del guard documentadas |
| `src/lib/agents/__evals__/assistant-guard.evals.ts` | evals del guard + runner opcional |

## 16. Pendientes honestos
- **Preview real de último mensaje** en la lista: requeriría una consulta extra por hilo (N+1) o un
  join; por ahora se muestra subtítulo discreto en lugar de un preview potencialmente falso. Mejora
  futura: cargar el último mensaje por hilo en `listAssistantThreads`.
- **Rate limit en memoria:** best-effort; en serverless el estado no persiste entre instancias frías.
  Primera barrera barata, no cuota estricta. Si se requiere cuota dura, mover a Supabase/Redis.

## Veredicto
**P13 COMPLETADO.** El módulo Asistente IA se ve **limpio y vendible** (timestamps humanos, sin pills ni
códigos, conversaciones renombrables) y, sobre todo, **deja de ser un agujero de coste**: megaprompts y
mensajes gigantes se bloquean **antes** de llamar a n8n/OpenAI, con mensajes humanos y sin gastar
tokens. `tsc`/`lint`/`build` en verde; lógica del guard verificada caso a caso. Sin tocar prompt del
agente, n8n vivo, credenciales, webhook, tools, memory ni RLS/Auth/Storage.
