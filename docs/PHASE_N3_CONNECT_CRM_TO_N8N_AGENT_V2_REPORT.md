# FASE N3 — El CRM usa el n8n Agent V2 como cerebro (V1 retirado del runtime)

> **Fecha:** 2026-06-20 · HEAD previo `0abdf95`. Cambia runtime del CRM (`src/`) →
> **requiere redeploy** del CRM. Workflow n8n `6mps8YoWu3syldUc` **activado**. tsc + lint
> + build verdes. Sin tocar `.env.local`, `.mcp.json`, secretos, schema/RLS, workflows
> antiguos.

---

## 1. Por qué se sustituye el V1
El asistente V1 (`runNowLabsAgent`, OpenAI in-process + fallbacks deterministas +
prompt enorme) se volvió frágil/robótico. Tras N2.5–N2.7 el **Agent V2 de n8n** está
operativo de punta a punta (memoria por hilo, tools CRM read-only, datos reales). Decisión
de producto: el cerebro pasa a ser n8n; el V1 deja de usarse en runtime, **sin fallback
silencioso**.

## 2. Arquitectura nueva
```
/assistant (UI, sin cambios de fondo)
  → POST /api/assistant/v2  (auth Supabase + resolución de workspace, sin cambios)
    → runN8nAssistant(adapter)  → POST webhook n8n  (x-nowcrm-agent-secret)
        → Agent V2: Window Memory (por threadId) + 15 toolCode → /api/agent/tool
      ← { reply, usedTools, activeEntityUpdate, limitations, error }
    ← normaliza → { answer, debugSource:'n8n', toolCalls, preparedAction:null, … }
  → la UI muestra `answer` y persiste en assistant_messages (igual que antes)
```
El `/api/assistant/v2` mantiene **el mismo contrato de request/response** → la UI (4039
líneas) no se reescribe. Selector de provider **server-side**: por defecto n8n.

## 3. Endpoint creado/modificado
- **NUEVO** `src/lib/agents/n8n-assistant-client.ts` — adapter server-only:
  `runN8nAssistant()`. Resuelve URL+secreto de env, POST con timeout 45 s, **normaliza**
  la respuesta (acepta `reply` | `output` | `answer` | string | `{data:…}`), fail-soft
  con códigos (`n8n_not_configured` | `n8n_unauthorized` | `n8n_timeout` |
  `n8n_unreachable` | `n8n_bad_response` | `n8n_error`). Nunca lanza.
- **MODIFICADO** `src/app/api/assistant/v2/route.ts` — selector de provider
  (`ASSISTANT_PROVIDER`, default `n8n`). En modo n8n: construye `activeEntity`
  (cliente enfocado), recupera `recentMessages` (últimos 8 del hilo, RLS por sesión,
  cap 600 chars, puente de arranque en frío), llama al adapter, **mapea al contrato
  existente** (`answer=reply`, `debugSource='n8n'`, `toolCalls=usedTools`,
  `preparedAction=null` — el agente es read-only). Si n8n falla → **error humano claro,
  SIN caer al V1**.

## 4. Payload del CRM a n8n
```json
{ "message": "...", "workspaceId": "<uuid de la sesión>", "userId": "<auth.uid>",
  "threadId": "<assistant_threads.id>", "activeEntity": {"type":"client","id":"…","label":"…"} | null,
  "recentMessages": [{"role":"user|assistant","content":"…"}], "requestId": "<uuid>" }
```
`workspaceId`/`userId` salen de la sesión autenticada (NUNCA del navegador). `threadId`
= conversación actual → la `Window Memory` de n8n (sessionKey `workspaceId:userId:threadId`)
mantiene continuidad. Cabecera `x-nowcrm-agent-secret`.

## 5. Respuesta normalizada
n8n devuelve `{ reply, usedTools, activeEntityUpdate, limitations, error, requestId }`.
El adapter: `reply` (con fallbacks), `usedTools[]`, `activeEntityUpdate` → si es cliente,
alimenta `referencedClientId/Name`. La UI sigue mostrando `answer` y guardando el mensaje.

## 6. Variables necesarias en el CRM (server-side, NO `NEXT_PUBLIC_`)
| Var | Valor | Notas |
|---|---|---|
| `N8N_ASSISTANT_V2_WEBHOOK_URL` | `https://primer-proyecto-prueba-n8n.hvdnby.easypanel.host/webhook/crm-agent-v2` | si falta, cae a `N8N_BASE_URL`+`/webhook/crm-agent-v2` |
| `N8N_ASSISTANT_V2_SECRET` | (= `N8N_ASSISTANT_V2_SECRET` de n8n) | viaja en `x-nowcrm-agent-secret` |
| `ASSISTANT_PROVIDER` | `n8n` (default si no se pone) | `openai`/`v1`/`local` = rollback al V1 |
Documentadas en `.env.example`. **No se tocó `.env.local`.**

## 7. Workflow n8n requerido
`[CRM Inmobiliario] Agent V2 — Read Only` (`6mps8YoWu3syldUc`) **ACTIVADO** (active=true)
en esta fase para exponer el webhook de producción `/webhook/crm-agent-v2`. Env de n8n ya
OK (probado E2E en N2.7): `CRM_BASE_URL`, `AGENT_TOOL_SECRET`, `N8N_ASSISTANT_V2_SECRET`,
acceso a `$env` en nodos. 15 tools `toolCode`. Workflows antiguos intactos.

## 8. Qué parte del V1 queda RETIRADA del runtime
Con `ASSISTANT_PROVIDER` por defecto = n8n, el `/api/assistant/v2` **no ejecuta** el V1:
ni `runNowLabsAgent`, ni `detectDeterministicAction`, ni `resolveDbAction`. `rg` confirma
que `runNowLabsAgent` solo se referencia desde la rama `useLegacyV1` del propio route.
**No hay fallback silencioso**: si n8n falla, el usuario ve "No he podido contactar con el
agente ahora mismo", nunca una respuesta del bot viejo.

## 9. Qué V1 queda como LEGACY (y por qué no se borra)
`nowlabs-main-agent.ts`, `deterministic-fallback.ts`, `deterministic-db-actions.ts`,
`assistant-capabilities.ts` quedan en el repo: siguen referenciados por la rama de
rollback (`ASSISTANT_PROVIDER=openai`) → **no son 0-referencias**, así que por regla no se
eliminan. Sirven de interruptor de emergencia. **Candidatos a cleanup** en una fase
posterior cuando n8n esté consolidado. `/api/assistant/confirm` (executor de escrituras)
se deja intacto: es independiente del cerebro y lo reutilizará la futura fase de escritura.

## 10. Seguridad
- Secreto/URL solo server (`N8N_ASSISTANT_V2_*`), nunca `NEXT_PUBLIC_`, nunca al navegador.
- Adapter valida URL (https, o http localhost en dev), timeout acotado, fail-soft.
- `workspaceId`/`userId` desde sesión; el LLM nunca decide el tenant.
- Sin `service_role` en frontend; sin secretos en código; sin PII real en docs.
- `git diff` revisado: sin `sk-`/`service_role`/`sb_secret`/keys/DNI/emails/teléfonos.

## 11. Pruebas (contra el webhook de producción ya activo)
| # | Caso | Resultado |
|---|---|---|
| 1 | DNI del último cliente | da el DNI real (tool `get_latest_client`) ✅ |
| 2 | "Dame su email y teléfono" (mismo hilo) | resuelve "su"=cliente del turno 1 (memoria) y da email+tel ✅ |
| 9 | Resumen del pipeline | 7 operaciones, valor real, desglose por etapa ✅ |
| 8 | Propiedades en Bilbao | "No consta…" — honesto, sin inventar ✅ |
| 11 | "Perfecto, dame un segundo" | "Perfecto, te espero." ✅ |
| 13 | "Funcionas mal" | reconoce, no se defiende ✅ |
| 15 | "Hazme una factura" | "No hay módulo activo… puedo darte los datos fiscales" ✅ |
| 14 | "Lee el PDF" | metadata sí, contenido no (honesto) ✅ |
Sin errores de schema, sin 503/401, sin datos cruzados, sin texto del V1. El prompt del
agente ya embebía el "JUICIO CONVERSACIONAL" y los límites de módulo → **no se tocó**
(revisado; alargar sería contraproducente). El test CRM→n8n end-to-end completo queda
pendiente del redeploy (la staging actual corre el código viejo).

## 12. Validaciones
`npx tsc --noEmit` ✅ · `npm run lint --max-warnings=0` ✅ · `npm run build` ✅ (46 rutas).

## 13. Frontend
- 1 línea: `/api/assistant/v2` ahora recibe `threadId: conversationId` (memoria por hilo).
- Quick-prompts de copilot: se cambiaron los 3 chips de **escritura** (Crear cita/operación/
  Abrir expediente) por chips de **lectura** (Citas de la semana / Buscar propiedad /
  Expedientes abiertos) — el cerebro n8n es read-only; nada de prometer acciones no
  disponibles. (El modo *inbox* es una vía aparte, pendiente de Meta; no se tocó.)
- En modo real (copilot) el flujo ya iba 100% a `/api/assistant/v2`; las ramas canned del
  V1 estaban gateadas por `!isRealMode` (solo demo) → no aparecen en staging.

## 14. Riesgos
- gpt-4o-mini llama a las tools de forma algo no determinista (a veces "voy a buscar"
  sin emitir la tool-call). Mitigable afinando descripciones/temperatura o subiendo modelo.
- El agente es **read-only**: no prepara escrituras (cita/factura/operación) por chat. Es
  la decisión de producto de esta fase; las escrituras llegarán en una fase aparte
  (preparar+confirmar vía `/api/assistant/confirm`, no escritura directa desde n8n).
- `usedTools`/`activeEntityUpdate` van vacíos/null desde el workflow (hardcoded en
  "Respond to Webhook"); el adapter lo tolera. Mejora futura: poblarlos en el workflow.
- Workflow **activo**: el webhook de producción está expuesto (gated por secreto). Si se
  rota `N8N_ASSISTANT_V2_SECRET`, actualizar en n8n y en el CRM a la vez.

## 15. Próximos pasos para el usuario
1. En EasyPanel **CRM**: añadir `N8N_ASSISTANT_V2_WEBHOOK_URL`, `N8N_ASSISTANT_V2_SECRET`
   (= el de n8n) y opcionalmente `ASSISTANT_PROVIDER=n8n`. **Redeploy del CRM**.
2. Abrir `/assistant` (modo copiloto) y probar los 15 casos de aceptación.
3. (Opcional) afinar tool-calling / poblar `usedTools` en el workflow.

## Veredicto
**N3 COMPLETADO — CRM USA N8N AGENT V2.** El cerebro del asistente es n8n por defecto;
el V1 queda **retirado del runtime** (solo accesible por flag de rollback, sin fallback
silencioso). Adapter + route con contrato intacto, UI casi sin cambios, prompt del agente
ya alineado. Workflow **activado**, 8/15 evals representativos probados en vivo (incluida
memoria de hilo y límites de módulo). tsc/lint/build verdes. **Requiere redeploy del CRM**
con las 2-3 env nuevas para el test end-to-end desde `/assistant`.
