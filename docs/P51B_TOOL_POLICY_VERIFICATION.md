# P51B — Verificación del enforcement de `/api/agent/tool`

## Script: `scripts/verify-tool-policy.mjs`
Firma Turn Policy Tokens (igual que la app) y ejecuta los casos A–H contra el endpoint desplegado. No
filtra el secreto ni el token completo (solo un prefijo de 8 chars). **Lo ejecuta el operador** con acceso
a `AGENT_TOOL_SECRET` del servidor.

```powershell
$env:AGENT_TOOL_URL="https://crm-inmobiliario-crm-staging.hvdnby.easypanel.host/api/agent/tool"
$env:AGENT_TOOL_SECRET="<AGENT_TOOL_SECRET del servidor>"
$env:WORKSPACE_ID="d0000000-0000-4000-8000-000000000001"
node scripts/verify-tool-policy.mjs
```

## Casos y resultado esperado
| # | Caso | Esperado |
|---|---|---|
| A | Token válido + tool permitida (`get_pending_tasks`, dominio tasks) | `HTTP 200` |
| B | Token válido + cross-domain (`search_properties` con token de tasks) | `403 tool_not_allowed_for_turn` |
| C | Turno no-datos (`read=false`) + read tool | `403 tool_not_allowed_for_turn` |
| D | Token expirado | `403 invalid_turn_policy` |
| E | Token manipulado | `403 invalid_turn_policy` |
| G | Tool de facturación (`get_invoices_summary`) | `403 tool_forbidden_for_assistant` (siempre) |
| F | Sin token | `403 turn_policy_required` si `AGENT_TOOLS_REQUIRE_POLICY=true`; `200` en compat |

## Cobertura por evals (offline, ya verde)
`assistant-turn-policy-strict.evals.ts` prueba la MISMA lógica (`evaluateToolPolicy`) sin red: A–H + compat +
override dev + secreto incorrecto. **25 suites TODO VERDE.** El script sirve para confirmar el mismo
comportamiento **contra el servidor real** (requiere secreto).

## Estado
⛔ **No ejecutado contra staging en esta sesión** (falta `AGENT_TOOL_SECRET`, que es un secreto de servidor
que no debe estar en el chat/repo). El operador lo ejecuta con el secreto real. La lógica está verificada
offline al 100%.
