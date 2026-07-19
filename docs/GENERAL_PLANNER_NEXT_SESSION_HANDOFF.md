# General Planner — Handoff para la PRÓXIMA sesión

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
