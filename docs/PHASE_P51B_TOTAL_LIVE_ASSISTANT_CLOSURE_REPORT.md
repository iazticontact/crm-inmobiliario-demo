# P51B — TOTAL LIVE ASSISTANT CLOSURE

## Veredicto: ⛔ P51B BLOCKED — falta acceso a n8n vivo, EasyPanel (env) y UI/staging interactiva

Sigo la regla de la fase: **no invento "completado"**. Tres acciones operativas requieren accesos que no
tengo en esta sesión no-interactiva:

1. **Editar el workflow de n8n en vivo** — el conector MCP de n8n pide una autenticación que no puedo
   completar aquí; no tengo credenciales ni API key del n8n. → **BLOCKED**.
2. **Activar `AGENT_TOOLS_REQUIRE_POLICY=true` en EasyPanel** — sin credenciales de EasyPanel. → **BLOCKED**.
3. **QA adversarial interactiva en la UI/staging + logs** — sesión no-interactiva. → **BLOCKED**.

Todo lo que **sí** se puede hacer en código está hecho, endurecido y **testeado** (25 suites verdes), con
un **script ejecutable** y **runbooks exactos** para que el operador cierre los 3 puntos anteriores.

---

## 1-2. Baseline / estado heredado
`main`, árbol limpio, HEAD `865a6e2` (P51). Staging `/login` → 200; n8n instance reachable (200). Estado
P51: token firmado + endpoint con guard + legacy blindado por env + app firma/forwarda el token.

## 3. Accesos usados / no disponibles
Usados: repo, Supabase MCP (solo lectura de datos demo en fases previas), `curl` (disponibilidad). No
disponibles: editor/API de n8n, EasyPanel, chat UI autenticado, logs de servidor.

## 4-6. Backup n8n / nodos / prompt
⛔ No aplicados (sin acceso). Pasos exactos en `docs/P51B_N8N_WORKFLOW_PATCH_REPORT.md` (backup, header
`x-nowcrm-turn-policy` por nodo, system prompt por clases de turno).

## 7. Token propagation (hecho en código)
La app firma el Turn Policy Token con la decisión del turno y lo envía a n8n en el body del webhook
(`turn` + `turnPolicyToken`) — ya implementado en P51 (`v2 route` + `n8n-assistant-client`). n8n debe
reenviarlo (paso operativo BLOCKED). El endpoint acepta el token en header **o** body (`turnPolicyToken`
camel / `turn_policy_token` snake) — robustez añadida en P51B.

## 8. Strict mode
⛔ No activado (env EasyPanel). El código ya lo soporta: `AGENT_TOOLS_REQUIRE_POLICY=true` ⇒ sin token → 403
`turn_policy_required`; `ALLOW_UNSCOPED_AGENT_TOOLS_DEV` solo dev. Testeado offline (caso F/F2/F3).

## 9. Tool endpoint verification (hecho + script)
Enforcement extraído a función PURA `evaluateToolPolicy` (P51B) → cubre A–H. Endpoint refactorizado para
usarla. **Script `scripts/verify-tool-policy.mjs`** ejecuta los casos contra el endpoint real (lo corre el
operador con `AGENT_TOOL_SECRET`). Detalle en `docs/P51B_TOOL_POLICY_VERIFICATION.md`.
- A token válido+permitida→200 · B/C no permitida/no-datos→403 tool_not_allowed_for_turn · D expirado / E
  manipulado / H secreto malo→403 invalid_turn_policy · G facturación→403 tool_forbidden_for_assistant · F
  sin token+strict→403 turn_policy_required.

## 10. Legacy closure (hecho)
`resolveAssistantProvider` (P51): el legacy V1 (openai/v1/local) SOLO con `ALLOW_LEGACY_ASSISTANT=true`. Por
defecto, cualquier `ASSISTANT_PROVIDER` → n8n. Testeado (`assistant-legacy-hardening`): provider desconocido/
sin flag/flag false → n8n; solo `true` → legacy. `from('invoices')` en ruta activa (agents) = 0.

## 11-12. UI/staging QA · Real-time QA
⛔ BLOCKED (interactivo). Checklists ejecutables en `docs/P51B_STAGING_ADVERSARIAL_QA_RESULTS.md` (18
categorías) y `docs/P51B_REAL_TIME_DATA_QA.md`.

## 13. Logs / traces
Traza por turno `[assistant.turn] { turnType, domain, action, shouldReadData, shouldCallN8n, reason }`
(P50). Endpoint: `WARN unscoped_tool_call` (compat) y `403` con `reason`. **Ningún token completo ni secreto
se registra** (scan verificado). Confirmación en logs reales: BLOCKED (sin acceso).

## 14. Evals
Runner temporal (borrado) — **25 suites TODO VERDE**. Nueva `assistant-turn-policy-strict` (A–H + compat +
override dev + secreto incorrecto). Se mantienen todas las anteriores (no baja cobertura).

## 15. No regresiones
20+ suites previas verdes (clientes/inmuebles/operaciones/citas/tareas/trámites/documentos, comisiones P46,
propiedad P47, contexto P48, pragmática P49, router P50, contrato P51). Build/lint/deploy-gate OK.

## 16. Scans de seguridad
`from('documents')`=0 · `from('invoices')` en agents=0 · `get_invoices_summary` bloqueada por endpoint ·
service_role frontend=0 (solo strings de diagnóstico) · token completo en logs=0 · UUID/SQL/stack en
respuestas=0 · legacy blindado por env.

## 17-18. Archivos / migraciones
**Nuevos:** `assistant-turn-policy-strict.evals.ts`, `scripts/verify-tool-policy.mjs`,
`P51B_N8N_WORKFLOW_PATCH_REPORT.md`, `P51B_TOOL_POLICY_VERIFICATION.md`,
`P51B_STAGING_ADVERSARIAL_QA_RESULTS.md`, `P51B_REAL_TIME_DATA_QA.md`, este informe.
**Modificados:** `turn-policy.ts` (evaluateToolPolicy), `/api/agent/tool/route.ts` (usa la función pura +
token header/body). **Migraciones:** 0.

## 19. Qué NO se hizo
No edité el workflow de n8n, no activé strict en EasyPanel, no ejecuté QA UI ni leí logs de staging (sin
acceso). No eliminé el código legacy (bloqueado por env). No toqué facturación/pasarelas/OCR/emails.

## 20. Riesgos restantes
- Hasta editar n8n + activar strict, el endpoint sigue en **compat** (sirve tools sin token, con `WARN`). El
  enforcement primario (la app no llama a n8n en turnos no-datos) ya está activo.
- El comportamiento del agente n8n depende de que se actualice su system prompt (paso operativo).

## 21. Cómo desbloquear (operador)
1. Aplicar `docs/P51B_N8N_WORKFLOW_PATCH_REPORT.md` (backup + header por nodo + system prompt).
2. Ejecutar `node scripts/verify-tool-policy.mjs` contra staging (con `AGENT_TOOL_SECRET`).
3. Poner `AGENT_TOOLS_REQUIRE_POLICY=true` en EasyPanel; confirmar en logs que desaparecen los `WARN`.
4. Ejecutar el checklist de `docs/P51B_STAGING_ADVERSARIAL_QA_RESULTS.md` y `P51B_REAL_TIME_DATA_QA.md`.

---

**P51B BLOCKED — CÓDIGO DE CIERRE COMPLETO Y TESTEADO (evaluateToolPolicy puro + 25 suites verdes, endpoint
acepta token header/body, strict mode listo, legacy blindado, script de verificación + runbooks exactos).
PENDIENTE POR FALTA DE ACCESO: EDITAR n8n VIVO, ACTIVAR STRICT EN EASYPANEL Y QA ADVERSARIAL EN UI/STAGING.**
