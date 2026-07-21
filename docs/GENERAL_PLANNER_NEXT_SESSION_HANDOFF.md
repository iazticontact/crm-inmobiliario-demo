# General Planner — Handoff para la PRÓXIMA sesión

## ESTADO 2026-07-20 (4ª sesión — HEAD ÚNICO PRE-ON LISTO) — ESTA SECCIÓN MANDA

**El HEAD actual es el candidato único pre-ON.** Contiene: FASE 9 (sin fallback silencioso), pivote
crm.query, valores/tokens canónicos, y FASE 53 (acumulación de slots de acción — el P2 top del
human-like). FASE 53 VERIFICADO por el harness dirigido `planner-action-slots.mts` → **10/10 con LLM
real (gpt-4.1-mini), 0 escrituras (dry-run)**.

> NOTA DE CONTINUIDAD (Opus, 2026-07-21): la FASE 53 la dejó Fable SIN COMMITEAR (sesión cortada por
> créditos). Opus la ha recuperado y re-verificado sobre disco antes de commitear: `tsc --noEmit`
> limpio · eslint 4 ficheros 0 errores · slot-accumulation 10/10 (LLM real) · matriz de seguridad
> 11/11 · query layer 11/11 + 10/10 (invariante de scope verde) · coherencia 7/7. La cifra human-like
> **4.9/4.9/5.0 NO está respaldada** por ningún resultado en disco: la última medición human-like real
> es la de la 3ª sesión (N=8) = **4.3/4.4/4.5, 0 errores duros** (pre-FASE-53). Una re-medición
> human-like completa post-FASE-53 queda como gate honesto, NO ejecutada aún.

**ACCIÓN DEL USUARIO (un solo paso): REDEPLOY fresco del staging** (mismo servicio, mismo branch
`general-semantic-planner`, mismo `GENERAL_SEMANTIC_PLANNER=SHADOW`; opcional recomendado:
añadir `PLANNER_FALLBACK_MODEL=gpt-4.1`). Después:
1. `node scripts/verify-general-planner-deploy.mjs --url https://crm-inmobiliario-crm-staging.hvdnby.easypanel.host --expect shadow`
2. `npx tsx --tsconfig tsconfig.json scripts/planner-shadow-live.mts capture shadow-3` + compare con
   `docs/shadow-live/baseline-p71.json` (paridad + 0 fugas, como en la 3ª sesión).
3. Si paridad OK → gate ON (usuario: env a ON + Deploy) → `--expect on` → black-box ON con atribución.

## ESTADO 2026-07-20 (3ª sesión — SHADOW LIVE conseguido)

- Staging REAL en SHADOW verificado (diag `generalSemanticPlanner: "shadow"`); paridad black-box 30
  turnos OK, 0 fugas. Ver `GENERAL_PLANNER_SHADOW_LIVE_RESULTS.md`.
- FASE 9 cerrada (9/9) · P2 de composición resuelto por mecanismo (pivote, query layer 11/11+10/10) ·
  hard benchmark: gpt-5.1 11/12 vs mini 9/12 (candidato upgrade; gate 150+ pendiente) ·
  human-like N=8: 4.3/4.4/4.5, 0 duros.
- **SECUENCIA PARA ON (en orden, NO saltarse el 1)**:
  1. Pedir al usuario REDEPLOY del staging (mismo branch; el build vivo NO tiene FASE 9 ni pivote) y
     verificar: `node scripts/verify-general-planner-deploy.mjs --url https://crm-inmobiliario-crm-staging.hvdnby.easypanel.host --expect shadow`
     (+ opcional env `PLANNER_FALLBACK_MODEL=gpt-4.1` para resiliencia FASE 9).
  2. Re-capturar paridad SHADOW post-redeploy (`planner-shadow-live.mts capture shadow-3` + compare).
  3. Solo entonces: usuario cambia `GENERAL_SEMANTIC_PLANNER=ON` + Deploy → verificar `--expect on` →
     black-box ON con atribución (`assistantArchitecture=GENERAL_PLANNER` en cada turno contado).
- **P2 top NUEVO (diseño listo, sin implementar)**: acumulación de slots de acción entre turnos —
  `pendingAction` debe persistir {actionType, entidad resuelta, slots acumulados} y fusionarse en el
  siguiente turno de acción compatible. Tocarlo SOLO con la batería FASE 25 de acciones al lado.
  Evidencia: humanlike run 3, persona spanglish (calendar.create PARTIAL ×5 turnos).
- Gates de escala abiertos (coste): generative 300+300, human-like 120+, model benchmark 150+.

> Escrito 2026-07-20 al final de la sesión autónoma. Basado en el estado REAL final (verifica con Git,
> no con memoria de chat). Instrucción de recuperación ejecutable.

## Estado final REAL

- Rama `general-semantic-planner`; ver HEAD con `git log --oneline -5` (esta sesión añadió commits sobre
  `8d46dd1`: fixes de mecanismo + verificador de deploy + docs). Todo pusheado si `git status -sb` no
  marca ahead; si marca ahead, `git push` es seguro (la rama es solo nuestra).
- `main` = `ad3c06e` (V1, tag `v1.0.0-rc1`) — INTACTA. Producción y staging NO tocados.
- Staging vivo verificado 2026-07-20: sigue V1/P71 (`node scripts/verify-general-planner-deploy.mjs
  --url https://crm-inmobiliario-crm-staging.hvdnby.easypanel.host --expect absent`).

## Qué se hizo (resumen; detalle en GENERAL_PLANNER_AUTONOMOUS_RUN_STATE.md)

1. Recuperación forense + verificación de commits reportados (fieles).
2. Regresiones ejecutadas de verdad; coherence detectó 5/7 → causa raíz encontrada y ARREGLADA
   (UUIDs filtrándose al prompt del planner) → 7/7.
3. Tres fixes de mecanismo general (plannerView sin ids, replan semántico acotado + fin del filtrado
   silencioso, ids canónicos de módulo en explain.module).
4. FASE 35: `scripts/verify-general-planner-deploy.mjs` (probado contra staging vivo).
5. FASES 4/5: docs PROTOCOL_FAST_PATHS + ANTI_OVERFIT_AUDIT; IMPLEMENTATION_STATUS refrescado.

## ESTADO 2026-07-20 (2ª sesión, tras aviso de deploy del usuario)

- El usuario reportó staging desplegado (branch + SHADOW). **La verificación real FALLÓ**: el diag siguió
  siendo V1/P71 (`toolVersion=2026-07-17.p71-rc`, sin `generalSemanticPlanner`) durante ≥10 min de polling.
  El contenedor servido es el build viejo → en EasyPanel: revisar que la Branch quedó GUARDADA, que se pulsó
  Deploy, y el log de build (si falló, rebuild sin caché). NADA de SHADOW se ejecutó contra ese backend.
- Producción intacta: `origin/main=ad3c06e` + tag; QA fixtures prístinos (9/8/8, 0 pending actions).
- Preparado y PENDIENTE DE COMMIT (la sesión acabó con el clasificador de permisos caído — sin shell):
  `scripts/planner-shadow-live.mts` (batería black-box con sesión QA real; capture/compare),
  `scripts/planner-model-hard-benchmark.mts` (FASE 46, 12 casos difíciles), y updates de docs.
- SECUENCIA AL RECUPERAR SHELL:
  1. `npx tsc --noEmit` (valida los 2 scripts nuevos).
  2. `npx tsx --tsconfig tsconfig.json scripts/planner-shadow-live.mts capture baseline-p71`
     (captura la línea base P71 MIENTRAS staging siga sirviendo V1 — si ya cambió al branch, capturar
     igualmente con label `shadow` y comparar contra una baseline local de la misma batería).
  3. `node scripts/verify-general-planner-deploy.mjs --url https://crm-inmobiliario-crm-staging.hvdnby.easypanel.host --expect shadow`
     → si OK: `planner-shadow-live.mts capture shadow` + `compare docs/shadow-live/baseline-p71.json docs/shadow-live/shadow.json`
     (gate: paridad estructural 10/10 y 0 fugas del planner al usuario).
  4. `npx tsx --tsconfig tsconfig.json scripts/planner-model-hard-benchmark.mts` (FASE 46 acotada).
  5. git add/commit/push de scripts + docs + resultados.
- **NO activar ON** hasta que SHADOW pase los gates (orden explícita del usuario).

## Próxima acción EXACTA (en orden)

1. **Si el usuario ya tocó EasyPanel** (branch → `general-semantic-planner`, env
   `GENERAL_SEMANTIC_PLANNER=SHADOW`, Deploy):
   `node scripts/verify-general-planner-deploy.mjs --url https://crm-inmobiliario-crm-staging.hvdnby.easypanel.host --expect shadow`
   → si OK, ejecutar SHADOW real (conversaciones nuevas) y revisar logs `shadow_planner:*`. Runbook §3.
2. **Si no**, seguir con fases locales pendientes por coste/tamaño:
   - Human-like harness YA EXISTE (`planner-humanlike.mts`, run N=4: 4.5/4.8/4.5, 0 errores duros).
     Siguiente paso: escalar hacia 120+ (decisión de coste, ~2.200 llamadas mini) con JUDGE_MODEL
     distinto del planner.
   - Hard model benchmark (FASE 46): ampliar `planner-model-benchmark.mts` a casos multi-turno difíciles;
     el P2 de crm-query (relation+agg entidad nombrada → clients.search) es EXACTAMENTE el tipo de caso
     discriminante que debe decidir si se sube de gpt-4.1-mini.
   - Generative eval a más N (coste acotado, registrar N real).
   - Consistency-checker a nivel de conversación (P3: misma petición SUCCESS→EMPTY entre turnos por
     scope temporal distinto en planes sucesivos).
3. NO tocar: main, producción, staging (sin permiso), n8n, secrets, tag V1.

## Defectos abiertos

- P2 (modelo): crm-query 7/8 — no parchear con frases; palanca = benchmark de modelos.
- P3: metamórfico grupo «detalle de cliente» 3/5 (misma clase).
- P3: auditoría dedicada de grounding del synthesizer ante goals fallidos (FASE 29) sin suite propia.
