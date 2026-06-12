# Documentación — CRM Inmobiliario Demo

Índice de la documentación del repo y su estado. Creado en Fase 1D.

**Estados:**
- 🟢 **Vigente** — referencia técnica/contrato actual, útil tal cual.
- 🟡 **Pendiente** — informativo; contenido válido pero con marca antigua o
  detalles por actualizar.
- 🔴 **Legacy** — archivado, no vigente (ver `docs/archive/legacy/`).
- 🔒 **Protegida** — no tocar sin revisión (schema, contratos, workflows).

> Nota: el endpoint actual del asistente es **`/api/assistant/v2`**. La ruta
> legacy `/api/assistant/chat` y `src/lib/assistant-agent.ts` se eliminaron en
> Fase 1C-C.

---

## 🟢 Vigente — referencia técnica / setup

| Doc | Para qué |
|-----|----------|
| [ENVIRONMENT_VARIABLES.md](ENVIRONMENT_VARIABLES.md) | Todas las env vars y de dónde sacarlas. |
| [N8N_PAYLOAD_CONTRACT.md](N8N_PAYLOAD_CONTRACT.md) | Formato de eventos enviados a n8n (contrato). |
| [n8n-whatsapp-inbound-contract.md](n8n-whatsapp-inbound-contract.md) | Contrato de inbound WhatsApp ↔ n8n. |
| [N8N_ASSISTANT_WORKFLOWS.md](N8N_ASSISTANT_WORKFLOWS.md) | Workflows del asistente en n8n. |
| [N8N_AUTOMATIONS_SETUP.md](N8N_AUTOMATIONS_SETUP.md) · [N8N_AUTOMATION_CATALOG.md](N8N_AUTOMATION_CATALOG.md) | Setup y catálogo de automatizaciones. |
| [WHATSAPP_AGENT_ARCHITECTURE.md](WHATSAPP_AGENT_ARCHITECTURE.md) | Arquitectura del agente de WhatsApp. |
| [META_WHATSAPP_OFFICIAL_SETUP.md](META_WHATSAPP_OFFICIAL_SETUP.md) · [META_WHATSAPP_SETUP_STEP_BY_STEP.md](META_WHATSAPP_SETUP_STEP_BY_STEP.md) | Conectar WhatsApp/Meta real. |
| [GOOGLE_CALENDAR_OFFICIAL_SETUP.md](GOOGLE_CALENDAR_OFFICIAL_SETUP.md) · [GOOGLE_CALENDAR_REALTIME.md](GOOGLE_CALENDAR_REALTIME.md) | Conectar Google Calendar real / realtime. |
| [SUPABASE_SCHEMA_NOTES.md](SUPABASE_SCHEMA_NOTES.md) · [INTEGRATIONS_SCHEMA_PLAN.md](INTEGRATIONS_SCHEMA_PLAN.md) | Notas de esquema y plan de integraciones. |
| [WHATSAPP_SCHEMA_RECOMMENDED_SQL.md](WHATSAPP_SCHEMA_RECOMMENDED_SQL.md) | SQL recomendado para WhatsApp. |
| [manual-test-whatsapp-inbound.md](manual-test-whatsapp-inbound.md) | Test manual de inbound. |

---

## 🟡 Estado / plan (marca actualizada en Fase 1D)

| Doc | Nota |
|-----|------|
| [AI_AGENT_PLAN.md](AI_AGENT_PLAN.md) | Plan del Asistente IA. Endpoint actual `/api/assistant/v2`. |
| [FUNCTIONAL_AUDIT.md](FUNCTIONAL_AUDIT.md) | Auditoría funcional por módulo. |
| [N8N_PLAN.md](N8N_PLAN.md) | Plan n8n. Conserva marca `NowCRM` residual inline (pendiente). |
| [NEXT_STEPS.md](NEXT_STEPS.md) | Próximos pasos. |
| [QA_CHECKLIST.md](QA_CHECKLIST.md) | QA por fase + clone readiness. Conserva marca `NowCRM` residual inline (pendiente). |

---

## 🟡 Onboarding / demo (informativo — pendiente de actualización de marca)

| Doc | Estado |
|-----|--------|
| [CLIENT_ADAPTATION_PLAYBOOK.md](CLIENT_ADAPTATION_PLAYBOOK.md) | Pendiente |
| [CLIENT_INTEGRATIONS_ONBOARDING.md](CLIENT_INTEGRATIONS_ONBOARDING.md) | Pendiente |
| [CLIENT_TEST_FLOW.md](CLIENT_TEST_FLOW.md) | Pendiente |
| [CLIENT_VERTICAL_REAL_ESTATE_IMMIGRATION.md](CLIENT_VERTICAL_REAL_ESTATE_IMMIGRATION.md) | Pendiente |
| [GOOGLE_CALENDAR_CLIENT_ONBOARDING.md](GOOGLE_CALENDAR_CLIENT_ONBOARDING.md) | Pendiente |
| [WHATSAPP_CLIENT_ONBOARDING.md](WHATSAPP_CLIENT_ONBOARDING.md) | Pendiente |
| [DEPLOYMENT.md](DEPLOYMENT.md) | Pendiente |
| [PRODUCTION_READINESS.md](PRODUCTION_READINESS.md) | Pendiente |
| [ROADMAP_PRODUCT_PACKS.md](ROADMAP_PRODUCT_PACKS.md) | Pendiente |
| [DEMO_SCRIPT.md](DEMO_SCRIPT.md) | Pendiente (guion de demo genérico, vigente como base) |
| [DEMO_LOCKDOWN.md](DEMO_LOCKDOWN.md) | Pendiente |
| [INTERNAL_OPERATOR_CHECKLIST.md](INTERNAL_OPERATOR_CHECKLIST.md) | Pendiente |

---

## 🔒 Protegida — NO tocar sin revisión

- **`docs/supabase/`** — schema, Storage y políticas RLS (`SCHEMA_MAP.md`,
  `STORAGE.md`, `*.sql`). Incluye `costadelsol_schema_v1.sql` (esquema base
  histórico; revisar antes de renombrar/borrar).
- **`docs/n8n/`** — workflows reales y contratos
  (`whatsapp-inbound-nowcrm.workflow.json`, `workflows/CDS-*.json`).
- **SQL** a nivel `docs/` (`google-calendar-multi-calendar.sql`,
  `supabase-optional-migrations.sql`).

---

## 🔴 Legacy — archivado (`docs/archive/legacy/`)

| Doc | Motivo |
|-----|--------|
| [archive/legacy/INFRASTRUCTURE_NOWLABS.md](archive/legacy/INFRASTRUCTURE_NOWLABS.md) | Infraestructura/dominios antiguos (`*.nowlabs.es`, VPS Contabo). |
| [archive/legacy/DEMO_SCRIPT_ANDREI.md](archive/legacy/DEMO_SCRIPT_ANDREI.md) | Guion de demo personal antiguo (nombre propio). |
| [archive/legacy/VPS_MIGRATION_PLAN.md](archive/legacy/VPS_MIGRATION_PLAN.md) | Plan de migración a VPS antiguo. |

---

## Pendiente para fases futuras

- Pasada de marca residual `NowCRM` inline en `N8N_PLAN.md` y `QA_CHECKLIST.md`.
- Actualización de marca en docs de onboarding/demo (🟡 Pendiente).
- Renombrado de contratos internos (rol `nowlabs_admin`, env vars, workflow n8n
  `NowCRM - Assistant Agent`) — **Fase 2**, requiere migración coordinada.
