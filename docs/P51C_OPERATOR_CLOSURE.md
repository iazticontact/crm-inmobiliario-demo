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

## 4. Activar strict en EasyPanel — ⏳ PENDIENTE (requiere acceso a EasyPanel)
1. EasyPanel → proyecto/app **CRM staging** (la que sirve `crm-inmobiliario-crm-staging…`).
2. Pestaña **Environment** (variables de entorno).
3. Añadir / cambiar:  `AGENT_TOOLS_REQUIRE_POLICY=true`
4. **Save**.
5. **Redeploy / Restart** de la app (para que tome la variable).
6. Esperar a que el estado sea *running* y `/login` responda 200.

> No añadir `ALLOW_UNSCOPED_AGENT_TOOLS_DEV` en staging/prod. No tocar `AGENT_TOOL_SECRET`.

## 5–7. Re-verificar tras strict — ⏳ (comando listo)
```
EXPECT_STRICT=1 \
  AGENT_TOOL_URL="https://crm-inmobiliario-crm-staging.hvdnby.easypanel.host/api/agent/tool" \
  node scripts/verify-tool-policy.mjs
```
Debe dar **7/7 OK** con:
- **F sin token → 403 `turn_policy_required`** (antes 200). ← señal de que strict está activo.
- **A con token → 200** (las lecturas permitidas siguen funcionando).
- B/C/D/E/G → 403 igual que antes.

## 8. Logs (EasyPanel → Logs de la app) — ⏳
- Buscar `unscoped_tool_call`: en flujos normales **no debe aparecer** (n8n ya reenvía el token).
- `tool_not_allowed_for_turn` / `invalid_turn_policy` / `tool_forbidden_for_assistant`: solo en pruebas
  negativas.
- Nunca aparece el token completo ni secretos.

## 9. QA adversarial de chat en la UI — ⏳ (checklist listo)
Ejecutar `docs/P51B_STAGING_ADVERSARIAL_QA_RESULTS.md` (18 categorías) escribiendo en el chat del Asistente
en staging. Anotar por caso: respuesta, si hubo tool call, `[assistant.turn]` (turnType/shouldReadData),
pass/fail. Aprobado: meta/corrección/queja/capacidad/cómo/futuro **no** listan datos; lecturas reales sí.

## 10. Estado de cierre
- ✅ n8n vivo parcheado (15/15 tools reenvían el token) + contrato en el agente.
- ✅ Token forwarding app→n8n→endpoint verificado (7/7 contra staging real).
- ✅ Fix de reader `tasks` desplegado y verificado (200).
- ⏳ **Strict mode** (paso 4) — pendiente de EasyPanel.
- ⏳ **QA de chat en UI** (paso 9) — pendiente de sesión interactiva.

**No cerrar P51/P51B hasta 4 y 9 hechos.** Todo lo demás está cerrado con evidencia.
