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
- `workspace_id`
- `conversation_id`
- `content`
- `sender`
- `role`
- `metadata`
- `created_at`

El helper inserta `workspace_id`, `sender`, `role` y `metadata` cuando existen. Si tu tabla todavia no tiene `workspace_id`, `role` o `metadata`, el fallback elimina esas columnas y mantiene la escritura basica por `conversation_id`.

Recomendacion para persistencia robusta del Assistant:

- Mantener `workspace_id` en `messages`.
- Filtrar lecturas por `conversation_id` y `workspace_id`.
- Crear indice `(workspace_id, conversation_id, created_at)`.
- RLS: permitir select/insert si el usuario pertenece al workspace.

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

## `agent_action_logs` opcional

Recomendada si se quiere auditar acciones preparadas/confirmadas por Assistant:

- `id`
- `workspace_id`
- `conversation_id`
- `tool`
- `status`
- `input jsonb`
- `result jsonb`
- `error_message`
- `created_at`

Estados recomendados: `prepared`, `confirmed`, `skipped`, `error`.

Tambien se recomiendan indices por `workspace_id` y fecha en `clients`, `invoices`, `calendar_events`, `n8n_trigger_logs` y `agent_action_logs`.

## Supabase Storage recomendado

Buckets recomendados para la siguiente fase:

- `client-files`: documentos asociados a clientes.
- `invoice-pdfs`: PDFs de facturas generadas.
- `proposal-pdfs`: propuestas comerciales.
- `conversation-attachments`: adjuntos de conversaciones/WhatsApp.
- `workspace-assets`: logos, plantillas e imagenes del workspace.

Politicas recomendadas:

- Rutas prefijadas por workspace, por ejemplo `workspace_id/client_id/file.pdf`.
- Select/read solo para miembros del workspace.
- Insert/update/delete solo para miembros autorizados del workspace.
- No usar buckets publicos salvo assets estrictamente publicos.

## `documents` recomendado

Tabla recomendada para indexar archivos de Storage:

- `id`
- `workspace_id`
- `client_id` nullable
- `title`
- `type`
- `storage_bucket`
- `storage_path`
- `mime_type`
- `size`
- `created_by`
- `created_at`

Tipos sugeridos: `client_file`, `invoice_pdf`, `proposal_pdf`, `conversation_attachment`, `workspace_asset`.

Helpers preparados en codigo:

- `listDocuments(workspaceId, clientId?)`
- `createDocumentRecord(workspaceId, payload)`
- `getSignedDocumentUrl(document)`

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
