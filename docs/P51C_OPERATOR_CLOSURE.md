# P51C — Cierre operativo (checklist ejecutable)

Estado de cada paso a fecha de este documento. ⚠ No marcar P51/P51B como cerrado del todo hasta completar
los pasos 4–9 (strict + QA de chat).

## 1. Redeploy de staging con el fix de `tasks` — ✅ HECHO (auto-deploy)
Staging auto-despliega desde `main` al hacer push. Verificado: `get_pending_tasks` → **HTTP 200** (antes daba
`500 query_failed` por la columna inexistente `tasks.description`, ya corregida).

## 2–3. Verificación del enforcement (compat, strict OFF) — ✅ HECHO
```
AGENT_TOOL_URL="https://crm-inmobiliario-crm-staging.hvdnby.easypanel.host/api/agent/tool" \
  node scripts/verify-tool-policy.mjs
```
Resultado real: **7/7 OK** → A 200 · B/C/D/E/G 403 (con su `reason`) · **F 200 = compat** (strict aún OFF).
(El secreto se lee de `.env.local`; nunca se imprime.)

## 4. Activar strict en EasyPanel — ✅ HECHO
`AGENT_TOOLS_REQUIRE_POLICY=true` activado en EasyPanel + Implementar (2026-07).
(Pasos: app **CRM staging** → **Environment** → añadir la var → Save → Redeploy.)

## 5–7. Re-verificación tras strict — ✅ HECHO, 7/7 OK
PowerShell:
```
$env:EXPECT_STRICT="1"; $env:AGENT_TOOL_URL="https://crm-inmobiliario-crm-staging.hvdnby.easypanel.host/api/agent/tool"; node scripts/verify-tool-policy.mjs
```
Resultado real:
- **F sin token → 403 `turn_policy_required`** (antes 200). ✅ strict activo.
- **A con token → 200** (lecturas permitidas siguen OK). ✅
- **G facturación → 403 `tool_forbidden_for_assistant`**. ✅
- B/C/D/E → 403. **7/7 OK.** ✅

## 8. Logs (EasyPanel → Logs de la app) — ⏳
- Buscar `unscoped_tool_call`: en flujos normales **no debe aparecer** (n8n ya reenvía el token).
- `tool_not_allowed_for_turn` / `invalid_turn_policy` / `tool_forbidden_for_assistant`: solo en pruebas
  negativas.
- Nunca aparece el token completo ni secretos.

## 9. QA adversarial de chat en la UI — ⏳ ÚLTIMO PASO (lo haces tú en la UI)

### 9.0 CANARIO PRIMERO (imprescindible)
Como strict ya está activo, la PRIMERA prueba confirma que las lecturas siguen funcionando (que n8n reenvía
bien el token). Escribe en el chat de staging:

> **muéstrame los clientes**

- ✅ Si responde con la LISTA de clientes → n8n reenvía el token correctamente bajo strict. Sigue con el checklist.
- ⛔ Si dice "no puedo acceder / código …" → strict rompió las lecturas (forwarding). **Rollback inmediato**:
  EasyPanel → `AGENT_TOOLS_REQUIRE_POLICY=false` → redeploy, y avísame para revisar el forwarding en n8n.

> Nota técnica: el forwarding es correcto por construcción — cada tool ya usa
> `$('Normalize input').first().json.workspaceId` para el workspace (así han funcionado siempre las
> lecturas), y el token se lee del MISMO nodo por la misma vía. El canario solo lo confirma en vivo.

### 9.1 Checklist completo
Ejecutar `docs/P51B_STAGING_ADVERSARIAL_QA_RESULTS.md` (18 categorías). Anotar por caso: respuesta, si hubo
tool call, `[assistant.turn]` (turnType/shouldReadData), pass/fail. Aprobado: meta/corrección/queja/
capacidad/cómo/futuro **no** listan datos; lecturas reales sí.

## 10. Estado de cierre
- ✅ n8n vivo parcheado (15/15 tools reenvían el token) + contrato en el agente.
- ✅ Token forwarding app→n8n→endpoint verificado (7/7 contra staging real).
- ✅ Fix de reader `tasks` desplegado y verificado (200).
- ✅ **Strict mode ACTIVO** y verificado (F → 403 turn_policy_required; A → 200; G → 403). 7/7.
- ⏳ **QA de chat en UI** (paso 9) — último paso, lo ejecutas en la UI (canario + checklist).

**Falta solo el paso 9 (QA de chat) para cerrar P51/P51B del todo.** Todo lo demás está cerrado con evidencia.
