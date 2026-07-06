# P51C — N8N VIVO PARCHEADO + ENFORCEMENT VERIFICADO EN STAGING REAL

## Veredicto: ✅ n8n vivo CERRADO y VERIFICADO end-to-end · ⏸ strict mode y QA de chat PENDIENTES

El bloqueo principal de P51/P51B (editar n8n vivo y verificar el enforcement contra el servidor real) queda
**resuelto con evidencia**. Quedan dos pasos **no bloqueados por mí**: activar strict en EasyPanel (el usuario
pidió expresamente NO activarlo aún) y la QA adversarial escribiendo en el chat de la UI (requiere sesión
interactiva autenticada).

---

## 1. Modo de acceso usado
**Modo A — API directa de n8n.** El usuario tenía `N8N_API_KEY` / `N8N_API_URL` / `N8N_BASE_URL` y
`AGENT_TOOL_SECRET` en `.env.local` (gitignored + no trackeado, confirmado). Los scripts leen esos valores
en runtime; **ningún secreto se imprimió, logueó ni commiteó**.

## 2. n8n — backup + estructura real
- Workflow: `[CRM Inmobiliario] Agent V2 — Read Only` · id `6mps8YoWu3syldUc` · 24 nodos · active.
- Backup: `scripts/n8n-inspect.mjs` guardó el JSON en el temp del SO **antes** de tocar.
- **Descubrimiento clave** (corrige el supuesto de P51/P51B): las tools NO son nodos HTTP Request, son **15
  nodos `@n8n/n8n-nodes-langchain.toolCode`** (Code Tool) que llaman a `/api/agent/tool` con
  `this.helpers.httpRequest`. El secreto viaja por `$env.AGENT_TOOL_SECRET` (no hardcodeado). El system
  prompt vive en el nodo `CRM Agent`.

## 3. Parche aplicado (vía API, dry-run → --apply)
`scripts/n8n-patch-live.mjs` (idempotente):
1. **`Normalize input`**: +`turnPolicyToken = {{ $json.body.turnPolicyToken }}` (el token que ya envía la app).
2. **15 toolCode**: +cabecera `'x-nowcrm-turn-policy': String($('Normalize input').first().json.turnPolicyToken || '')`.
3. **`CRM Agent`**: +CONTRATO de herramientas (por clases de turno: no tools en meta/corrección/queja/
   capacidad/cómo-funciona/futuro; solo datos reales; nunca facturas; si 403, no insistir).
- `PUT /workflows` → **200**; workflow sigue **active**.
- Verificación en fresco (`n8n-inspect`): **15/15** toolCode con la cabecera; Normalize expone el token; el
  agente tiene el contrato.

## 4. Verificación del endpoint contra STAGING REAL
`node scripts/verify-tool-policy.mjs` contra
`https://crm-inmobiliario-crm-staging.hvdnby.easypanel.host/api/agent/tool` (secreto de `.env.local`):

| Caso | Resultado |
|---|---|
| A token válido + tool permitida | **HTTP 200** (permitido) |
| B token válido + cross-domain | **403** tool_not_allowed_for_turn/domain_not_allowed |
| C turno no-datos + read | **403** tool_not_allowed_for_turn/turn_reads_no_data |
| D token expirado | **403** invalid_turn_policy/expired |
| E token manipulado | **403** invalid_turn_policy/bad_signature |
| G invoice tool | **403** tool_forbidden_for_assistant |
| F sin token (compat) | **200** (strict aún OFF) |

→ **7/7 OK.** El enforcement funciona en el servidor desplegado. Que A/G/… den el resultado esperado
confirma además que **staging ejecuta el código de enforcement** y que el secreto local coincide con el de
staging (si no, todo sería 401).

## 5. Bug real encontrado y corregido (vía verificación)
Caso A daba `500 query_failed` con `get_pending_tasks`. Causa: la tabla `tasks` **no tiene columna
`description`**, pero `getPendingTasks` y `getClient360` la seleccionaban → rompían "tareas pendientes" (n8n
y local-first). **Corregido** (se elimina `description` del select; verificado con SQL: la consulta ahora
devuelve filas sin error). Requiere redeploy de la app para surtir efecto en staging.

## 6. Token forwarding — confirmado
La app firma el token (`v2 route`) y lo envía en el body del webhook (`turnPolicyToken`); n8n lo expone en
`Normalize input` y lo reenvía en `x-nowcrm-turn-policy` en las 15 tools. Cadena app→n8n→endpoint cerrada.

## 7. Legacy
Sin cambios; sigue blindado por env (`ALLOW_LEGACY_ASSISTANT`, P51). Ruta activa n8n, sin invoices.

## 8. Validaciones
tsc ✅ · lint 0 warnings ✅ · build ✅ · deploy-gate ✅ · **25 suites de evals TODO VERDE** ✅ ·
`node --check` de los scripts n8n ✅.
Scans: `from('documents')`=0 · `from('invoices')` en agents=0 · sin secretos hardcodeados en scripts ·
`.env.local` no trackeado · token completo en logs=0.

## 9. Archivos tocados
**Código:** `src/lib/agent-tool-readers.ts` (fix tasks.description).
**Scripts (nuevos, sin secretos; leen `.env.local` en runtime):** `n8n-inspect.mjs`, `n8n-analyze.mjs`,
`n8n-show-toolcode.mjs`, `n8n-patch-live.mjs` (+`patch-n8n-workflow.mjs` de antes). `verify-tool-policy.mjs`
(fallback `.env.local`). **Docs:** este informe.
**n8n (fuera del repo):** workflow vivo parcheado (backup en temp del SO). **Migraciones:** 0.

## 10. Qué NO se hizo / pendiente
- **Strict mode (`AGENT_TOOLS_REQUIRE_POLICY=true` en EasyPanel):** el usuario pidió NO activarlo aún.
  Ahora que n8n reenvía el token, se puede activar sin romper lecturas (caso F pasará de 200 a 403).
- **QA adversarial escribiendo en el chat de la UI:** requiere sesión interactiva autenticada (no disponible
  en esta sesión). Checklist listo en `docs/P51B_STAGING_ADVERSARIAL_QA_RESULTS.md`.
- **Redeploy de staging** para incorporar el fix de `tasks.description`.

## 11. Cómo terminar de cerrar (operador)
1. Redeploy de la app (incluye el fix de tareas).
2. En EasyPanel: `AGENT_TOOLS_REQUIRE_POLICY=true` → redeploy. Re-ejecutar `verify-tool-policy` → caso F debe
   pasar a **403 turn_policy_required**.
3. Confirmar en logs que desaparecen los `WARN unscoped_tool_call`.
4. Ejecutar el checklist de chat en la UI (`P51B_STAGING_ADVERSARIAL_QA_RESULTS.md`).

---

**P51C — N8N VIVO PARCHEADO (15/15 tools con turnPolicyToken + contrato en el agente), TOKEN FORWARDING
CERRADO, ENFORCEMENT VERIFICADO 7/7 CONTRA STAGING REAL Y UN BUG DE READER (tasks.description) CORREGIDO.
PENDIENTE (no bloqueado por mí): activar strict en EasyPanel y la QA de chat en la UI.**
