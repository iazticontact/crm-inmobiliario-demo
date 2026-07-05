# P51 — LIVE ASSISTANT CONTRACT ENFORCEMENT + N8N REAL FIX + STAGING ADVERSARIAL QA

## Veredicto: ⛔ P51 BLOCKED — falta acceso a n8n vivo y a la UI/staging interactiva

El **código** del contrato queda completo y verificado (24 suites verdes). Pero dos P0 dependen de accesos
que **no tengo** en esta sesión y, por honestidad (regla explícita de la fase), NO marco P51 como completado:

1. **Editar el workflow de n8n en vivo** — el conector MCP de n8n requiere autenticación que no puedo
   completar en una sesión no-interactiva. El workflow vive en un n8n externo. → **BLOCKED**.
2. **QA adversarial manual en la UI/staging** — sesión no-interactiva: no puedo iniciar sesión ni escribir
   en el chat para observar trazas en vivo. → **BLOCKED**.

Todo lo demás (enforcement en backend, token firmado, blindaje legacy, evals, docs, runbooks) **está hecho**.

---

## 1. Baseline
`main`, árbol limpio, HEAD `7cc4af0` (P50).

## 2. Mapa real de rutas
`docs/P51_ASSISTANT_REAL_ROUTE_MAP.md` (trazado desde código): frontend → `/api/assistant/v2` → provider
(n8n default, legacy blindado) → local-first (`decideTurn`) → n8n con token → `/api/agent/tool` (enforcement).

## 3. Riesgos detectados (de P50)
n8n no editado; endpoint soportaba `turn` pero no un token infalsificable; legacy activable por env; sin QA UI.

## 4. Cambios backend
- **`turn-policy.ts`** (nuevo): Turn Policy Token firmado (HMAC-SHA256 con `AGENT_TOOL_SECRET`, server-only).
  `signTurnPolicy` / `verifyTurnPolicy` (firma, expiración ~90 s, anti-manipulación). Payload sin secretos ni
  PII (dominio, read/write, allowedTools, exp). `policyAllowsTool` (dominio + read/write + facturación).
- **`/api/agent/tool`**: bloquea SIEMPRE `get_invoices_summary`; con token verifica firma/expiración/permiso;
  sin token → estricto (`AGENT_TOOLS_REQUIRE_POLICY=true`) rechaza, compat registra `WARN unscoped_tool_call`.
  `ALLOW_UNSCOPED_AGENT_TOOLS_DEV` solo dev.

## 5. Cambios frontend
Sin cambios de contrato (ya reenvía `lastResults`). El circuito app-side ya garantiza que los turnos no-datos
no llaman a n8n.

## 6. Cambios n8n
**Documentados y listos** (`AGENT_N8N_CONTRACT.md`, §6: pasos exactos para reenviar `x-nowcrm-turn-policy`).
**La edición del workflow vivo queda BLOCKED** (sin acceso). La app ya firma y envía `turn` + `turnPolicyToken`
en el body del webhook (`runN8nAssistant`), listo para que n8n lo reenvíe.

## 7. Cambios legacy
**`assistant-provider.ts`** (nuevo, PURO): `resolveAssistantProvider` — el legacy V1 (openai/v1/local) SOLO se
activa con `ALLOW_LEGACY_ASSISTANT=true`. Por defecto, cualquier `ASSISTANT_PROVIDER` → n8n. El v2 route lo usa
→ el legacy ya no puede reactivarse por env en staging/prod sin el flag explícito. (No se elimina el código
legacy; queda **técnicamente bloqueado**, no solo documentado.)

## 8. Turn Policy Token
Firmado server-side, expira, ligado a conversación/turno (cid/tid), verificable por el endpoint, sin secretos
ni PII. Evals: roundtrip, manipulación → inválido, secreto incorrecto → inválido, expiración, no filtra el
secreto.

## 9. Tool permission enforcement
`policyAllowsTool`: `read=false` ⇒ rechaza toda lectura; cross-domain rechazado; facturación siempre rechazada.
El endpoint lo aplica. Evals: turno meta/capacidad/futuro ⇒ `allowedTools=[]` ⇒ `search_clients`/`crm_read_query`
rechazadas; lectura de clientes ⇒ permitidas + cross-domain rechazado; `get_invoices_summary` siempre rechazada.

## 10. Observabilidad
Traza segura por turno `[assistant.turn] { turnType, domain, action, shouldReadData, shouldCallN8n, reason }`
(P50). El endpoint registra `WARN unscoped_tool_call` y los `403` con su `reason`. Sin PII/secretos/SQL/stack.

## 11-12. UI/staging QA y n8n QA
⛔ **BLOCKED** (sin acceso interactivo). `docs/P51_STAGING_ADVERSARIAL_QA_RESULTS.md` incluye un **checklist
ejecutable** (15 categorías copiar/pegar) + verificación de enforcement por logs. Staging responde `200` (curl).

## 13. Unauthorized tool tests
Cubiertos por evals (`assistant-n8n-contract`): tool sin permiso / fuera de allowedTools / facturación /
token inválido/expirado → rechazados. La verificación **en vivo** contra el endpoint desplegado queda en el
checklist (requiere token firmado + n8n).

## 14. Real-time data verification
`/api/agent/tool` es `force-dynamic` (sin caché). Lecturas con sesión RLS en vivo. Verificación end-to-end
(crear un registro y ver que la siguiente lectura lo refleja) queda en el checklist de UI (**BLOCKED**).

## 15. No regresiones
20 suites previas verdes (clientes/inmuebles/operaciones/citas/tareas/trámites/documentos, comisiones P46,
propiedad P47, contexto P48, pragmática P49, router P50). `from('documents')`=0.

## 16. Seguridad / scans
`from('documents')`=0 · `from('invoices')` en agents (ruta activa)=0 · service_role en frontend/módulos nuevos=0
· UUID/SQL/stack en respuestas=0 · legacy blindado por env · facturación bloqueada en el endpoint.

## 17. Evals
Runner temporal (borrado) — **24 suites TODO VERDE**: nuevas `assistant-n8n-contract` (token + permisos) y
`assistant-legacy-hardening` (provider + invariante de router).

## 18. Archivos
**Nuevos:** `turn-policy.ts`, `assistant-provider.ts`, sus 2 evals, `P51_ASSISTANT_REAL_ROUTE_MAP.md`,
`P51_STAGING_ADVERSARIAL_QA_RESULTS.md`, este informe.
**Modificados:** `/api/agent/tool/route.ts`, `/api/assistant/v2/route.ts`, `n8n-assistant-client.ts`,
`AGENT_N8N_CONTRACT.md`. **Migraciones:** 0.

## 19. Qué NO se hizo
No edité el workflow de n8n en vivo (sin acceso). No ejecuté QA manual en UI/staging (sesión no-interactiva).
No eliminé el código legacy (queda bloqueado por env). No activé `AGENT_TOOLS_REQUIRE_POLICY=true` (rompería el
n8n actual hasta que reenvíe el token; se activa tras editar n8n).

## 20. Bloqueos
1. **n8n vivo**: falta acceso al workflow. Pasos exactos en `AGENT_N8N_CONTRACT.md` §6.
2. **UI/staging QA**: sesión no-interactiva. Checklist en `P51_STAGING_ADVERSARIAL_QA_RESULTS.md`.

## 21. Riesgos restantes
- Hasta editar n8n + activar `AGENT_TOOLS_REQUIRE_POLICY=true`, el endpoint está en **modo compat** (sirve
  tools sin token, con `WARN`). El enforcement primario (app no llama a n8n en turnos no-datos) ya está activo.
- Legacy V1 sigue en el repo (bloqueado por env), no eliminado.

## 22. Cómo validar con el jefe
1. Ejecutar el checklist de `P51_STAGING_ADVERSARIAL_QA_RESULTS.md` en el chat de staging.
2. (Infra) Editar el workflow de n8n (§6 del contrato) y poner `AGENT_TOOLS_REQUIRE_POLICY=true`.
3. Confirmar en logs que no hay `WARN unscoped_tool_call` y que los turnos no-datos no llaman a tools.

---

**P51 BLOCKED — CÓDIGO DEL CONTRATO COMPLETO Y VERIFICADO (24 SUITES VERDES, TOKEN FIRMADO, ENDPOINT IMPONE
PERMISOS, LEGACY BLINDADO POR ENV). PENDIENTE POR FALTA DE ACCESO: EDITAR EL WORKFLOW DE n8n EN VIVO Y LA QA
ADVERSARIAL MANUAL EN UI/STAGING (RUNBOOKS EXACTOS ENTREGADOS).**
