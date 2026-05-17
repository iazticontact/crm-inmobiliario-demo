# SQL recomendado para hardening WhatsApp (no aplicado automáticamente)

Esta fase **no** aplica SQL al proyecto remoto. Supabase MCP no estaba
disponible al cerrar el código. El código está escrito para ser tolerante:
funciona con o sin estas columnas/índices. Pero para sacar el máximo del
hardening, conviene aplicar estos SQL **a mano**, idempotentes, una sola vez.

> Revisar antes de ejecutar — leer cada bloque y comprobar contra tu schema
> real con `\d public.messages` y `\d public.conversations`.

## 1. `messages.metadata` (jsonb)

Necesario para:

- Persistir `send_status` (`sent` / `failed` / `draft` / `pending_config`).
- Persistir el `provider_message_id` de Meta (wamid).
- Dedupe de inbound por `externalMessageId`.

```sql
-- Idempotente: añade la columna solo si falta.
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT '{}'::jsonb NOT NULL;
```

## 2. Índice para dedupe de inbound

El processor `processInboundWhatsAppMessage` busca duplicados por
`metadata->>'externalMessageId'`. Sin índice, sigue funcionando pero hace un
scan en cada inserción.

```sql
-- Búsqueda rápida del id externo dentro de metadata.
CREATE INDEX IF NOT EXISTS idx_messages_metadata_external_message_id
  ON public.messages ((metadata->>'externalMessageId'))
  WHERE metadata ? 'externalMessageId';
```

## 2.bis Índice para lookup de conversaciones por phone

El processor también busca conversaciones por
`metadata->>'phone'` cuando llega un mensaje. Para que escale a workspaces con
miles de conversaciones, conviene este índice (GIN sobre toda la columna o
parcial sobre el phone):

```sql
-- Opción A: GIN sobre todo el metadata (más flexible, ocupa más espacio).
CREATE INDEX IF NOT EXISTS idx_conversations_metadata_gin
  ON public.conversations USING gin (metadata);

-- Opción B: B-tree parcial solo para metadata.phone (más estrecho).
CREATE INDEX IF NOT EXISTS idx_conversations_metadata_phone
  ON public.conversations ((metadata->>'phone'))
  WHERE metadata ? 'phone';
```

Recomendado: **Opción A** si la tabla tiene < 1M filas (uso flexible y
soporta más queries). **Opción B** si la cardinalidad de phone es muy alta.

### Opcional: columna dedicada + unique index

Si prefieres una columna explícita (mejor rendimiento y constraint
verdadera contra race conditions), añade también:

```sql
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS external_message_id text;

CREATE UNIQUE INDEX IF NOT EXISTS messages_workspace_external_message_uidx
  ON public.messages(workspace_id, external_message_id)
  WHERE external_message_id IS NOT NULL;
```

El processor intenta primero la columna dedicada y, si no existe, cae al
JSONB. Por eso ambos enfoques son compatibles.

## 3. `whatsapp_connections.phone_number_id` (si todavía no existe)

El webhook de Meta resuelve workspace a partir de
`whatsapp_connections.phone_number_id`. Si el schema antiguo no lo tiene:

```sql
ALTER TABLE public.whatsapp_connections
  ADD COLUMN IF NOT EXISTS phone_number_id text;

CREATE INDEX IF NOT EXISTS idx_whatsapp_connections_phone_number_id
  ON public.whatsapp_connections(phone_number_id)
  WHERE phone_number_id IS NOT NULL;
```

## 4. Política para `service_role`

Si todavía no aplicaste el grant general (`service_role_grants_and_policies_hardening`),
para esta fase solo necesitas el de `messages`:

```sql
GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.messages
  TO service_role;
```

(Idempotente: PostgreSQL ignora la duplicación.)

## 5. Cómo verificar después de aplicar

```sql
-- 1. La columna metadata existe y por defecto es {}
SELECT column_name, data_type, column_default
  FROM information_schema.columns
 WHERE table_schema='public' AND table_name='messages' AND column_name='metadata';

-- 2. El índice GIN/btree para externalMessageId existe
SELECT indexname FROM pg_indexes
 WHERE schemaname='public' AND tablename='messages'
   AND indexname='idx_messages_metadata_external_message_id';

-- 3. (si elegiste la columna dedicada)
SELECT indexname FROM pg_indexes
 WHERE schemaname='public' AND tablename='messages'
   AND indexname='messages_workspace_external_message_uidx';
```

## 6. Qué hacer si **no** puedes aplicar SQL ahora

Nada se rompe:

- El procesador inbound usa `Promise.allSettled` y degrada con fallback.
- Si `messages.metadata` falta, el message se inserta sin metadata. La UI no
  muestra badges pero el flujo principal funciona.
- Si los índices faltan, el dedupe sigue siendo correcto, solo es más lento.

## 7. Lo que **no** se debe hacer

- ❌ `DROP TABLE messages` / `TRUNCATE messages` / `DELETE FROM messages WHERE …`.
- ❌ `UPDATE messages SET metadata = '{}'` masivo (sobrescribiría datos).
- ❌ `ALTER COLUMN metadata SET NOT NULL` sin haber backfilled antes.
- ❌ Aplicar nada sin haber leído primero el schema real con
      `\d public.messages` y `\d public.conversations`.
