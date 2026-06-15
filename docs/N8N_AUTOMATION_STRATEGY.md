# n8n Automation Strategy — CRM Inmobiliario

> **Fecha:** 2026-06-15 · **HEAD:** `07b7b8a` · **Tipo:** estrategia (no se activa
> n8n en esta fase). Relacionado:
> [AI_N8N_MCP_RUNTIME_ARCHITECTURE.md](AI_N8N_MCP_RUNTIME_ARCHITECTURE.md),
> [STAGING_HOSTINGER_STRATEGY.md](STAGING_HOSTINGER_STRATEGY.md).

## 1. Principio
**n8n es el brazo de automatización externa, NO el cerebro.** El cerebro
(decisión, permisos, validación, confirmación) vive en el CRM (ver doc de
arquitectura). n8n ejecuta lo que el CRM le encarga, y trae eventos externos al
CRM por webhooks autenticados.

## 2. Para qué SÍ usar n8n
- Webhooks (entrada/salida).
- **WhatsApp Meta API** (envío y recepción).
- Email (notificaciones, propuestas, recordatorios).
- Generación/envío de **PDF** (facturas, informes).
- Recordatorios y **tareas programadas (cron)**.
- Sincronizaciones externas (Google Calendar futuro, portales inmobiliarios).
- Notificaciones (Slack/Telegram internas, etc.).
- Procesos largos/asíncronos (OCR, extracción de documentos para RAG).
- Integración con terceros.

## 3. Para qué NO usar n8n
- ❌ Sustituir RLS o decidir permisos.
- ❌ Guardar datos sin validar `workspace_id`.
- ❌ Inventar datos.
- ❌ Ejecutar acciones peligrosas sin confirmación del usuario en el CRM.
- ❌ Ser el único cerebro del asistente.
- ❌ Almacenar secretos en workflows inseguros.
- ❌ Mezclar datos de clientes/workspaces.

## 4. Contrato de seguridad CRM ↔ n8n (ya implementado)
**Salida CRM → n8n** (server-side only):
- `src/lib/assistant-n8n-hook.ts` — fire-and-forget tras un write confirmado.
  Fail-soft (nunca lanza, **nunca hace rollback** del write ya hecho), timeout 5s,
  **SSRF-guard** (host debe coincidir con `N8N_BASE_URL`; en prod rechaza
  loopback/IP privada/ULA/link-local/metadata), **slug allowlist** cerrada, body
  **whitelisteado** (workspaceId, entityId, clientId, clientName, summary — sin
  tokens ni PII), secreto `N8N_WEBHOOK_SECRET` solo a la URL validada.
- `src/app/api/n8n/trigger/route.ts` — requiere **sesión autenticada**; la URL
  destino **jamás** viene del body (ignora `webhook_url`); slug resuelto server-side
  desde allowlist; URL re-validada bajo `N8N_BASE_URL`; respuesta sanitizada (no
  echo del raw de n8n); si falta `N8N_BASE_URL` o el workspace no coincide,
  devuelve `simulated`/`skipped` (no una falsa "ok").

**Entrada n8n → CRM:** webhooks del CRM (p. ej. WhatsApp entrante) que validan
**secreto + workspace** server-side antes de escribir (existe el andamiaje en
`/api/integrations/meta/whatsapp/webhook` y `/api/inbox/whatsapp/inbound`).

> **Estado:** todo lo anterior está **implementado y dormido** (envs `N8N_*`
> vacías). Activarlo = configurar `N8N_BASE_URL`/`N8N_WEBHOOK_SECRET`/`N8N_API_KEY`
> en el `.env` del servidor + levantar n8n en el VPS. **No tocar `.env.local`
> desde aquí.**

## 5. Catálogo de workflows (slugs ya definidos en el CRM)
`/api/n8n/trigger` mapea `event_type → slug` (allowlist server-side). Workflows a
construir en n8n con esos slugs:

| event_type | slug n8n | Uso |
|---|---|---|
| `new_lead` | `new-lead` | nuevo lead → notificar/asignar |
| `client_updated` / `client_deleted` | `client-updated` / `client-deleted` | sync/auditoría |
| `whatsapp_message` | `whatsapp-message` | mensaje entrante WhatsApp |
| `assistant_message` | `assistant-message` | acción/mensaje del asistente |
| `conversation_resolved` | `conversation-resolved` | cierre de conversación |
| `appointment_booked` / `calendar_event_created` | `appointment-booked` / `calendar-event-created` | recordatorio/confirmación de cita |
| `invoice_created` / `invoice_paid` / `invoice_overdue` | `invoice-*` | email/PDF/cobros (futuro) |
| `reengagement_needed` | `reengagement-needed` | reactivar cliente inactivo |
| `daily_summary` | `daily-summary` | resumen diario (cron) |
| `urgent_conversation` | `urgent-conversation` | escalar conversación urgente |
| `test_flow` | `test-flow` | prueba de conectividad |

Y los del hook del asistente: `assistant-task-created`, `assistant-booking-created`,
`assistant-invoice-prepared`, `assistant-report-prepared`.

## 6. Workflows básicos recomendados (primeros, bajo riesgo)
1. `test-flow` — ping de conectividad CRM→n8n (validar secreto/SSL).
2. `assistant-task-created` / `appointment-booked` — notificación interna (email/Slack).
3. `daily-summary` — cron: resumen diario del workspace por email.
4. `invoice-*` / PDF — **solo cuando exista facturación** (Fase F).
5. `whatsapp-message` — **solo cuando exista WhatsApp Meta** (Fase I).

## 7. Despliegue de n8n (VPS)
- **Recomendado:** n8n **self-host en el VPS**, en **subdominio propio**
  (`n8n.tudominio.com`), detrás de Nginx + SSL, **con autenticación** (basic auth
  / usuario n8n) y **nunca expuesto sin auth**.
- ¿Mismo VPS o separado? Para **staging**, el mismo VPS que el CRM es aceptable
  (recursos modestos). Para **producción**, preferible **VPS/instancia separada**
  (aísla fallos y carga; el CRM no debe caerse si n8n se satura).
- **Backups:** exportar workflows (JSON) a Git/privado + backup de la BD de n8n;
  snapshots del VPS. Documentar credenciales fuera de Git.
- **Staging/prod separados:** instancias y `N8N_*` distintas; nunca compartir
  webhooks ni secretos entre entornos.

## 8. Secretos
- `N8N_BASE_URL`, `N8N_WEBHOOK_SECRET`, `N8N_API_KEY` solo en el `.env` del server
  del CRM. Las credenciales de las integraciones (Meta, email, etc.) viven en
  **n8n credentials**, no en el repo ni en el CRM.
- Nada de secretos en los JSON de workflows que se versionen.

## 9. Qué NO hacer ahora
- No levantar n8n productivo, no crear workflows reales, no conectar Meta/email.
- No configurar `N8N_*` en local (se mantiene dormido/simulado).
- Solo dejar definida esta estrategia + activar en la fase correspondiente
  (ver roadmap, Fases C-E).

## 10. Veredicto
Estrategia clara y **ya respaldada por código hardened** en el CRM. n8n queda como
orquestador externo seguro, activable por fases en el VPS sin tocar el cerebro.
