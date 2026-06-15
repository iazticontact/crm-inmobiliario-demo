# Phase 2E-2 H6B — Login root cause: missing table GRANTs

> **Fecha:** 2026-06-15 · **Proyecto:** `ylhdbawrllqygfvllhdo` (Demo Inmobiliaria)
> **Tipo:** causa exacta + fix de privilegios (no app code, no schema, no datos).

## 1. Síntoma
Tras reiniciar y entrar con `odunabeitia14@gmail.com`, la app seguía mostrando
**"Tu usuario aún no tiene acceso a un workspace"** (redirect `/login?error=no_profile`),
pese a que el vínculo de datos (profile + workspace_member) ya existía.

## 2. Causa EXACTA (probada, no suposición)
El rol `authenticated` **no tenía privilegios DML** sobre las tablas `public`.
Reproducido ejecutando la consulta exacta de AuthGate como rol `authenticated`:

```
ERROR: 42501: permission denied for table profiles
HINT:  GRANT SELECT ON public.profiles TO authenticated;
```

Auditoría de grants (todas las tablas `public`):
`authenticated`/`anon` solo tenían `REFERENCES, TRIGGER, TRUNCATE` —
**faltaban `SELECT, INSERT, UPDATE, DELETE`** en las 10 tablas.

**Cadena del bug:**
1. La migración creó tablas + RLS + políticas, pero **nunca hizo `GRANT` de DML a
   `authenticated`**. (RLS solo se evalúa *después* del privilegio de tabla; sin
   GRANT, todo falla con 42501 antes de mirar las políticas.)
2. `auth.users` estuvo vacío hasta ahora → **ningún login real se había probado
   end-to-end**, así que el fallo nunca había salido a la luz.
3. AuthGate (`profiles.select('id, workspace_id').eq('id', userId).maybeSingle()`)
   recibía `permission denied` → `profileError` truthy → redirect `no_profile`
   → mensaje "sin workspace". La ficha/dashboard/etc. también habrían fallado.

> No era ni RLS (las políticas `pr_select`/`wm_select` permiten `id = auth.uid()`),
> ni los datos (profile+member correctos), ni el código de login. Era el GRANT.

## 3. Fix aplicado (idempotente, server-side, no destructivo)
```sql
grant select, insert, update, delete on
  public.workspaces, public.profiles, public.workspace_members,
  public.clients, public.properties, public.opportunities,
  public.service_cases, public.tasks, public.calendar_events, public.activities
to authenticated;
```
- Solo `authenticated` (no `anon`). RLS sigue restringiendo filas por workspace.
- `GRANT` es idempotente y reversible (`REVOKE`); no toca schema ni datos.

## 4. Verificación (como rol `authenticated`, RLS activo, `auth.uid()` = usuario)
```
profile_self_readable = 1   · profile_ws_id = Demo Inmobiliaria
member_self_readable  = 1
clients_visible       = 8   · opportunities_visible = 7
```
→ AuthGate pasa; el owner ve los datos de su workspace por RLS. **Bug resuelto en
la raíz.**

## 5. Implicación CRÍTICA para staging/producción
El GRANT se aplicó **directamente a la BD** (vía MCP), **no vive en el repo**. Un
proyecto Supabase nuevo (staging/prod cliente) recreado desde migraciones
**tendría el mismo bug**. → **Acción pendiente (no en esta fase):** añadir estos
`GRANT` (y `ALTER DEFAULT PRIVILEGES … GRANT … TO authenticated` para tablas
futuras) al flujo de migraciones antes de desplegar en EasyPanel/VPS.

## 6. Qué NO se tocó
App code, `.env.local`, schema/estructura, datos de negocio, contraseñas, Auth
users, RLS policies. Solo se concedieron privilegios DML a `authenticated`.

## 7. Hardening opcional futuro (no ahora, evita ocultar errores)
AuthGate trata cualquier `profileError` como "sin workspace". Convendría
distinguir un error de permisos/conexión (42501/red) de "no hay profile", para no
volver a confundir un fallo de configuración con "usuario sin workspace".

## 8. Próximo paso OBLIGATORIO (Oier, navegador)
1. (No hace falta reiniciar dev: el fix es en la BD.) Hard refresh / reintentar login.
2. Login real con `odunabeitia14@gmail.com` (contraseña ≥8).
3. **Debe entrar al dashboard de Demo Inmobiliaria con datos reales.** Si entra →
   smoke navegador completo. Si no, pásame el error de consola/Network exacto.
