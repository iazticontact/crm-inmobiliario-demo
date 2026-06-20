# FASE N2.6 — Hard fix del schema del Agent V2: `toolHttpRequest` roto → `toolCode` (PROBADO en vivo)

> **Fecha:** 2026-06-20 · Instancia: `https://primer-proyecto-prueba-n8n.hvdnby.easypanel.host`
> · Workflow `[CRM Inmobiliario] Agent V2 — Read Only` (id `6mps8YoWu3syldUc`).
> Diagnóstico y fix **iterando en vivo con el workflow activado temporalmente** (con
> permiso explícito del usuario), **dejado `active=false`** al terminar. Corregido por
> REST API. No se tocó ningún otro workflow, secretos, `.env`, `.mcp.json`. **No se tocó
> el runtime del CRM** (el bug estaba en n8n).

---

## 1. Por qué N2.3/N2.4/N2.5 no funcionaron (demostrado, no asumido)
Ejecuciones **nuevas** verificadas por API (`#1238`, `#1239`, y baseline propio `#1240`):
mismo error `Received tool input did not match expected schema / ✖ Required → at `
(**path vacío** = raíz). Hallazgo decisivo:

| Exec | Estado | promptTokens |
|---|---|---|
| #1238 | N2.4 | **1613** |
| #1239 | N2.5 (+`reason` en 8 tools) | **1613** |

Añadir 8 campos `$fromAI` **no cambió ni un byte** del request a OpenAI ⇒ **en esta
versión de n8n, `toolHttpRequest` NO construye el schema de parámetros del LLM a partir
del `$fromAI` del `jsonBody`.** Todos los parches N2.2–N2.5 eran **invisibles para el
modelo**. (Bug conocido de n8n: issues
[#17241](https://github.com/n8n-io/n8n/issues/17241),
[#14399](https://github.com/n8n-io/n8n/issues/14399),
[#13440](https://github.com/n8n-io/n8n/issues/13440).)

## 2. Diagnóstico en vivo (activé el workflow y probé por el webhook de producción)
El usuario autorizó activar temporalmente para poder ejecutar y leer cada ejecución por
API. Secuencia de pruebas (todas por `POST {base}/webhook/crm-agent-v2`):

| # | Cambio probado | Resultado | Conclusión |
|---|---|---|---|
| 1 | Solo `get_latest_client`, body **estático** (0 `$fromAI`) | `Required` raíz, tool NO ejecuta | **Una `toolHttpRequest` sin parámetros TAMBIÉN falla** → no es el nº de campos |
| 2 | `get_latest_client` body **"Using Fields Below"** (keypair + `$fromAI`) | `Required` raíz, promptTokens igual | Ningún modo de body de `toolHttpRequest` registra el schema aquí |
| 3 | Mensaje que **no** necesita tool ("preséntate") | **success**, respuesta correcta | **El agente, OpenAI, memoria y Respond funcionan**; solo rompe la llamada a tool |
| 4 | `get_latest_client` → nodo **`toolCode`** (Code Tool) con schema permisivo | **success, SIN error de schema**, la tool **ejecuta** y llega al CRM | **`toolCode` arregla el schema** |

⇒ Causa raíz real: **el nodo `toolHttpRequest` está roto para el AI Agent en esta
versión de n8n** (no expone schema al modelo y su validación interna rechaza la llamada
con `Required` en raíz). No era `crm_read_query`, ni los campos `$fromAI`, ni el prompt.

## 3. Fix aplicado — las 15 tools migradas a `@n8n/n8n-nodes-langchain.toolCode`
Cada tool es ahora un **Code Tool** con:
- **`inputSchema` permisivo** `{ "type":"object", "properties":{…}, "additionalProperties":true }`
  → **acepta llamadas vacías** (es la corrección que la comunidad confirma para el
  *"Required"*: el schema no debe exigir campos que el modelo pueda omitir). Las tools de
  un campo lo declaran como **opcional** (no en `required`).
- **`jsCode`** que hace la llamada **read-only** a `/api/agent/tool` con
  `this.helpers.httpRequest`:
  - `workspace_id` **fijado** desde `$('Normalize input').first().json.workspaceId` (NUNCA del LLM).
  - cabecera `x-nowcrm-secret: $env.AGENT_TOOL_SECRET` (server-to-server, igual que antes).
  - `url = $env.CRM_BASE_URL + '/api/agent/tool'`.
  - el campo que aporta el modelo (p. ej. `query`, `clientId`, `entity`) se lee del
    input (`query.<campo>`) y se pasa **solo si no está vacío**.
  - **try/catch**: si el CRM no responde, devuelve `{ok:false,error:'crm_unreachable'}`
    en vez de **crashear el agente** (degradación elegante).

**No se cambió el contrato del CRM** (`{tool, workspace_id, input}`) → **sin redeploy de
runtime**. La arquitectura de seguridad es idéntica (workspace fijado, secreto por env,
read-only, sin SQL libre, sin service_role en n8n).

## 4. Verificación end-to-end (vivo, con las 15 tools conectadas) — PROBADO
- **TEST DNI** (`exec #1253`): `status success`, **SCHEMA ERROR: NO**, el modelo invoca
  `get_latest_client`, la tool **ejecuta** (sin error de nodo) y responde con
  honestidad (porque el CRM devuelve 503 — ver §5). **Ya no hay error de schema.**
- **TEST saludo** (`exec #1254`): `success`, responde sin llamar tools.
- Read-back final: `active=false` ✅ · 23 nodos · **15 `toolCode`, 0 `toolHttpRequest`** ✅
  · **15 conexiones `ai_tool`** ✅ · `systemMessage` interpolado (empieza con `=`) ✅ ·
  credencial **OpenAI preservada** (`OpenAi account`, `gpt-4o-mini`) ✅ · las 15 envían
  `x-nowcrm-secret` por `$env` y usan `Normalize input` para `workspace_id` ✅.
- Workflows antiguos y `[MCP TEST]` (`ZcHDxvyqaAXL0NIa`): **no tocados**.

## 5. Bloqueante restante (NO es de schema, es del CRM): HTTP 503
Con el schema ya resuelto, la tool **sí llama** al CRM y este devuelve **503**. Según
`src/app/api/agent/tool/route.ts`, el 503 (`endpoint_disabled`) ocurre cuando en el CRM
**desplegado** falta alguna de: `AGENT_TOOL_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`,
`NEXT_PUBLIC_SUPABASE_URL`. Es **lado CRM** (despliegue/env), no del workflow.
**Acción del usuario:**
1. **Redeploy del CRM a `6fa7cca`+** en EasyPanel.
2. Asegurar en el CRM desplegado las env: `AGENT_TOOL_SECRET` (mismo valor que en n8n),
   `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_URL`.
3. Confirmar que `CRM_BASE_URL` (en n8n) apunta a ese deploy.
Cuando el endpoint deje de dar 503, las tools devolverán datos reales (la tool ya está
probada llegando al CRM).

## 6. Observación de calidad (para fase posterior, no es bug de schema)
`gpt-4o-mini` (temp 0.3) llama a las tools de forma **no determinista** (a veces dice
"voy a buscar…" sin emitir la tool-call). Se observó que **los schemas permisivos
(sin propiedades) se llaman con más fiabilidad** que los que declaran propiedades. Esto
se afinará mejor **cuando el CRM devuelva datos reales** (el modelo ahora ve errores 503,
lo que desincentiva el uso de tools) y, si hace falta, ajustando prompt/descrip­ciones o
subiendo de modelo. **No bloquea N2.6** (el objetivo era el schema).

## 7. Qué NO se tocó
Otros workflows, secretos, `.env.local`, `.mcp.json`, runtime del CRM (`src/`),
credencial OpenAI: intactos. Sin Supabase directo, sin SQL libre, sin `service_role` en
n8n. El workflow se **dejó `active=false`** (se activó solo durante el diagnóstico, con
permiso, y se desactivó al terminar).

## 8. Próximo test exacto para el usuario (tras redeploy del CRM)
En n8n: *Execute workflow / Listen for test event* (o activar) y POST
(`x-nowcrm-agent-secret`), payload "DNI del último cliente". Esperado: `get_latest_client`
ejecuta y devuelve el cliente + DNI (de `metadata`). Sin error de schema (ya garantizado).

## Veredicto
**N2.6 COMPLETADO — HARD SCHEMA FIX (PROBADO EN VIVO).** Identificada y demostrada la
causa real (el nodo `toolHttpRequest` no registra el schema del modelo en esta versión de
n8n; bug conocido). Las 15 tools migradas a `toolCode` con schema permisivo + llamada
HTTP en código (mismo contrato y seguridad). Verificado por ejecución real: **ya no hay
error de schema** con las 15 tools conectadas; el agente invoca tools, ejecuta y degrada
con elegancia. Workflow `active=false`, credencial OpenAI y demás workflows intactos.
**Único pendiente para datos reales: arreglar el 503 del CRM (redeploy + env), lado CRM.**
