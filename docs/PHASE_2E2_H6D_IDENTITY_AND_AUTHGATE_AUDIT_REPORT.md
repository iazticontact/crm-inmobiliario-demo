# Phase 2E-2 H6D — Identity source audit + AuthGate hardening

> **Fecha:** 2026-06-15 · **Base:** `128a74b` · Auditoría de identidad + hardening
> mínimo de AuthGate. **No se tocó `.env.local`, schema, Auth/passwords, ni datos
> de identidad** (el nombre ya vive en `profiles.full_name`).

## 1. Pregunta inicial
"¿Cómo sabe el CRM que soy *Oier Duñabeitia* si yo no lo he especificado?"

## 2. Origen EXACTO del nombre mostrado (con datos, no suposición)
Consulta read-only en `ylhdbawrllqygfvllhdo`:
- `auth.users.raw_user_meta_data` de `odunabeitia14@gmail.com` = `{"email_verified": true}`
  · provider = `email`. → **Auth NO contiene ningún nombre.**
- `public.profiles.full_name` = **`"Oier Dunabeitia"`** · role `client_admin` · workspace Demo.
- Búsqueda en `src/` de `Oier` / `Du(ñ|n)abeitia` / `Demo Owner` → **0 coincidencias**
  (no hay hardcode en frontend).

**Conclusión:** el nombre sale de **`public.profiles.full_name`**, y ese valor lo
**escribió Claude en la fase H6** (commit `cbc518e`) al crear el profile para
vincular el workspace, **derivándolo del local-part del email** (`odunabeitia14`
→ "Oier Dunabeitia"). No vino de Auth, ni de seed (estaba borrado), ni de
hardcode. Es decir: tú no lo especificaste; lo dedujo la fase de fix de H6.

## 3. Fuente canónica de identidad (verificada en código)
`src/lib/current-user.ts` resuelve el nombre así:
`cleanDisplayName(profile.full_name || user_metadata.full_name/name || email) || 'Usuario'`.
→ **Canónico = `profiles.full_name`, con fallback a email y luego "Usuario".**
Diseño correcto. No hay nombre personal hardcodeado que eliminar.

**Decisión:** se **mantiene** `profiles.full_name = "Oier Dunabeitia"` (regla:
"si está en profiles.full_name, dejarlo"; además es correcto y editable). Si
prefieres otro nombre visible, se puede cambiar en `profiles.full_name` (un
UPDATE puntual) sin tocar código. *(Nota: lleva "Dunabeitia" sin ñ, derivado del
email; dilo si quieres "Duñabeitia".)*

## 4–6. Estado Auth / profiles / workspace_members
- `auth.users`: 1 usuario `odunabeitia14@gmail.com` (provider email, sin nombre en metadata).
- `profiles`: 1 fila, id = auth user, full_name "Oier Dunabeitia", role `client_admin`, workspace = Demo.
- `workspace_members`: 1 fila, user = auth user, role `owner`, workspace = Demo Inmobiliaria.

## 7. Estado de la GRANT migration (revisada, no re-aplicada)
`supabase/migrations/20260615_2e2_grant_authenticated_table_privileges.sql`:
- GRANT SELECT/INSERT/UPDATE/DELETE en las 10 tablas core **solo a `authenticated`** ✓
- REVOKE de los mismos a **`anon`** ✓
- `ALTER DEFAULT PRIVILEGES … TO authenticated` (tablas futuras) ✓
- Comentarios explican la causa; **RLS sigue siendo el filtro por workspace**; no
  concede bypass; no toca `service_role`. ✓ Idempotente. No re-aplicada en live.

## 8. Problema de AuthGate (real, detectado)
`AuthGate.tsx` trataba **cualquier** `profileError` igual que "sin profile" →
`?error=no_profile`. Eso **enmascaró** el bug de GRANT (42501 permission denied)
como "usuario sin workspace", y además **cerraba la sesión** en un error que era
de configuración, no de falta de acceso.

## 9. Fix aplicado (mínimo, sin cambiar el modelo de Auth)
- `src/components/AuthGate.tsx`: se separan los casos:
  - **`profileError` presente** (permiso/42501, RLS, conexión, múltiples filas) →
    `?error=access_check`, **sin cerrar sesión**, con **log dev-only seguro**
    (`code` + `message`, sin secretos).
  - **`!profile || !profile.workspace_id`** (sin profile/workspace de verdad) →
    `?error=no_profile` + signOut (comportamiento previo, correcto).
- `src/app/login/page.tsx`: nuevo toast para `access_check`: "No se pudo comprobar
  tu acceso al workspace… revisar permisos/RLS." (no muestra error crudo).

## 10. Qué NO se tocó
`.env.local`, schema/migraciones (la de grants no se re-aplicó), Auth users,
contraseñas, datos de negocio, `profiles.full_name`, RLS policies, Storage, n8n,
WhatsApp/Google, service_role en frontend. Sin features nuevas, sin polish visual.

## 11. Validaciones
`tsc --noEmit` ✅ · `eslint --max-warnings=0` ✅ · `next build` ✅ (46 rutas).

## 12. Próximo paso — smoke real (Oier)
1. Hard refresh (no hace falta reiniciar dev; el fix de grants es en BD).
2. Login real `odunabeitia14@gmail.com` (pass ≥8) → **entra al dashboard**.
3. Smoke navegador completo (ficha/mutaciones → asistente → demo). Pásame counts/
   consola para certificar persistencia.
