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
