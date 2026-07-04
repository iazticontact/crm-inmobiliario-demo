# P50 — TOTAL ASSISTANT ROUTING & REASONING RESCUE

**Estado:** COMPLETADO
**Fecha:** 2026-07
**Objetivo:** el Asistente **razona el turno antes de actuar**. Ninguna entidad del CRM provoca una consulta por sí sola. Cuando el usuario habla del propio Asistente, corrige, se queja o discrepa, NO se leen datos aunque mencione entidades.

---

## 1. Baseline
`main`, árbol limpio, HEAD `d37116c` (P49).

## 2. Mapa real de rutas (antes)
- **Frontend** (`app/(saas)/assistant/page.tsx`): envía `message`, `threadId`, `lastResults` por conversación, `lastReferencedClient*`. Cachea `referencedList/dataPreview` como contexto.
- **Backend** (`/api/assistant/v2`): Supabase(RLS) → auth → workspace → **local-first** (`tryLocalAnswer`) → si no, **n8n** (default) → si `ASSISTANT_PROVIDER=openai/v1/local`, **legacy V1** (`runNowLabsAgent` + `assistant-tools.ts`).
- **local-first** (`local-answers.ts`): P49 hacía pragmática primero, pero seguía habiendo caminos donde una **mención de entidad** podía enrutar a lectura, y no existía una **decisión única** ni capa meta.
- **n8n**: cerebro por defecto; llama a `/api/agent/tool` (service-role, allowlist read-only). Podía llamar tools por entidad sin conocer el acto comunicativo.
- **legacy V1**: `assistant-tools.ts` (opt-in) todavía consulta `invoices` para KPIs; no pasa por pragmática.

## 3. Causa raíz sistémica
No había un **contrato único de decisión por turno** con prioridad del acto comunicativo sobre la entidad, ni una **capa meta** (hablar de la respuesta del Asistente), ni **permisos de tools por turno**. Resultado: mencionar una entidad podía disparar lecturas mecánicas incluso en correcciones/quejas/metapreguntas.

## 4. Por qué P49 no bastaba
P49 añadió pragmática (capacidad/cómo-funciona/futuro), pero **sin** categorías `assistant_meta` / `user_correction` / `user_complaint` / `disagreement`, y **sin** un router único con permisos. Una queja o una metapregunta con una entidad seguía pudiendo leer.

## 5. Nuevo contrato de decisión por turno (`src/lib/agents/assistant-turn.ts`, PURO)
`decideTurn(message, ctx)` → `AssistantTurnDecision { turnType, domain, action, shouldReadData, shouldWriteData, shouldCallN8n, shouldUseLastResult, shouldAskClarification, shouldExplainAssistantBehavior, confidence, reason }`.
**Prioridad:** `assistant_meta > user_correction > user_complaint > disagreement > capacidad/cómo/futuro/social/ayuda > escritura > data_followup > data_read > ambiguo`.
Absorbe P48 (entidad) y P49 (pragmática) y añade la capa meta con prioridad máxima. Diccionarios + reglas (no hardcodea frases).

## 6. Router central
`local-answers.tryLocalAnswer` orquesta ahora una **única** decisión (`decideTurn`) y enruta: turnos no-datos → generador conceptual/recuperación (sin leer); escritura → deriva; datos → local-first + política de contexto/anti-contradicción (P48) + errores (P48). Una sola ruta; no hay pragmatics/intent/context compitiendo.

## 7. Meta-intent + recovery
`assistant_meta` / `user_correction` / `user_complaint` / `disagreement` → **nunca leen**, aunque el mensaje contenga cualquier entidad. Generadores de recuperación (`assistantMetaAnswer`, `userCorrectionAnswer`, `userComplaintAnswer`, `disagreementAnswer`): reconocen, explican la interpretación, ofrecen siguiente acción; **no listan datos**. El "recovery mode" es emergente: al clasificar el turno como meta/corrección, la lectura equivocada no se repite (no hay estado persistente que mantener).

## 8. Tool permission layer (`assistant-tool-permissions.ts`, PURO)
`allowedToolsForTurn(decision)`: no-datos ⇒ `[]`; Facturación ⇒ `[]`; `data_read` dominio ⇒ `["<d>.read","<d>.search"]`; escritura ⇒ solo `write_prepare`. `FORBIDDEN_ASSISTANT_TOOLS` (invoicing.*, get_invoices_summary) siempre denegadas.

## 9-11. Cambios app / n8n / legacy
- **App (primario):** los turnos no-datos se responden localmente y **no llaman a n8n** → n8n no puede leer en esos turnos. Enforcement 100% bajo control de la app.
- **Backend (`/api/agent/tool`):** acepta `turn` opcional; si `turn.shouldReadData===false` → **rechaza** lecturas con `tool_not_allowed_for_turn` (403). Opt-in, no rompe callers actuales.
- **n8n:** contrato documentado en `docs/AGENT_N8N_CONTRACT.md` (permisos por turno + reglas de prompt). El reenvío de `turn` desde el workflow al endpoint de tools queda como paso pendiente (el endpoint ya lo soporta).
- **Legacy V1:** sigue opt-in (`ASSISTANT_PROVIDER`), **no** es la ruta por defecto; consulta `invoices` para KPIs (deuda pre-existente, documentada). No puede activarse sin cambiar env; el default (n8n + local-first) no lo usa.

## 12. Frontend state/history
Sin cambios de contrato: la app ya reenvía `lastResults` por conversación (usado por la política de contexto). La traza `[assistant.turn]` server-side permite depurar el routing.

## 13. Real-time / freshness
Lecturas de datos: Supabase en vivo con sesión RLS (fresco). Conceptual/meta: no consultan. Follow-up de confirmación: usa `lastResults` sin reconsultar (anti-contradicción P48). `/api/agent/tool` es `force-dynamic` (sin caché).

## 14-15. Error policy + generadores
Política de errores P48 intacta (código seguro por entidad, vacío ≠ error, no borrar resultado válido). Nuevos generadores de recuperación seguros (`isSafeAnswer`).

## 16. Evals generales (no hardcoded)
Runner temporal (`npx tsx`, borrado) — **22 suites TODO VERDE ✅**. Nuevas por **propiedades**:
- `assistant-turn`: para **todas** las entidades, META/corrección/queja/discrepancia con mención de entidad **no** leen; capacidad/cómo/futuro no leen; lecturas reales sí; metamórfico (acentos/mayúsculas); generadores de recuperación seguros y sin listas.
- `assistant-tool-permissions`: no-datos ⇒ `[]`; Facturación ⇒ `[]`; `data_read` ⇒ tools del dominio; forbidden invoice tools siempre denegadas; escritura ⇒ solo `write_prepare`.

## 17. Adversarial QA
`docs/ASSISTANT_ADVERSARIAL_QA_PLAYBOOK.md` — 16 categorías con `turnType`/`shouldReadData`/`shouldCallN8n`/comportamiento esperado.

## 18. QA en UI/staging (honesto)
Las evals cubren la lógica de decisión (donde estaba la clase de fallo). No he ejecutado una sesión manual en la UI de staging en esta iteración; el playbook adversarial está listo para hacerlo. La traza `[assistant.turn]` permite confirmar en logs que `shouldReadData=false` no dispara readers. **Pendiente honesto:** validación manual en UI real.

## 19. No regresiones
Clientes/inmuebles/operaciones/citas/tareas/trámites/documentos local-first, Facturación aislada, Comisiones P46, propiedad móvil P47, contexto P48 y pragmática P49 (absorbida por el router) → **20 suites previas siguen verdes**. n8n intacto. `from('documents')`=0.

## 20. Seguridad / scans
`from('documents')`=0 · `from('invoices')` en la ruta **activa** del Asistente (agents + v2 local-first)=0 · service_role en frontend/módulos nuevos=0 · UUID/SQL/stack en respuestas=0 (guard `isSafeAnswer` + evals) · `router.back`=0 · Facturación no leída en la ruta activa.

## 21-22. Archivos / migraciones
**Nuevos:** `assistant-turn.ts`, `assistant-tool-permissions.ts`, sus 2 evals, `AGENT_N8N_CONTRACT.md`, `ASSISTANT_ADVERSARIAL_QA_PLAYBOOK.md`, este informe.
**Modificados:** `local-answers.ts` (router único + traza), `/api/agent/tool/route.ts` (guard por turno), `docs/URGENT_VALIDATOR_TEST_CASES.md`. **Migraciones:** 0.

## 23. Qué NO se hizo
No se desplegó/editó el workflow de n8n en vivo (documentado como contrato). No se eliminó el legacy V1 (opt-in, no default; blindado por no ser la ruta activa). No se amplió ninguna acción de escritura. Sin service_role frontend, secretos ni migraciones.

## 24. Riesgos restantes
- El reenvío de `turn` desde n8n al endpoint de tools es el paso pendiente para el enforcement de defensa en profundidad (el endpoint ya lo soporta; la app ya garantiza que los turnos no-datos no llaman a n8n).
- Legacy V1 (`assistant-tools.ts`) sigue consultando `invoices` para KPIs; opt-in, no default.
- Falta la sesión de QA manual en UI/staging (playbook listo).

## 25. Cómo validar con el jefe
`docs/URGENT_VALIDATOR_TEST_CASES.md` (Flujo 11) + `ASSISTANT_ADVERSARIAL_QA_PLAYBOOK.md`: probar corrección, queja, «¿por qué me listas…?», capacidad, cómo-funciona, futuro (no debe listar), y contrastarlos con lecturas reales (sí listan).

---

**P50 COMPLETADO — EL ASISTENTE DECIDE CADA TURNO ANTES DE ACTUAR, NO LEE DATOS POR MENCIONAR ENTIDADES, HAY CAPA META/RECUPERACIÓN, PERMISOS DE TOOLS POR TURNO (CON GUARD EN BACKEND) Y TRAZA PARA DEMOSTRAR POR QUÉ HIZO CADA COSA.**
