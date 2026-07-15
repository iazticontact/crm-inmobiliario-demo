# P70 — Rollback Runbook

Palancas de reversión ordenadas de MENOS a MÁS drástica. Todas son reversibles y ninguna borra datos ni
audit trail. Objetivo: poder degradar cualquier capa de P70 sin tumbar el resto del CRM.

## 0. Diagnóstico rápido
```
node scripts/p70-health-check.mjs          # staging vivo, n8n activo, datos sanos
node scripts/p70-deploy-drift-check.mjs    # ¿el deploy va por detrás del código?
node scripts/n8n-p70-drift-check.mjs       # ¿drift en el workflow n8n?
```

## 1. UI agéntica → fallback textual (sin deploy)
Las cards consumen `metadata.ui` validado; si el bloque es inválido, `validateAssistantUi` devuelve
`null` y el chat pinta SOLO el texto (`answer`). Para forzar el fallback global de las cards sin tocar el
backend: dejar de emitir `ui` (ver §3) — el texto sigue siendo respuesta completa y verificable.

## 2. Deshabilitar acciones nuevas (catálogo multimódulo)
- **Quirúrgico**: retirar una acción del registro `src/lib/agents/action-registry.ts` (quitar su entrada
  de `ASSISTANT_ACTIONS`) → el plano responde `ACTION_UNKNOWN` y el parser deja de prepararla.
- **Total**: sin `AGENT_TOOL_SECRET` en el entorno, TODO el plano de acciones queda deshabilitado
  (`endpoint_disabled` 503); el asistente sigue respondiendo lecturas. Reversible: reponer el secreto.

## 3. Pausar el scheduler y las automatizaciones
- **Pausar el cron**: desactivar el nodo `Automation Scheduler` / `Run Due Automations` en n8n (o su
  workflow). El plano `/api/agent/automation` sigue disponible para gestión manual; no se ejecuta nada
  automático.
- **Pausar reglas concretas** (sin deploy, reversible): `set_rule_enabled enabled:false` por regla (chat
  «pausa …» o API). Una regla pausada NUNCA ejecuta y conserva su historial; reactivar recalcula
  `next_run_at`.
- **Cortar la emisión de findings del scheduler**: `run_due` sin reglas activas no crea nada.

## 4. Restaurar el workflow n8n a un estado bueno conocido
Cada `n8n-p70-patch.mjs` guarda un backup fuera del repo antes de tocar nada
(`CRM_AGENT_V2_BACKUP_BEFORE_P70_*.json` en el tmp del SO). Para revertir: PUT del backup vía API n8n
(o importar el JSON en la UI de n8n). Verificar con `node scripts/n8n-p70-verify.mjs`. El contrato
previo (P51/P66/P67/P68) queda intacto; las 10 tools P70 son aditivas.

## 5. Rollback del deploy (código)
- El deploy de staging sigue `main` (auto-deploy). Para volver a una fase anterior:
  `git revert <commit>` de la wave a revertir y push (preferible a reset en una rama compartida), o
  re-desplegar un commit anterior (`3f3df5d` Wave E, `022ec6c` Wave F, etc.) desde EasyPanel.
- Verificar tras el rollback: `node scripts/p70-deploy-drift-check.mjs` (toolVersion esperado) +
  `node scripts/p70-health-check.mjs`.

## 6. Compatibilidad de migraciones (todas ADITIVAS, seguras de dejar puestas)
Ninguna migración P70 hace falta revertir para bajar de versión de código — son aditivas y no rompen
el código anterior:
- `20260714_p70_grant_authenticated_assistant_agentic_tables.sql` — GRANT SELECT (idempotente; **NO
  revertir**: quitarlo reintroduce el bug de Wave B).
- `20260714_p70_wave_d_automation_types_and_skipped.sql` — amplía CHECK de tipos (3→11) y añade status
  `skipped`. El código P68 previo solo usaba 3 tipos; el CHECK ampliado los admite igual. Revertirlo solo
  haría falta si se re-despliega código que RECHACE los tipos nuevos (no es el caso).
Las tablas del asistente (`assistant_actions/findings/automation_rules/automation_runs/messages`)
existían desde fases previas; P70 no las altera de forma incompatible.

## 7. Verificación post-rollback (checklist)
```
node scripts/p70-health-check.mjs            # verde
node scripts/p70-deploy-drift-check.mjs      # sin drift
node scripts/n8n-p70-verify.mjs              # workflow coherente (o el backup restaurado)
npx tsx --tsconfig tsconfig.json scripts/p66-chat-action-e2e.mts   # lecturas+acciones básicas
node scripts/p70-grants-check.mjs            # grants RLS efectivos
```
Datos: los scripts de maintenance (§0) confirman que no quedan prepared caducadas ni runs atascados.
