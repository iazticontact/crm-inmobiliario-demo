# P65 — SECURE ACTIONS & N8N CONTROL PLANE (vertical slice real)

**Estado:** ✅ CONTROL PLANE OPERATIVO EN STAGING / límites declarados abajo
**Fecha:** 2026-07-12

> Alcance honesto: P65 pedía un plano completo (acciones + automatizaciones + Playwright + red team masivo).
> Con el presupuesto disponible se entrega el **núcleo verificable end-to-end** — el ciclo completo de
> acciones seguras funcionando contra staging REAL con n8n conectado — y se declara lo restante. Nada se
> simula: cada PASS es contra el endpoint desplegado y la BD real.

## Preflights — ✅
Repo limpio (HEAD P64 `b0dbc12`) · n8n activo (15/15 tools, backup) · staging marcador p64 → p65 tras deploy.

## Núcleo entregado (todo REAL y probado)
1. **Migración aditiva `assistant_actions`** (RLS select por workspace; escrituras solo server-side).
   Sirve de persistencia del ciclo + **audit log** (estado, hashes, resultado, safe_error_code).
2. **Registro central** (`action-registry.ts`): 4 acciones — `tasks.create`, `tasks.complete`,
   `portfolio.update_price`, `clients.update_phone` — con allowedFields/forbiddenFields, expiración 10 min,
   **confirmación obligatoria**. Facturación/delete **inexistentes por construcción**.
3. **Token de ACCIÓN** (`action-policy.ts`): HMAC prefijo `act.` con previewHash + idempotencyKey +
   confirmed. **Un token de lectura JAMÁS sirve para escribir** (verificado por eval y E2E).
4. **`/api/agent/action`** (server-to-server): `prepare` (lee estado actual → valida campos → persiste →
   preview + token) · `confirm` (valida token/estado/expiración/previewHash → **cerrojo atómico**
   prepared→executing contra confirmaciones concurrentes → ejecuta EXACTAMENTE el preview con
   **optimistic lock** por `updated_at` → `ACTION_CONFLICT` si la entidad cambió, nunca sobrescritura
   silenciosa → **read-after-write** obligatorio antes de `completed`) · `cancel` · `status`.
   **Idempotencia**: doble confirm → `duplicate:true`, misma respuesta, sin segunda escritura.
5. **n8n modificado funcionalmente** (PUT 200, verificado en fresco): 2 tools **`crm_action_prepare`** /
   **`crm_action_confirm`** conectadas al CRM Agent (ai_tool) llamando a `/api/agent/action`, + bloque
   **[P65 ACTION CONTROL PLANE]** en el prompt (nunca ejecutar sin preview+confirmación explícita; no
   cambiar entidad/campos tras preview; conflicto → parar; duplicate → no presentar como nueva escritura;
   nada de Facturación). 15 tools de lectura intactas. Backup previo en temp.

## E2E contra staging REAL (`scripts/p65-action-e2e.mjs`)
Fixture QA aislado (tarea QA creada y completada; nada de datos de negocio):
prepare→confirm→**verify_ok** · doble confirm **idempotente** · complete con optimistic lock · cancel
(y confirm posterior rechazado 409) · seguridad: sin secret **401** · campo no permitido **403
ACTION_FIELD_DENIED** · facturación **422 ACTION_UNKNOWN** · token basura/lectura **403** · workspace
cruzado **403 ACTION_WORKSPACE_MISMATCH**. El primer run cazó un bug real: `tasks.status` CHECK
('pending','done') — la acción usaba 'completed' → corregido a 'done' (el read-after-write funcionó como
debía: nunca se declaró éxito).

## Validación
Eval `assistant-action-security` (token/firma/expiración/separación lectura-escritura/previewHash/
invariantes) → **37 suites TODO VERDE** · tsc/lint/build ✅ · **strict 7/7 en vivo** ✅ ·
marcador `2026-07-10.p65` desplegado y verificado · 0 secretos.

## Límites declarados (NO implementado en este slice)
- **Wiring del chat**: la detección de intención de acción en la conversación local ("cambia el precio de
  X a Y" → prepare → "sí, confirma" → confirm) NO está cableada en `local-answers`; hoy el plano es usable
  por n8n (el agente tiene las 2 tools + reglas [P65]) y por API. Es el siguiente paso natural.
- **Automatizaciones opt-in** (brief diario, watches): no implementadas (requieren scheduler + tablas de
  reglas/findings). No se simulan.
- **Playwright UI E2E**: BLOCKED — TEST_SESSION_MISSING.
- Acciones adicionales (calendar/cases/operations/status de inmueble): mismas garantías, pendientes de
  ampliar el registro (algunas requieren decisión funcional — transiciones de estado, efectos en Operaciones).

## Operador (2 min)
1. `node scripts/p65-action-e2e.mjs` → 10/10 PASS contra staging.
2. En el chat: pedir al agente «prepara un cambio de precio de San Pedro 66 a 280.000» → debe mostrar
   preview y esperar confirmación (tools n8n nuevas); «sí, confirma» → ejecuta y verifica.

---
**P65 — CONTROL PLANE DE ACCIONES OPERATIVO EN STAGING: 0 fallos conocidos dentro de la matriz validada
(ciclo prepare→confirm→execute→verify, idempotencia, optimistic-lock/conflicto, cancelación, 6 vectores de
seguridad rechazados, n8n con 2 tools de acción conectadas y prompt [P65]). Límites declarados: wiring de
chat local, automatizaciones y UI E2E.**
