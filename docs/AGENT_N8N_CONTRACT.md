# Contrato App ↔ n8n (Asistente) — P50

> Cómo debe comportarse el workflow de n8n para respetar la **decisión de turno** de la app. El objetivo:
> ninguna entidad del CRM provoca una lectura por sí sola; n8n no puede leer datos cuando el turno no lo
> autoriza.

## 1. Quién decide
La **app** (`/api/assistant/v2`) es la autoridad. En cada turno construye una `AssistantTurnDecision`
(`src/lib/agents/assistant-turn.ts`) ANTES de tocar datos:

- Turnos **no-datos** (social, ayuda, capacidad, cómo-funciona, hipotético, `assistant_meta`,
  `user_correction`, `user_complaint`, `disagreement`, ambiguo): la app responde **localmente** y **NO llama
  a n8n**. → n8n ni se entera → no puede leer. (Enforcement primario, 100% bajo control de la app.)
- Turnos de **datos** (data_read / data_followup): la app intenta primero el motor **local-first**; si no
  cubre el caso, deriva a n8n para razonamiento.

## 2. Permisos por turno
`src/lib/agents/assistant-tool-permissions.ts` es la fuente de verdad:

- `shouldReadData=false` ⇒ `allowedTools=[]`.
- Facturación ⇒ `allowedTools=[]` (aislada). `get_invoices_summary` / `invoicing.*` están en
  `FORBIDDEN_ASSISTANT_TOOLS`.
- `data_read` de un dominio ⇒ `["<dominio>.read", "<dominio>.search"]`.
- Escritura ⇒ solo `"<dominio>.write_prepare"` (nunca ejecuta sin confirmación).

## 3. Qué debe enviar la app a n8n (cuando delega)
```jsonc
{
  "message": "…",
  "workspaceId": "…",
  "turn": {                       // decisión de la app
    "turnType": "data_read",
    "domain": "clients",
    "shouldReadData": true,
    "allowedTools": ["clients.read", "clients.search"]
  },
  "context": { "lastResults": [ … ] }
}
```

## 4. Reglas del system prompt de n8n (general, sin hardcodear frases)
Antes de usar herramientas, el agente debe:
1. Clasificar el turno (acto comunicativo), no la entidad.
2. Si el usuario habla de tu respuesta o corrige tu comportamiento → **no** uses herramientas.
3. Si pregunta capacidades o funcionamiento → **no** uses herramientas.
4. Si es hipotético/futuro → **no** uses herramientas.
5. Si pide datos reales → usa solo las `allowedTools`.
6. Si es ambiguo → pregunta aclaración.
7. Si una herramienta no está autorizada → **no** intentes bordearla.
8. No repitas datos que el usuario no pidió.
9. Mencionar una entidad **no** es pedir esa entidad.
10. No digas “no puedo acceder” sin haber intentado una lectura autorizada.

## 5. Enforcement en el backend (defensa en profundidad)
`/api/agent/tool` acepta un campo opcional `turn`. Si `turn.shouldReadData === false`, el endpoint
**rechaza** cualquier lectura con `tool_not_allowed_for_turn` (403) — aunque n8n lo intente. Es opt-in
(no rompe a callers que no envían `turn`); cuando el workflow de n8n reenvíe `turn`, la lectura no
autorizada queda bloqueada en servidor, no solo por prompt.

> Estado actual: la app ya garantiza que los turnos no-datos **no llaman a n8n** (enforcement primario). El
> reenvío de `turn` desde el workflow de n8n al endpoint de tools es el paso pendiente para el enforcement
> de defensa en profundidad; el endpoint ya lo soporta.

---

## 6. Turn Policy Token (P51) — enforcement real

La app firma un **token** (HMAC-SHA256 con `AGENT_TOOL_SECRET`, server-only) y lo envía a n8n en el body
(`turnPolicyToken`). El token lleva la política del turno (dominio, `read`, `write`, `allowedTools`, `exp`
~90 s). **No contiene secretos ni PII.**

### Qué recibe n8n (body del webhook `crm-agent-v2`)
```jsonc
{
  "message": "…",
  "workspaceId": "…",
  "recentMessages": [ … ],
  "turn": { "turnType": "data_read", "domain": "clients", "shouldReadData": true, "allowedTools": ["clients.read","clients.search"] },
  "turnPolicyToken": "eyJ…​.aBc…"      // firmado por la app; opaco para n8n
}
```

### Qué DEBE hacer el workflow de n8n (pasos exactos — REQUIERE ACCESO A n8n)
1. **Backup**: exporta el workflow activo antes de tocar.
2. En el **AI Agent / system prompt**, aplica las reglas de §4 y añade: «Respeta `turn`: si
   `shouldReadData=false` o `allowedTools=[]`, responde SIN herramientas».
3. En **cada nodo HTTP Request** que llama a `POST {{CRM_BASE_URL}}/api/agent/tool`, añade la cabecera:
   `x-nowcrm-turn-policy: {{ $json.turnPolicyToken }}` (además del `x-nowcrm-secret` ya existente).
4. Asegura que si `allowedTools=[]` el agente no invoca ninguna tool.
5. Guarda y **activa** el workflow. Prueba (§5 de este doc / playbook).

### Qué impone `/api/agent/tool` con el token
- Verifica firma y expiración → inválido/caducado ⇒ `403 invalid_turn_policy`.
- `read=false` ⇒ `403 tool_not_allowed_for_turn`.
- Tool fuera de `allowedTools` (dominio) ⇒ `403 tool_not_allowed_for_turn`.
- `get_invoices_summary` / facturación ⇒ `403 tool_forbidden_for_assistant` (SIEMPRE, con o sin token).

### Envs
| Env | Default | Efecto |
|---|---|---|
| `AGENT_TOOLS_REQUIRE_POLICY` | `false` (compat) | `true`: sin token ⇒ `403 turn_policy_required`. **Poner `true` en staging/prod DESPUÉS de editar n8n.** |
| `ALLOW_UNSCOPED_AGENT_TOOLS_DEV` | `false` | Solo dev: permite tools sin token aunque `REQUIRE_POLICY=true`. Nunca en prod. |
| `ALLOW_LEGACY_ASSISTANT` | `false` | `true`: permite el cerebro legacy V1 (`ASSISTANT_PROVIDER`). Déjalo sin poner en staging/prod. |

### Transición segura
1. Desplegar este código (endpoint ya soporta el token; app ya lo firma).
2. Editar el workflow de n8n para reenviar `x-nowcrm-turn-policy` (pasos arriba).
3. Verificar en logs `[agent/tool]` que dejan de aparecer `WARN unscoped_tool_call`.
4. Poner `AGENT_TOOLS_REQUIRE_POLICY=true` en staging/prod → enforcement estricto.
