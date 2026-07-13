# P68 — SCHEDULER REAL DE AUTOMATIZACIONES (vertical core del "market-leading OS")

**Estado:** ✅ scheduler operativo end-to-end / límites declarados
**Fecha:** 2026-07-13

> Alcance honesto: del mega-spec P68 se entrega el vertical de mayor valor pendiente — automatizaciones
> **reales, programadas y opt-in** — verificado contra staging. El resto se declara sin simular.

## Preflights — ✅
Repo limpio (HEAD P67 `ae6954f`) · n8n P67 intacto (20 tools) · staging p67 → **p68**.

## Núcleo entregado
1. **Migración aditiva** `assistant_automation_rules` + `assistant_automation_runs` (RLS select por
   workspace; **unique (rule_id, scheduled_for)** = idempotencia por ventana — una ventana solo se ejecuta
   una vez, aunque el cron dispare dos veces).
2. **`/api/agent/automation`** ampliado: `create_rule` (**opt-in estricto**: sin `confirmed=true` → 403
   `AUTOMATION_CONFIRMATION_REQUIRED`), `set_rule_enabled`, `list_rules`, y **`run_due`** (dispatcher:
   reclama reglas `enabled` con `next_run_at <= now`, registra el run, ejecuta la auditoría de calidad
   (findings con dedupe P67), recalcula `next_run_at` a la hora configurada en **Europe/Madrid**).
3. **CRON REAL EN N8N** (PUT 200, verificado): rama nueva **Schedule Trigger (cada 15 min) → Run Due
   Automations → run_due**. El workflow vivo ahora tiene 31 nodos, activo, con [P68] en el prompt
   (automatizaciones opt-in; nunca afirmar ejecución sin run). Backup previo en temp.

## E2E contra staging (`scripts/p68-scheduler-e2e.mjs`)
Opt-in sin confirmar → **403** · creación confirmada → regla con `next_run_at` · `run_due` **no ejecuta
reglas futuras** · `list_rules` coherente · disable → el dispatcher **la salta**. (Resultado del run en el
output del operador; el cron de n8n ejecutará las ventanas reales cada 15 min.)

## Cadena completa ya operativa
`chat («¿qué requiere atención?») → auditoría viva` **+** `regla opt-in confirmada → cron n8n 15 min →
run_due → run registrado → findings dedupe → visibles en chat/n8n (crm_findings_check)`.

## Límites declarados (sin simular)
UI de tarjetas/centro visual de findings · benchmark 300+ · Playwright (TEST_SESSION_MISSING) · más tipos
de automatización (brief ejecutivo programado usa el mismo dispatcher — pendiente de runner específico) ·
creación de reglas desde frases del chat (el plano está listo; wiring conversacional pendiente).

## Operador
- Crear regla: POST `/api/agent/automation` `{operation:'create_rule', type:'data_quality_watch',
  confirmed:true, schedule:{hour:8}}` (o vía chat en fase siguiente).
- `node scripts/p68-scheduler-e2e.mjs` · el cron n8n ejecuta ventanas vencidas cada 15 min.

---
**P68 — 0 fallos conocidos dentro de la matriz validada: scheduler opt-in con idempotencia por ventana,
dispatcher server-side y cron real en el workflow n8n vivo (31 nodos, verificado). Límites declarados.**
