# NowCRM — Plan de Schema para Integraciones

Este documento recoge el SQL necesario para soportar el modelo de integraciones por workspace.
Revisar antes de ejecutar. Aplicar en Supabase SQL Editor o via migracion.

---

## Reglas absolutas

- NO ejecutar SQL destructivo (DROP, DELETE) sin respaldo.
- Toda tabla nueva necesita RLS activado: `ALTER TABLE <tabla> ENABLE ROW LEVEL SECURITY`.
- Toda politica RLS debe filtrar por `workspace_id` via `profiles`.
- NUNCA guardar tokens en texto plano. Usar columnas `_enc` para valores cifrados.

---

## 1. Auto-provisioning de workspace al registrarse

### Problema
El codigo espera que exista un registro en `profiles` y otro en `workspaces` para cada usuario. Actualmente no se crean automaticamente al registrarse via Supabase Auth.

### Solucion recomendada: Trigger SQL en Supabase

```sql
-- Trigger que crea profile + workspace automaticamente al registrar un usuario en auth.users
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_workspace_id uuid;
  workspace_name text;
BEGIN
  -- Determinar nombre del workspace desde metadata o email
  workspace_name := COALESCE(
    NEW.raw_user_meta_data->>'workspace_name',
    NEW.raw_user_meta_data->>'company_name',
    split_part(NEW.email, '@', 1)
  );

  -- Crear workspace
  INSERT INTO public.workspaces (name, trial_status, plan, status)
  VALUES (workspace_name, 'active', 'trial', 'active')
  RETURNING id INTO new_workspace_id;

  -- Crear profile vinculado al workspace
  INSERT INTO public.profiles (id, workspace_id, full_name, email, role, trial_status)
  VALUES (
    NEW.id,
    new_workspace_id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
    NEW.email,
    'owner',
    'active'
  );

  RETURN NEW;
END;
$$;

-- Vincular trigger a auth.users
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
```

### Tablas requeridas previamente

```sql
-- workspaces (si no existe)
CREATE TABLE IF NOT EXISTS public.workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  trial_status text NOT NULL DEFAULT 'active',
  plan text NOT NULL DEFAULT 'trial',
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- profiles (si no existe)
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  workspace_id uuid REFERENCES public.workspaces(id) ON DELETE SET NULL,
  full_name text,
  email text,
  role text DEFAULT 'owner',
  trial_status text DEFAULT 'active',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- RLS
ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Politicas
CREATE POLICY "Workspace propio" ON public.workspaces
  FOR ALL USING (
    id IN (SELECT workspace_id FROM public.profiles WHERE id = auth.uid())
  );

CREATE POLICY "Profile propio" ON public.profiles
  FOR ALL USING (id = auth.uid());
```

---

## 2. whatsapp_connections — columnas nuevas

El codigo en `/api/integrations/meta/whatsapp/webhook/route.ts` usa `phone_number_id` para
resolver el `workspace_id` desde un mensaje entrante de Meta.

El settings page guarda ahora tambien `whatsapp_business_account_id` y `meta_business_id`.

```sql
-- Anadir columnas nuevas si no existen
ALTER TABLE public.whatsapp_connections
  ADD COLUMN IF NOT EXISTS phone_number_id text,
  ADD COLUMN IF NOT EXISTS whatsapp_business_account_id text,
  ADD COLUMN IF NOT EXISTS meta_business_id text;

-- Indice para resolver workspace desde phone_number_id (usado en webhook entrante)
CREATE INDEX IF NOT EXISTS idx_wa_connections_phone_number_id
  ON public.whatsapp_connections (phone_number_id)
  WHERE phone_number_id IS NOT NULL;
```

### Schema completo de whatsapp_connections (referencia)

```sql
CREATE TABLE IF NOT EXISTS public.whatsapp_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'meta',
  meta_business_id text,
  whatsapp_business_account_id text,
  phone_number_id text,
  phone_number text,
  webhook_verify_token_configured boolean DEFAULT false,
  webhook_url text,
  status text NOT NULL DEFAULT 'not_configured',
  last_webhook_at timestamptz,
  last_test_at timestamptz,
  sync_enabled boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (workspace_id, provider)
);

ALTER TABLE public.whatsapp_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "WhatsApp propio workspace" ON public.whatsapp_connections
  FOR ALL USING (
    workspace_id IN (SELECT workspace_id FROM public.profiles WHERE id = auth.uid())
  );

CREATE INDEX IF NOT EXISTS idx_wa_connections_phone_number_id
  ON public.whatsapp_connections (phone_number_id)
  WHERE phone_number_id IS NOT NULL;
```

---

## 3. google_calendar_connections

```sql
CREATE TABLE IF NOT EXISTS public.google_calendar_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  calendar_id text,
  primary_calendar text,
  refresh_token_enc text,      -- CIFRADO. Nunca texto plano.
  access_token_hash text,      -- Solo hash SHA-256, no el token real.
  token_expiry timestamptz,
  status text NOT NULL DEFAULT 'not_configured',
  last_sync_at timestamptz,
  sync_enabled boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (workspace_id)
);

ALTER TABLE public.google_calendar_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Calendar propio workspace" ON public.google_calendar_connections
  FOR ALL USING (
    workspace_id IN (SELECT workspace_id FROM public.profiles WHERE id = auth.uid())
  );
```

---

## 4. inbox_agent_settings

```sql
CREATE TABLE IF NOT EXISTS public.inbox_agent_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  auto_reply_enabled boolean DEFAULT false,
  mode text DEFAULT 'manual',
  status text DEFAULT 'active',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (workspace_id)
);

ALTER TABLE public.inbox_agent_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Inbox settings propio workspace" ON public.inbox_agent_settings
  FOR ALL USING (
    workspace_id IN (SELECT workspace_id FROM public.profiles WHERE id = auth.uid())
  );
```

---

## 5. automation_workflows

```sql
CREATE TABLE IF NOT EXISTS public.automation_workflows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  trigger text,
  n8n_event text,
  status text NOT NULL DEFAULT 'draft',
  enabled_in_app boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.automation_workflows ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Workflows propios workspace" ON public.automation_workflows
  FOR ALL USING (
    workspace_id IN (SELECT workspace_id FROM public.profiles WHERE id = auth.uid())
  );
```

---

## 6. n8n_flows (columnas opcionales de log)

```sql
ALTER TABLE public.n8n_flows
  ADD COLUMN IF NOT EXISTS last_test_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_status text,
  ADD COLUMN IF NOT EXISTS last_error text,
  ADD COLUMN IF NOT EXISTS last_response jsonb;
```

---

## Resolucion workspace desde phone_number_id (webhook Meta)

Cuando Meta envie un mensaje, el webhook puede resolver el workspace asi:

```sql
-- Consulta que el codigo usara cuando se implemente la resolucion completa:
SELECT workspace_id
FROM public.whatsapp_connections
WHERE phone_number_id = $1
  AND provider = 'meta'
  AND status != 'disconnected'
LIMIT 1;
```

Hasta que se aplique esta migracion, el webhook devuelve `pending_schema_migration`
en los logs y no inserta conversacion.

---

## Orden de ejecucion recomendado

1. Crear `workspaces` + `profiles` si no existen
2. Aplicar trigger `handle_new_user`
3. Aplicar RLS en ambas tablas
4. Crear `whatsapp_connections` o anadir columnas si ya existe
5. Crear `google_calendar_connections`
6. Crear `inbox_agent_settings`
7. Crear `automation_workflows`
8. Columnas opcionales de `n8n_flows`
9. Verificar con un registro de prueba: crear usuario, confirmar que se crean profile + workspace

---

## Verificacion post-migracion

```sql
-- Comprobar que existe el trigger
SELECT trigger_name, event_object_table
FROM information_schema.triggers
WHERE trigger_name = 'on_auth_user_created';

-- Comprobar columnas nuevas de whatsapp_connections
SELECT column_name FROM information_schema.columns
WHERE table_name = 'whatsapp_connections'
  AND column_name IN ('phone_number_id', 'whatsapp_business_account_id', 'meta_business_id');

-- Comprobar RLS activo
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('workspaces', 'profiles', 'whatsapp_connections', 'google_calendar_connections');
```
