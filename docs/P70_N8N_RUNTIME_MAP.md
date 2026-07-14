# P70 — N8N Runtime Map (Wave E)

Workflow vivo: **[CRM Inmobiliario] Agent V2 — Read Only** · id `6mps8YoWu3syldUc` · **41 nodos** tras
el patch P70 (31 previos + 10 tools) · active=true. Fuente: `node scripts/n8n-p70-inspect.mjs`
(backup automático fuera de Git en cada inspección/patch). Hash registrado en
`docs/P70_N8N_WORKFLOW_HASH.txt`; deriva → `node scripts/n8n-p70-drift-check.mjs` en rojo.

## Ruta HTTP (chat)

| Nodo | Tipo | Función | Upstream → Downstream | Estado |
|---|---|---|---|---|
| Webhook In | webhook | entrada del CRM (`/webhook/crm-agent-v2`) | — → Check secret | LIVE (tráfico real) |
| Check secret | if | gate `x-nowcrm-agent-secret`; sin secreto → rama Unauthorized | Webhook In → Normalize input / Respond Unauthorized | LIVE (error path verificado en chaos) |
| Normalize input | set | normaliza payload; expone `workspaceId` (fuente ÚNICA de workspace para TODAS las tools) y `turnPolicyToken` (P51) | Check secret → CRM Agent | LIVE |
| CRM Agent | lc.agent | agente; prompt con markers [P64][P65][P66][P67][P68]**[P70 FINAL RELEASE CANDIDATE]** | Normalize input → Build Response | LIVE |
| OpenAI Chat Model | lc.lmChatOpenAi | modelo LLM del agente | ai_languageModel → CRM Agent | LIVE |
| Window Memory | lc.memoryBufferWindow | memoria por `threadId` | ai_memory → CRM Agent | LIVE |
| Build Response | code | respuesta estructurada (reply, usedTools, limitations) | CRM Agent → Respond to Webhook | LIVE |
| Respond to Webhook | respondToWebhook | 200 con JSON | Build Response → — | LIVE |
| Respond Unauthorized | respondToWebhook | rechazo sin agente | Check secret (rama falsa) → — | LIVE (error path) |

## Ruta CRON (scheduler P68/D)

| Nodo | Función | Estado |
|---|---|---|
| Automation Scheduler | scheduleTrigger (cron) | LIVE |
| Run Due Automations | httpRequest → `POST /api/agent/automation {operation:'run_due'}` con `x-nowcrm-secret` | LIVE (claim atómico y catch-up viven en el CRM, no aquí) |

## Tools del agente (30 · todas ai_tool → CRM Agent)

**Lectura (15, P51: header `x-nowcrm-turn-policy` verificado en las 15)** — `/api/agent/tool`:
search_clients, get_client_360, get_crm_overview, get_pending_tasks, get_calendar_summary,
get_open_operations, get_recent_activity, get_documents_metadata, get_latest_client,
get_client_opportunities, get_client_service_cases, get_open_service_cases, pipeline_summary,
search_properties, crm_read_query.

**Acciones (4, P66)** — `/api/agent/action` con `x-nowcrm-secret`: crm_action_prepare,
crm_action_confirm, crm_action_cancel, crm_action_status. **Findings check (1, P67)**:
crm_findings_check (`run_data_quality`).

**P70 (10, `/api/agent/automation` con `x-nowcrm-secret`; workspace SIEMPRE de Normalize input):**

| Tool | Operación | Nota |
|---|---|---|
| crm_automation_list | list_rules | |
| crm_automation_update | prepare_update_rule / confirm_update_rule | BIFÁSICA: preview+hash primero; `confirmed:true` solo tras confirmación explícita del usuario |
| crm_automation_enable | set_rule_enabled true | recalcula next_run_at |
| crm_automation_disable | set_rule_enabled false | reversible |
| crm_automation_run | run_rule_now | idempotente por minuto; pausada → 409 |
| crm_automation_last_run | list_runs (limit 1) | |
| crm_findings_list | list_findings | |
| crm_finding_acknowledge | acknowledge_finding | open → acknowledged |
| crm_finding_resolve | resolve_finding | petición explícita |
| crm_finding_dismiss | dismiss_finding | no reaparece sin cambio material |

## Nodos muertos / redundantes / legacy

Auditados los 31 nodos previos con conexiones y tráfico: **ninguno muerto ni redundante** — todos
están en la ruta HTTP, en la ruta cron o conectados como ai_tool/ai_memory/ai_languageModel al agente.
No se eliminó nada (no había evidencia para hacerlo).

## Prohibiciones vigentes (verificadas por n8n-p70-verify)

Sin HTTP genérico nuevo, sin SQL, sin tabla/campo/workspace libres (workspace fijado por Normalize
input), sin tools de facturación. El bloque [P70 FINAL RELEASE CANDIDATE] impone: contrato local manda,
prepare nunca ejecuta, éxito solo con evidencia (verify / run record), findings con hechos + criterio,
verdad temporal, higiene de salida (sin UUIDs/tokens/stacks/JSON/**), y empty/error/partial separados.

## Operativa

1. `node scripts/n8n-p70-inspect.mjs` — mapa + ejecuciones recientes + backup.
2. `node scripts/n8n-p70-patch.mjs [--apply]` — cambios SOLO por patch idempotente con dry-run.
3. `node scripts/n8n-p70-verify.mjs [--write-hash]` — 25+ checks; registra hash bueno conocido.
4. `node scripts/n8n-p70-drift-check.mjs` — vivo vs hash commiteado.
5. `node scripts/n8n-p70-e2e.mjs` · `node scripts/n8n-p70-chaos-e2e.mjs` — canaries reales por webhook.
