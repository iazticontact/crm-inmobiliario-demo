# P71 — Verificación de recuperación ante desastre (disaster recovery)

> Verificado SIN destruir producción (comprobaciones de existencia + dry-run). Fecha 2026-07-18.

## Puntos de recuperación (tags inmutables en origin)
| Tag | SHA | Runtime | Uso |
|---|---|---|---|
| `p70-before-p71-553ed64` | `553ed64` | 2026-07-15.p70-rc | rollback total a P70 |
| `p71-rc-before-final-freeze` | `a01fb66` | 2026-07-17.p71-rc | P71 validado antes del hardening |
| `demo-v1` | (histórico) | — | seed demo |
Verificado: `git ls-remote --tags origin` los muestra apuntando a los SHA exactos.

## Rollback de deploy (aplicación)
- **Procedimiento**: `git revert` del merge o `git reset --hard <tag>` en una rama de hotfix → push → EasyPanel
  auto-deploy → verificar `/api/agent/diag`. Alternativa inmediata: re-desplegar el tag `p70-before-p71` en
  EasyPanel (el SHA anterior es identificable en el historial de deploys del panel).
- **Compatibilidad de datos**: P71 **no añade migraciones de BD** (reutiliza `assistant_agent_memory` con JSON
  versionado). Por tanto un rollback de código a P70 es seguro: P70 simplemente ignora las filas
  `memory_type='conversation_state'` (TTL 24h las purga). Sin esquema que revertir.
- **ConversationState v2 fail-safe**: si el código que lee el estado cambia, `upgradeConversationState`
  degrada a vacío ante cualquier forma no reconocida (nunca rompe el turno). Verificado en unit.

## Rollback / restore de n8n
- **Backup**: cada patch guarda el workflow COMPLETO fuera del repo
  (`%TEMP%/CRM_AGENT_V2_BACKUP_BEFORE_P71_*.json`, legible). Restaurable con un PUT del JSON íntegro.
- **Reversión del bloque P71**: borrar el bloque `[P71 ADAPTIVE CONVERSATIONAL INTELLIGENCE]` del
  systemMessage y re-registrar el hash P70 `5091deae9de58a5f`. El campo `conversationState` del body es
  ignorado por el prompt P70 (inocuo) → compatibilidad hacia atrás garantizada.
- **Hash vigente**: `952900d3c8f3e6c0` (drift-check OK). Dry-run del patch (`node scripts/n8n-p71-patch.mjs`
  sin `--apply`) es idempotente: si ya está parcheado, no hace nada.

## Diques de contención operativos
- **Scheduler pausable**: cada regla se desactiva por chat/API (`set_rule_enabled false`) → `run_due` la
  omite (verificado scheduler-chaos). Se puede pausar TODO deshabilitando las reglas.
- **Acciones deshabilitables**: el plano P65 exige `AGENT_TOOL_SECRET`; sin él, ninguna acción se prepara/
  confirma (modo lectura pura). Es un interruptor de un solo valor de entorno.
- **Fallback textual**: si n8n cae, la route responde un error humano honesto (sin fallback inseguro) y
  local-first sigue sirviendo las lecturas deterministas.
- **Provider switch**: `ASSISTANT_PROVIDER` + `ALLOW_LEGACY_ASSISTANT` permiten forzar el motor (blindado).

## Simulación de rollback (dry-run, sin ejecutar destructivo)
- `git merge-base --is-ancestor 553ed64 HEAD` → true (P70 es ancestro; revert limpio posible).
- Tags resuelven a SHA correctos (ls-remote).
- Backup n8n JSON presente y parseable.
- Migraciones: `supabase/migrations` sin cambios en P71 (aditivo=n/a).
- Conclusión: **rollback reproducible y verificado** sin tocar producción.
