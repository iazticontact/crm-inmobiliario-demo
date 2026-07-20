# SHADOW LIVE — evidencia real del gate de paridad (2026-07-20)

> Todo lo de este fichero corresponde a ejecuciones REALES contra el staging desplegado
> `crm-inmobiliario-crm-staging.hvdnby.easypanel.host`, con sesión QA autenticada (cookie SSR),
> batería determinista de 10 turnos SOLO-LECTURA. Artefactos: `docs/shadow-live/*.json`.

## Cronología verificada

1. **Baseline P71** (`baseline-p71.json`): capturada mientras el staging aún servía V1/P71
   (diag: `toolVersion=2026-07-17.p71-rc`, SIN `generalSemanticPlanner`). 10/10 HTTP 200.
2. **Flip a SHADOW verificado**: el poll de `verify-general-planner-deploy.mjs` confirmó
   `generalSemanticPlanner: "shadow"` en el diag vivo (deploy manual del usuario, 2º intento).
3. **Captura SHADOW** (`shadow.json`) y **re-captura** (`shadow-2.json`) contra el build SHADOW.

## Resultado del gate de paridad (SHADOW no altera lo visible)

| Comparación | Paridad estructural | Fugas del planner al usuario |
|---|---|---|
| baseline-p71 vs shadow | 9/10 | 0 |
| shadow vs shadow-2 (MISMO build) | 9/10 | 0 |
| baseline-p71 vs shadow-2 | 10/10 (mismo toolCall) | 0 |

La única diferencia en ambas comparaciones es el MISMO turno («comisiones este mes») y es
**varianza interna del agente n8n** (elige `crm_read_query` o `pipeline_summary` de forma no
determinista): se reproduce ENTRE dos capturas del mismo build SHADOW, y `shadow-2` coincide
exactamente con la baseline. El camino arquitectónico es idéntico en 10/10 turnos
(`debugSource`/`mode`/`errorCode`: 8 local-first + 2 n8n, sin cambios).

**VEREDICTO: PASS.** En 30 turnos reales contra staging: 0 respuestas del planner visibles al
usuario bajo SHADOW, 0 cambios de camino arquitectónico, 0 errores HTTP, 0 mutaciones (batería
solo-lectura; fixtures verificados prístinos antes: 9 clients / 8 properties / 8 opportunities /
0 pending actions).

## Limitaciones honestas

- La OBSERVACIÓN del planner en shadow se registra en logs del servidor (EasyPanel), a los que esta
  sesión no tiene acceso; lo demostrado black-box es el contrato de usuario (paridad + no fuga).
  La verificación de los logs `source=shadow_planner:arch=GENERAL_PLANNER:*` queda para el usuario
  o para una sesión con acceso a logs.
- El build SHADOW desplegado corresponde al push `bf1ca57` (o anterior); NO incluye la FASE 9
  (`f937489`, eliminación del fallback ON→P71) — irrelevante bajo SHADOW (afecta solo a ON), pero
  antes de activar ON hay que REDEPLOY para incluirla.
- La batería es de 10 turnos deterministas de lectura; no cubre acciones ni conversaciones largas
  (eso pertenece a los gates de ON).
