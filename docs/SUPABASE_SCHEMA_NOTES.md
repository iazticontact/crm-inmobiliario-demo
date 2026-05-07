# Supabase Schema Notes

Estas notas documentan las columnas que el codigo espera para la fase real actual. Si tu schema difiere, ajusta helpers o anade columnas equivalentes.

## `invoices`

Columnas usadas:

- `id`
- `workspace_id`
- `client_name`
- `amount`
- `status`
- `date`
- `due_date`
- `plan`
- `notes`
- `created_at`

Estados normalizados: `paid`, `pending`, `overdue`.

## `calendar_events`

Columnas usadas:

- `id`
- `workspace_id`
- `title`
- `date`
- `start_hour`
- `start_minute`
- `duration`
- `type`
- `client_name`
- `description`
- `created_at`

Tipos normalizados: `call`, `meeting`, `demo`, `follow-up`.

## `conversations`

Columnas usadas:

- `id`
- `workspace_id`
- `client_id`
- `client_name`
- `client_avatar`
- `last_message`
- `unread`
- `sentiment`
- `channel`
- `intent`
- `status`
- `created_at`
- `updated_at`

## `messages`

Columnas usadas:

- `id`
- `conversation_id`
- `content`
- `sender`
- `role`
- `created_at`

El helper inserta `sender` y `role` para tolerar ambos estilos. Si tu tabla solo tiene `sender`, el fallback elimina `role`. Si solo tiene `role`, ajusta el helper para eliminar `sender`.

## `activities`

Columnas usadas:

- `id`
- `workspace_id`
- `type`
- `description`
- `client_name`
- `created_at`

Tipos normalizados: `deal`, `message`, `email`, `call`, `note`.

## `n8n_flows`

Columnas usadas:

- `id`
- `workspace_id`
- `event`
- `label`
- `description`
- `trigger`
- `webhook_url`
- `status`
- `requires`
- `created_at`
- `updated_at`

Estados normalizados: `active`, `inactive`, `demo`, `pending_config`, `error`.

Columnas opcionales recomendadas para logs ligeros:

- `last_test_at`
- `last_status`
- `last_error`
- `last_response jsonb`

## `integrations`

Columnas usadas:

- `id`
- `workspace_id`
- `key`
- `name`
- `description`
- `status`
- `category`
- `info`
- `created_at`

Estados normalizados: `connected`, `demo_connected`, `demo_ready`, `disconnected`, `pending`, `pending_config`, `error`.

## `n8n_trigger_logs` opcional

No es necesaria para la demo actual. Se recomienda si se quiere auditoria avanzada de ejecuciones n8n.

Ver `docs/supabase-optional-migrations.sql`.

## Pendiente recomendado

- Generar tipos oficiales de Supabase.
- Revisar RLS por `workspace_id`.
- Crear seeds por workspace para `n8n_flows`.
- Definir relaciones `client_id` en invoices/events/conversations si se quiere trazabilidad completa.
- Para Agent Tools reales desde n8n, configurar `SUPABASE_SERVICE_ROLE_KEY` solo en servidor y proteger con `AGENT_TOOL_SECRET` o `N8N_WEBHOOK_SECRET`.

Comando recomendado cuando Supabase CLI este disponible:

```bash
npx supabase gen types typescript --project-id TU_PROJECT_ID --schema public > src/lib/database.types.ts
```
