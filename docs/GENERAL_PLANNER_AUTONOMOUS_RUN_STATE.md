# General Planner — Autonomous Run State

> Actualizado por la sesión autónoma del 2026-07-20. Fuente de verdad para recuperación tras reset.
> Regla: este fichero refleja SOLO estado verificado contra disco/Git/ejecución real, nunca memoria de chat.

## Estado Git (verificado 2026-07-20)

- Rama actual: `general-semantic-planner`
- HEAD al inicio de la sesión: `8d46dd1` (= `origin/general-semantic-planner`; todo pusheado)
- `origin/main` = `main` = `ad3c06e` (tag `v1.0.0-rc1`) — INTACTA
- Tags intactos: `demo-v1`, `p70-before-p71-553ed64`, `p71-rc-before-final-freeze`, `v1.0.0-rc1`
- Árbol al inicio: limpio; sin merge/rebase a medias, sin worktrees extra, sin untracked

## Fase completada (esta sesión)

1. **FASE 0-1 · Recuperación forense + verificación de commits** — `8f5ffcb`, `3c7baf3`, `8d46dd1`
   verificados contra sus diffs reales: crm.query cableado (ontology+schema+executor+query layer),
   diag expone `generalSemanticPlanner` ([src/app/api/agent/diag/route.ts:52](../src/app/api/agent/diag/route.ts)),
   runbook staging existe. Los mensajes de commit son fieles al contenido.
2. **FASE 3 · Auditoría de route** — `src/app/api/assistant/v2/route.ts`: OFF = una lectura de env,
   cero cambio de comportamiento; SHADOW = P71 responde, planner observa (sin doble respuesta, sin
   escritura, atribución `shadow_planner:arch=GENERAL_PLANNER`); ON = planner responde con fail-soft a
   P71, atribución `assistantArchitecture=GENERAL_PLANNER` + `featureFlagState`. Flag inválido → off
   (verificado por `planner-shadow-compare.mts`: «basura → off»).
3. **Regresiones (ejecutadas de verdad, 2026-07-20)**:
   - `planner-security-matrix.mts` → **11/11** (post-fix re-run también 11/11)
   - `planner-query-layer.mts` → **11/11 seguridad + 7/7 generalización** (post-fix re-run igual)
   - `planner-new-mechanisms.mts` → **9/9**
   - `planner-coherence.mts` → **5/7 inicial → 7/7 tras fixes** (ver defectos abajo)
   - `planner-crm-query.mts` → **7/8** (P2 conocido intacto: relation+agg de entidad nombrada → clients.search)
   - `planner-e2e-smoke.mts` → todos los comportamientos correctos + dry-run sin mutación ✓
   - `planner-metamorphic.mts` → 22/24 (92%; grupo «detalle de cliente» 3/5, clase detail-vs-search, varianza LLM)
   - `planner-shadow-compare.mts` → flag default off ✓, mapping shadow/on/basura ✓, atribución ✓
   - `tsc --noEmit` limpio; eslint planner 0 errores (1 warning preexistente `_mode`)

## Defectos encontrados y ARREGLADOS (mecanismo general, no parche de frase)

1. **Fuga de UUIDs al prompt del planner** (causa raíz del 5/7 de coherencia). `advanceDiscourse`
   guarda `id` en `activeEntities`/`lastListed` (correcto, server-side) pero el pipeline pasaba el
   RichDiscourse entero a `planTurn` → `JSON.stringify` metía UUIDs en el prompt → el modelo copiaba
   el UUID a `entityRef` → el contrato lo rechazaba (`model_supplied_uuid`) → turno perdido.
   **Fix**: `plannerView()` en `discourse-state.ts` — proyección sin ids (solo labels/tipos) para el
   prompt; los ids siguen server-side para ordinales/pronombres. Repro 3/3 verde tras fix.
2. **Filtrado silencioso de capabilities desconocidas** en `planTurn` (semantic-planner.ts) — duplicaba
   la validación de `validatePlan` pero SIN traza (rejected no lo veía) y sin segunda oportunidad.
   **Fix**: la validación vive en UN sitio (plan-contract). + **replan semántico acotado** (máx. 1
   llamada extra) en `planner-pipeline.ts`: si el modelo quiso actuar y TODOS los goals cayeron en
   validación, se replanifica una vez con el motivo estructurado. Observabilidad: `planAttempts`.
3. **Ids canónicos de módulo rechazados** por `explain.module`: el planner emite `module: "operations"`
   (id canónico que ve en la ontología) pero `resolveModuleFromText` solo matchea aliases naturales →
   INVALID_INPUT y el synthesizer rellenaba genérico (sin grounding). **Fix** en `capability-executor.ts`:
   id canónico exacto primero, alias después; + normalización intra-plan (si falta filters.module se usa
   `proposedStateUpdates.activeModule` del MISMO plan). E2E ahora SUCCESS con explicación real del catálogo.

## Defectos abiertos (honesto)

- **P2 (conocido, sin cambio)**: `crm-query.mts` 7/8 — «suma del valor de las operaciones de <cliente>»
  cae en `clients.search` en vez de `crm.query` relation+aggregate. Clase: LIMITACIÓN DE MODELO
  (tool-selection composicional de gpt-4.1-mini). Palanca correcta: benchmark duro de modelos (FASE 45-48),
  no parche de frase. NO corregido a propósito.
- **P3**: grupo metamórfico «detalle de cliente» 3/5 (parafraseos detail vs search). Misma clase.
- **P3**: synthesizer puede rellenar contenido genérico cuando un goal explain falla (observado antes del
  fix 3; mitigado porque ahora el goal no falla). Auditoría de synthesizer grounding pendiente de suite dedicada.

## Gates de infraestructura BLOQUEADOS (requieren al usuario)

- Deploy a staging: EasyPanel 3/3 servicios ocupados → estrategia aprobada = reutilizar
  `crm-inmobiliario-crm-staging` cambiando SOLO branch + `GENERAL_SEMANTIC_PLANNER=SHADOW`.
  Runbook: [GENERAL_PLANNER_STAGING_REUSE_RUNBOOK.md](GENERAL_PLANNER_STAGING_REUSE_RUNBOOK.md).
  El usuario NO ha hecho aún el cambio de branch en EasyPanel.
- SHADOW/ON en vivo, black-box staging, validación humana: dependen del deploy anterior.

## Bloque 2 de la sesión (completado; commits `3a5b9d2`…`a134fe0`, todos pusheados)

- FASE 35 hecha: `verify-general-planner-deploy.mjs` probado REAL contra staging vivo (sigue V1/P71 ✓).
- FASES 4/5 hechas: PROTOCOL_FAST_PATHS + ANTI_OVERFIT_AUDIT (0 overfit en código nuevo).
- **Mecanismo nuevo — valores canónicos de filtro** (registry-driven): descubierto por el harness
  human-like («clientes activos» → EMPTY falso). Ontología declara valores (CLIENT_STATUSES, stages,
  PORTFOLIO_STATUSES, prioridades, tipos de cita, estados de trámite) + meta-valores open/closed
  interpretados server-side. Suite `planner-filter-values.mts` 4/4.
- **FASE 41 (pieza P, antes MISSING)**: `planner-humanlike.mts` — simulador de usuario LLM con 4
  personas + juez doble (estructural + LLM separado). Run acotado N=4: coherencia 4.5/5, grounding
  4.8/5, continuidad 4.5/5, 0 errores duros. Resultados en GENERAL_PLANNER_HUMANLIKE_RESULTS.md.
- Regresión post-cambio de ontología: mecanismos 9/9, coherence 7/7, crm-query 7/8 (P2 igual),
  security 11/11, filter-values 4/4, tsc limpio, eslint 0 errores, next build OK.

## Bloque 3 — intento de verificación del deploy SHADOW (2026-07-20, tras aviso del usuario)

El usuario reportó staging desplegado (branch `general-semantic-planner` + `GENERAL_SEMANTIC_PLANNER=SHADOW`).
**VERIFICACIÓN REAL: FALLÓ.** `GET /api/agent/diag` en
`crm-inmobiliario-crm-staging.hvdnby.easypanel.host` siguió devolviendo `toolVersion=2026-07-17.p71-rc`
**sin** el campo `generalSemanticPlanner` durante ≥10 min de polling (10 intentos, 60s). El marcador está
compilado en la route: si la rama se hubiera desplegado, el campo existiría AUNQUE faltara la env var
(saldría "off"). Conclusión: el contenedor que sirve es el build VIEJO (V1/P71) — branch no guardada,
deploy no lanzado, o build fallido en EasyPanel. NO se ejecutó ningún gate SHADOW contra ese backend
(prohibido atribuir P71 al planner). Producción intacta verificada: `origin/main`=`ad3c06e` (tag
`v1.0.0-rc1`); el único servicio CRM conocido es el staging; los otros 2 servicios EasyPanel son n8n.

Preparado mientras tanto:
- `scripts/planner-shadow-live.mts` — batería determinista black-box vs staging (sesión QA real via
  cookie SSR): `capture <label>` guarda `docs/shadow-live/<label>.json`; `compare a b` exige paridad
  estructural (debugSource/mode/toolCalls/errorCode) y 0 fugas del planner al usuario. Plan: capturar
  `baseline-p71` ANTES del redeploy y `shadow` DESPUÉS → prueba de que SHADOW no altera lo visible.
- `scripts/planner-model-hard-benchmark.mts` — FASE 46, 12 casos difíciles (P2×3, 3-goals, retorno de
  referente, corrección, top-N, ambigüedad financiera, no-overuse, valores canónicos, avg→crm.query).

## Próxima acción segura exacta

1. Si el usuario hizo el cambio EasyPanel → verificar `--expect shadow` y correr SHADOW real (runbook §3).
2. Escalar human-like (decisión de coste ~120 conv) con JUDGE_MODEL distinto del planner.
3. Hard model benchmark (FASE 46) con los casos discriminantes tipo P2 (relation+agg sobre entidad nombrada).
4. Consistency-checker a nivel de CONVERSACIÓN (P3 observado: tareas SUCCESS→EMPTY entre turnos por
   scope temporal distinto en planes sucesivos).
