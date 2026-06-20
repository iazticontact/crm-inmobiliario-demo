# FASE N2.4 — Interpolación del system prompt del Agent V2 (n8n)

> **Fecha:** 2026-06-20 · Instancia: `https://primer-proyecto-prueba-n8n.hvdnby.easypanel.host`
> · Workflow `[CRM Inmobiliario] Agent V2 — Read Only` (id `6mps8YoWu3syldUc`),
> **INACTIVO**. Corregido por **REST API (PUT)**. No se tocó ningún otro workflow,
> secretos, `.env`, `.mcp.json`, ni el runtime del CRM (`src/`).

---

## 0. Contexto: estado al recuperar la sesión
Sesión nueva. Recuperado el estado por repo/git/docs/n8n REST antes de tocar nada:

- **N2.3 ya estaba COMPLETO y en vivo** (commit `45bde34`, aplicado al workflow el
  2026-06-20 ~11:13). El required-field fix (`crm_read_query` solo `entity`, ninguna
  tool con >1 `$fromAI`) estaba presente en el workflow leído por API.
- La execution `#1237` que motivó N2.3 es de las **10:55 — anterior al fix** de las
  11:13. **No había ninguna ejecución posterior** al fix ⇒ el error reportado ya
  estaba resuelto; solo faltaba volver a testear.
- `active=false`, 23 nodos, 15 tools, cabeceras `x-nowcrm-secret` intactas, credencial
  OpenAI preservada, memory `sessionKey` interpolado. Todo correcto.

Único defecto real pendiente: el `systemMessage` del agente **no se interpolaba**
(flag de §5 del report N2.3). Esta fase (N2.4) lo corrige, con aprobación explícita.

## 1. Problema
El `systemMessage` del nodo **CRM Agent** se guardó como **texto plano** (sin prefijo
`=`). En n8n, un parámetro sin `=` es literal: los `{{ }}` de su interior **no se
evalúan**. Resultado — el modelo recibía estas 2 líneas en bruto:
```
- workspaceId activo: {{ $('Normalize input').item.json.workspaceId }}
- entidad activa del hilo (si la hay): {{ $('Normalize input').item.json.activeEntity }}
```
No es la causa de ningún crash (las reglas de ruteo de tools sí se leen), pero el
modelo **pierde el contexto de `activeEntity`** ("este cliente", "este expediente") y
ve placeholders sin sentido.

## 2. Comprobación de seguridad antes del cambio
Prefijar con `=` convierte TODO el `systemMessage` en una expresión n8n. Riesgo: si el
prompt contuviera `{{`/`}}` mal balanceados o ejemplos con llaves, la expresión
entera fallaría. Auditado por API antes de tocar:
- `{{` = 2, `}}` = 2 (exactamente los 2 bloques `$('Normalize input')`, bien formados).
- Llaves sueltas `{` o `}` fuera de `{{ }}` = **0**.
- Sin ejemplos JSON ni snippets con llaves en el prompt.
⇒ Prefijar con `=` es **seguro**: solo esos 2 bloques se evalúan; el resto queda literal.

## 3. Cambio aplicado (vía REST PUT, workflow inactivo)
- `CRM Agent` → `parameters.options.systemMessage`: se antepuso `=` al contenido.
  **Ni una palabra del prompt cambió**; solo el modo de evaluación (literal → expresión).
- PUT con body mínimo (`name`, `nodes`, `connections`, `settings`). El PUT **no altera
  `active`** (la activación es endpoint aparte) → sigue `active=false`.

## 4. Verificación (read-back por API)
- `active = false` ✅ · 23 nodos · **15 tools** ✅.
- `systemMessage` ahora **empieza con `=`** ✅ (los `{{ }}` se evalúan en runtime; el
  template sigue conteniéndolos literalmente, que es lo correcto).
- `crm_read_query`: **1 `$fromAI`** (`entity`) — intacto de N2.3 ✅.
- Cabecera `x-nowcrm-secret = {{$env.AGENT_TOOL_SECRET}}` intacta (muestra verificada) ✅.
- Credencial OpenAI (`gpt-4o-mini`, temp `0.3`) y Window Memory (`sessionKey`, ventana
  12): sin cambios ✅.
- Backup repo `n8n/workflows/crm-agent-v2-readonly.json` regenerado desde el estado vivo.
- Otros workflows y `[MCP TEST]` (`ZcHDxvyqaAXL0NIa`): no tocados.

## 5. Qué NO se tocó
Workflow sigue `active=false`. No se tocó el texto del prompt, otros workflows,
secretos, `.env.local`, `.mcp.json`, runtime CRM (`src/`), credenciales. Sin Supabase
directo, sin SQL libre, sin `service_role` en n8n. No se ejecutó test E2E (el webhook
`webhook-test/...` solo escucha en modo "Listen for test event", manual).

## 6. Próximos pasos para el usuario
1. **Redeploy del CRM a `6fa7cca`+** (pendiente de N2.1) para que `crm_read_query`
   responda; el resto de tools ya funciona.
2. En n8n: abrir el workflow → **Execute workflow / Listen for test event** (sin
   activar) y lanzar el POST de prueba (header `x-nowcrm-agent-secret`, payload "DNI
   del último cliente"). Esperado: `get_latest_client` → DNI, sin error de schema, y
   con el contexto de workspace/entidad ya resuelto en el prompt.
3. Si todo OK en test, activar el workflow cuando se decida (fase aparte).

## Veredicto
**N2.4 COMPLETADO — SYSTEM PROMPT INTERPOLATION FIX.** El `systemMessage` ahora se
interpola (`workspaceId`/`activeEntity` reales en lugar de placeholders). Cambio
quirúrgico (solo prefijo `=`, prompt sin reescribir), verificado por read-back,
**inactivo**, schemas de N2.3 y credencial OpenAI intactos, demás workflows sin tocar.
Con esto cierran las correcciones del Agent V2 en n8n; quedan tareas de despliegue
(redeploy CRM, test E2E, activación).
