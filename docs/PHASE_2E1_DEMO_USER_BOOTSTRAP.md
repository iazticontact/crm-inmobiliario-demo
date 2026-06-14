# Fase 2E-1U — Bootstrap del usuario demo (owner) del workspace demo

**Fecha:** 2026-06-14
**Estado:** preparación lista. **El usuario demo aún NO existe** (esperando a que lo crees en Supabase Auth).

> Esta guía no contiene secretos, contraseñas ni API keys. **Nunca** pegues password, API keys ni el `service_role` key en archivos versionados, en ChatGPT ni en Claude.

## 1. Estado actual

| Recurso | Estado |
|---|---|
| Proyecto | `crm-inmobiliario-demo` (ref `ylhdbawrllqygfvllhdo`, org `Demos Inmobiliarias Workspace`) |
| Migraciones | core + seed + hardening aplicadas |
| `public.workspaces` | 1 fila (workspace demo) |
| `public.profiles` | 0 |
| `public.workspace_members` | 0 |
| `auth.users` | 0 |

Workspace demo (fijo): `d0000000-0000-4000-8000-000000000001` · `Demo Inmobiliaria` · `demo-inmobiliaria` · `real_estate` · `starter`.

## 2. Por qué no hay usuarios todavía

El seed solo crea la fila del **workspace**. El usuario demo se crea en **Supabase Auth** (que genera el `auth.users.id`), y solo después se puede vincular en `public.profiles` y `public.workspace_members` (ambas referencian `auth.users.id` por FK). Crear el usuario es una acción manual tuya en el dashboard: Claude no crea usuarios ni maneja contraseñas.

## 3. Crear el usuario demo en Supabase Auth (dashboard)

1. Entra al dashboard del proyecto **`crm-inmobiliario-demo`** (org `Demos Inmobiliarias Workspace`). Verifica que el ref es `ylhdbawrllqygfvllhdo`.
2. Ve a **Authentication → Users → Add user → Create new user**.
3. Email recomendado:
   - Si Supabase te deja usar un email no real: `demo@crm-inmobiliario.local`.
   - Si exige email real/verificable: usa un email controlado tuyo.
4. Define una contraseña fuerte (la genera el dashboard o tú).
5. Marca el usuario como confirmado (Auto Confirm User) si quieres poder iniciar sesión sin verificación de correo.

## 4. Qué guardar en Proton Pass

- Email del usuario demo.
- Contraseña del usuario demo.
- (Opcional) el UUID del usuario, como referencia.

## 5. Qué NO pegar nunca en ChatGPT / Claude

- La **contraseña** del usuario demo.
- Las **API keys** de Supabase (anon, service_role, JWT secret).
- El contenido de `.env.local` / `.env.local.backup_antiguo`.

> Lo **único** que necesitas traer de vuelta para la vinculación es el **UUID** del usuario (`auth.users.id`). El UUID no es un secreto sensible, pero aun así no lo guardaremos en el repo salvo que lo apruebes.

## 6. Copiar el UUID del usuario

- En **Authentication → Users**, abre el usuario recién creado.
- Copia su **User UID** (formato UUID, p.ej. `123e4567-e89b-42d3-a456-426614174000`).
- Alternativa SQL (SQL Editor del dashboard), read-only:
  ```sql
  select id, email, created_at from auth.users order by created_at desc limit 5;
  ```

## 7. Reemplazar los placeholders del template SQL

Plantilla: [`supabase/manual/20260614_link_demo_owner_template.sql`](../supabase/manual/20260614_link_demo_owner_template.sql).

Sustituye **solo en una copia temporal** (el SQL Editor del dashboard), **no** en el archivo del repo:

| Placeholder | Sustituir por |
|---|---|
| `{{AUTH_USER_ID}}` | el UUID del usuario demo (entre comillas simples) |
| `{{DEMO_USER_EMAIL}}` | el email demo entre comillas, **o** `null` (sin comillas) si no quieres guardarlo |

El workspace id `d0000000-0000-4000-8000-000000000001` se queda **fijo**.

## 8. Ejecutar el SQL de vinculación

Dos opciones equivalentes:

- **A) Dashboard SQL Editor:** pega el contenido del template con los placeholders ya sustituidos y ejecútalo. Es transaccional (`begin … commit`) e idempotente.
- **B) Vía Claude (conector `claude.ai Supabase`):** pásame **solo el UUID** (y opcionalmente el email demo) y yo ejecuto la vinculación sustituyendo los placeholders en una query temporal, sin escribir datos reales en el repo.

## 9. Verificar el resultado (read-only)

```sql
select
  (select count(*) from auth.users)                          as auth_users,
  (select count(*) from public.profiles)                     as profiles,
  (select count(*) from public.workspace_members)            as members,
  (select role from public.profiles
     where workspace_id = 'd0000000-0000-4000-8000-000000000001'
     limit 1)                                                as profile_role,
  (select role from public.workspace_members
     where workspace_id = 'd0000000-0000-4000-8000-000000000001'
     limit 1)                                                as member_role;
```

Esperado tras la vinculación:

| Campo | Valor |
|---|---|
| `auth_users` | 1 |
| `profiles` | 1 |
| `members` | 1 |
| `profile_role` | `client_admin` |
| `member_role` | `owner` |
| workspace_id (ambas filas) | `d0000000-0000-4000-8000-000000000001` |

## 10. Revertir en caso de error (sin borrar el workspace)

```sql
delete from public.workspace_members
  where workspace_id = 'd0000000-0000-4000-8000-000000000001'
    and user_id = '<UUID>';
delete from public.profiles where id = '<UUID>';
-- El workspace demo se mantiene intacto.
-- Borrar el auth user (si se quiere) se hace desde Authentication → Users.
```

## 11. Riesgos y precauciones

- **No** ejecutes el template sin sustituir `{{AUTH_USER_ID}}`: las guardas lo abortarán, pero conviene revisarlo antes.
- La membresía `owner` se inserta como bootstrap server-side; las RLS policies **no** permiten al cliente crear su primera membresía por diseño (evita escaladas).
- No guardes contraseñas ni API keys en el repo. El template y esta guía solo usan placeholders.
- Warning residual de seguridad (`0029 authenticated_security_definer_function_executable`) sigue aceptado por diseño; este bootstrap no lo cambia.

## 12. Siguiente paso

1. Crear el usuario en Auth → traer el **UUID** → ejecutar la vinculación (sección 8).
2. Después, **Fase 2E-2** (tablas CRM) — no iniciada.
