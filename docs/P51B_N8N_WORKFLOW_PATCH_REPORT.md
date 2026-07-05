# P51B — Parche del workflow de n8n

## Estado: ⛔ NO APLICADO (BLOCKED) — falta acceso al n8n vivo

No tengo acceso programático al editor/API de n8n (el conector MCP de n8n requiere una autenticación que no
puedo completar en sesión no-interactiva; no dispongo de credenciales ni API key del n8n). Por tanto **el
workflow NO ha sido editado**. A continuación, los pasos EXACTOS para que el operador lo aplique.

- n8n: `https://primer-proyecto-prueba-n8n.hvdnby.easypanel.host`
- Workflow: `[CRM Inmobiliario] Agent V2 — Read Only` · ID `6mps8YoWu3syldUc`

## Paso 0 — Backup
1. Abrir el workflow activo.
2. Menú ⋮ → **Download** (exporta JSON).
3. Guardar como `CRM_AGENT_V2_READ_ONLY_BACKUP_BEFORE_P51B_<YYYY-MM-DD>.json` fuera del repo (contiene
   posibles credenciales de nodo — NO commitear).

## Paso 1 — Propagar el token a cada llamada a `/api/agent/tool`
La app ya envía el token en el body del webhook como **`turnPolicyToken`** (y `turn`). En **cada nodo HTTP
Request** que llama a `POST {{...}}/api/agent/tool`, añadir una cabecera además del `x-nowcrm-secret`:

| Header | Valor (expresión n8n) |
|---|---|
| `x-nowcrm-turn-policy` | `={{ $json.turnPolicyToken }}` |

Si el token no está en `$json` en ese punto del flujo, referenciar el nodo Webhook de entrada, p. ej.
`={{ $node["Webhook"].json["body"]["turnPolicyToken"] }}` o `={{ $node["Webhook"].json["turnPolicyToken"] }}`
según la estructura real del primer nodo (inspecciónala en una ejecución de prueba).

> El endpoint acepta el token en el header `x-nowcrm-turn-policy` (canónico) **o** en el body
> (`turnPolicyToken` / `turn_policy_token`). Preferir el header.

## Paso 2 — System prompt del agente (por CLASES de turno, sin hardcodear frases)
Añadir al system message del nodo AI Agent:

```
La app te envía `turn` (turnType, domain, shouldReadData, shouldWriteData, allowedTools) y un token.
- Respeta SIEMPRE `turn`. Si shouldReadData=false y shouldWriteData=false, o allowedTools está vacío: responde SIN herramientas.
- No uses herramientas por mencionar una entidad. Solo si el turno permite data_read/write_prepare.
- Usa únicamente tools incluidas en allowedTools. Nunca leas facturas.
- Si el usuario habla de tu respuesta, corrige, se queja, discrepa o pregunta por tu comportamiento/capacidades/funcionamiento/hipótesis: responde SIN tools.
- Si una tool devuelve `tool_not_allowed_for_turn`, no insistas ni pruebes otra: explica que ese turno no requiere consulta.
- Tras una corrección, no repitas la acción anterior automáticamente.
- Español, breve, claro, profesional, sin tecnicismos internos.
```

## Paso 3 — Probar el workflow (n8n)
- Turno de lectura permitido → la tool responde 200.
- Turno no-datos → el agente no llama tools.
- Tool no permitida / facturación → el endpoint responde 403 (el agente no debe insistir).

## Paso 4 — Activar strict mode (EasyPanel env)
Solo DESPUÉS de aplicar los pasos 1–3 y confirmar que las tools reciben el token:
```
AGENT_TOOLS_REQUIRE_POLICY=true
```
Redeploy/restart de la app. Verificar en logs `[agent/tool]` que desaparecen los `WARN unscoped_tool_call`.
Rollback a `false` si rompe (y revisar la propagación del token).

## Tabla de nodos (a rellenar por el operador)
| Node | Tool | Antes (headers) | Después (headers) | Token enviado | Test |
|---|---|---|---|---|---|
| … | … | x-nowcrm-secret | + x-nowcrm-turn-policy | sí | 200/403 |

---

## P51C — Patcher automático (Modo B: export → patch → import)
Para no editar nodos a mano, hay un patcher que transforma el workflow EXPORTADO:

```bash
# 1) En n8n: abre el workflow → Download (exporta JSON).
# 2) Parchéalo (local, sin tocar credenciales ni llamar a ningún sitio):
node scripts/patch-n8n-workflow.mjs <workflow-exportado.json>
#    → escribe <workflow-exportado>.patched.json
# 3) En n8n: Import from File → el .patched.json → Activar.
# 4) Actualiza el system prompt del agente a mano (§2 arriba / AGENT_N8N_CONTRACT §4).
```

Qué hace el patcher (verificado con un workflow sintético):
- Detecta el nodo trigger/webhook y construye la expresión del token:
  `={{ $('<Webhook>').item.json.body?.turnPolicyToken || $('<Webhook>').item.json.turnPolicyToken || $json.turnPolicyToken }}`.
- Añade la cabecera `x-nowcrm-turn-policy` a **cada** nodo HTTP Request cuya URL contenga `/api/agent/tool`
  (`sendHeaders=true` + `headerParameters`). No toca otros nodos ni credenciales.
- Imprime qué nodos tocó (0 → avisa de revisar la URL).
