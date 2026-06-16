# EasyPanel Staging Deployment Runbook — CRM Inmobiliario

> **Fecha:** 2026-06-16 · **HEAD:** `abe4af3` · **Runbook ejecutable (no se
> despliega desde aquí).** Complementa
> [STAGING_HOSTINGER_STRATEGY.md](STAGING_HOSTINGER_STRATEGY.md) y
> [EASYPANEL_STAGING_DEPLOYMENT_PLAN.md](EASYPANEL_STAGING_DEPLOYMENT_PLAN.md).
> El despliegue lo ejecuta Oier en el VPS; Claude NO despliega, NO toca DNS, NO
> toca `.env.local`.

## 0. Estado verificado (pre-deploy)
- Repo `main` limpio en `abe4af3`; `.env.local` y `.mcp.json` **no trackeados**.
- `tsc --noEmit` ✅ · `eslint --max-warnings=0` ✅ · `next build` ✅ (46 rutas).
- **Sin** Dockerfile / nixpacks.toml / `.nvmrc`; `next.config.ts` mínimo;
  scripts `next build` / `next start`; Next 16.2.4, React 19, Node ≥ 20.
- **Supabase de staging = el cloud actual `ylhdbawrllqygfvllhdo`** (mismo proyecto;
  GRANTs `authenticated` y tablas `assistant_threads`/`assistant_messages` YA
  aplicados → **no hay trabajo de DB para este deploy**).

## 1. Estrategia EasyPanel (recomendada)
- **Tipo de servicio:** App (no "Static").
- **Build:** **Nixpacks** (auto-detecta Next). Alternativa: Dockerfile propio (no
  necesario hoy).
- **Node:** fijar **20 o 22 LTS** con la variable `NIXPACKS_NODE_VERSION=20`
  (no hay `.nvmrc` en el repo; Next 16 exige Node ≥ 20).
- **Build command:** `npm ci && npm run build`.
- **Start command:** `npm run start` (`next start`; escucha en `PORT`/3000).
- **Puerto del contenedor:** 3000 (que Traefik/EasyPanel enrute ahí).
- **n8n:** queda **separado y dormido** para el CRM (no se activa; `N8N_*` sin
  configurar).

## 2. Variables de entorno (NOMBRES, sin valores) — EasyPanel → Environment
> ⚠️ **CRÍTICO (Next.js):** las `NEXT_PUBLIC_*` se **inlinean en BUILD**, no en
> runtime → deben existir **antes/durante el build**. Si cambias una, **rebuild**
> (no basta reiniciar). EasyPanel pasa las env al build.

**Obligatorias (build + runtime):**
- `NEXT_PUBLIC_SUPABASE_URL` → debe apuntar a `ylhdbawrllqygfvllhdo` (no legacy).
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (preferida) **o** `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
- `NEXT_PUBLIC_APP_URL` → `https://staging.crm.tudominio.com`.
- `NODE_ENV=production`.

**Obligatorias (solo runtime, server):**
- `OPENAI_API_KEY` (asistente IA).
- `OPENAI_ASSISTANT_MODEL` (opcional; default `gpt-4o-mini`).
- `AGENT_TOOL_SECRET` (gate de `/api/agent/tool`).
- `SUPABASE_SERVICE_ROLE_KEY` (**solo server**; `/api/agent/tool`, `/api/team/*`,
  documents, webhooks).

**Flags recomendados (staging cliente):**
- `NEXT_PUBLIC_ENABLE_DEMO_DATA=false` (o `true` si quieres el botón demo).
- `NEXT_PUBLIC_NOWLABS_INTERNAL=false` (cliente; `true` solo para operador interno).
- **NO** poner `NEXT_PUBLIC_FORCE_OFFLINE_DEV` ni `NEXT_PUBLIC_SHOW_DEBUG_PANEL`.

**Dormidas — dejar SIN configurar (fases futuras):**
- `N8N_BASE_URL`, `N8N_WEBHOOK_SECRET`, `N8N_API_KEY` (n8n).
- `GOOGLE_CLIENT_ID/SECRET/REDIRECT_URI` (Google Calendar).
- `META_*` (WhatsApp), `NOWCRM_WEBHOOK_SECRET`, Storage/RAG, billing.

> Build de EasyPanel: `NIXPACKS_NODE_VERSION=20`. Memoria: si `next build` muere
> por OOM en un VPS ajustado, añade swap o `NODE_OPTIONS=--max-old-space-size=2048`.

## 3. Supabase Auth — Redirect URLs (Oier, dashboard Supabase)
En **Authentication → URL Configuration** del proyecto `ylhdbawrllqygfvllhdo`:
- **Site URL:** `https://staging.crm.tudominio.com`.
- **Redirect URLs** (añadir, no quitar localhost si sigue en uso):
  - `https://staging.crm.tudominio.com/**`
  - `https://staging.crm.tudominio.com/reset-password` (usado por reset password,
    `redirectTo = ${origin}/reset-password`).
  - `https://staging.crm.tudominio.com/auth/callback`
  - (mantener `http://localhost:3000/**` mientras se use local).
- (Recomendado prod: activar **leaked-password-protection** — advisor WARN actual.)

## 4. Pasos EXACTOS en EasyPanel
1. **Crear App:** EasyPanel → Project → **Create → App**.
2. **Source = GitHub:** conectar la cuenta, repo `iazticontact/crm-inmobiliario-demo`,
   **branch `main`**. (Opcional: auto-deploy on push.)
3. **Build = Nixpacks.** Añadir var `NIXPACKS_NODE_VERSION=20`.
4. **Build command:** `npm ci && npm run build`.
5. **Start command:** `npm run start`.
6. **Port:** 3000.
7. **Environment:** pegar todas las vars §2 (valores reales de staging).
8. **Domains:** añadir `staging.crm.tudominio.com`; EasyPanel provisiona **SSL
   Let's Encrypt** (Traefik). *(DNS: A record del subdominio → IP del VPS; lo hace
   Oier antes.)*
9. **Health check:** path `/login` (200) — alternativa `/api/config/status`.
10. **Deploy** y revisar **Logs** (build + runtime).
11. **Redeploy:** botón Deploy (o push a `main` si auto-deploy). Si cambiaste una
    `NEXT_PUBLIC_*`, asegúrate de que se **rebuild**.

## 5. Smoke post-deploy (orden recomendado)
1. `https://staging.crm.tudominio.com/login` carga (SSL OK), sin error-overlay.
2. **Login real** owner (`odunabeitia14@gmail.com`, pass ≥8) → **dashboard** con
   datos reales (no demo); nav = Dashboard·Clientes·Operaciones·Calendario·
   Asistente IA·Configuración (sin WhatsApp).
3. Clientes (8) → "Ver ficha" abre, sin UUIDs, sin "Score".
4. Operaciones (pipeline) · Calendario (eventos).
5. **Asistente:** nueva consulta → "Resumen del CRM" → "Qué ha pasado
   recientemente" (actividad real) → **recargar** (persiste) → reabrir hilo →
   **eliminar** (sin error `public.messages`) → "Crea una operación para Lucía
   Herrera" → card → Cancelar y luego Confirmar (aparece + activity).
6. **Demo:** "Ver demo inmobiliaria" → no persiste en Supabase.
7. Logout → login de nuevo. Revisar **Logs** (sin errores RLS/OpenAI; sin secretos).

## 6. Rollback
- EasyPanel guarda despliegues → **redeploy del commit anterior** (o apuntar la
  app a un commit/tag estable, p. ej. `demo-v1` o el último verde).
- Revisar **env vars** si el fallo es de configuración.
- **No tocar la DB** (no hay migraciones destructivas; rollback de código no
  requiere rollback de Supabase).
- **Detectar fallo de `NEXT_PUBLIC` rancia/incorrecta:** síntomas = login
  "Invalid API key" o "tu usuario no tiene acceso a un workspace" pese a datos
  correctos → suele ser una `NEXT_PUBLIC_SUPABASE_*` mal o inlineada antes de
  corregirla → **rebuild** con la var correcta. (Ver H6B: causa raíz fue GRANT
  ausente, ya aplicado en este proyecto.)

## 7. Seguridad (verificar)
- **`SUPABASE_SERVICE_ROLE_KEY` y `AGENT_TOOL_SECRET` solo server** (no
  `NEXT_PUBLIC_`); nunca en logs ni en Git.
- **Sin `service_role` en frontend** (verificado en el repo).
- **`.env`/`.mcp.json` fuera del repo**; no subir `.next`/`node_modules`/`memory/`.
- **n8n** (si se usa después) con auth y en subdominio propio; no se activa ahora.
- **Supabase RLS ON** en todas las tablas; staging usa el cloud actual.
- **OpenAI key** solo server-side (`/api/assistant/v2`, `/api/agent/tool`).

## 8. Provisioning de un Supabase NUEVO (futuro, no ahora)
Si en el futuro staging/prod usa un **proyecto Supabase dedicado** (no el actual),
hay que ejecutar por el flujo de migraciones, en orden:
`supabase/migrations/*` incluyendo **`20260615_2e2_grant_authenticated_table_privileges.sql`**
(si no, login falla con 42501/"sin workspace") y **`20260616_2e2_assistant_threads.sql`**
(persistencia del asistente). Con el proyecto actual ya están aplicadas → nada que
hacer para este deploy.

## 9. Riesgos / qué queda manual (Oier)
- DNS del subdominio, crear la app, pegar envs reales, lanzar deploy, smoke.
- Rendimiento del VPS para `next build` (OOM si poca RAM → swap).
- Staging comparte el Supabase actual (datos compartidos con local); para
  producción cliente final, proyecto Supabase dedicado + re-provisioning (§8).

## 10. Veredicto
**STAGING RUNBOOK READY — PENDIENTE DEPLOY MANUAL.** No falta información crítica:
estrategia (Nixpacks + Node 20 + `next start`), envs (nombres), Auth redirects,
pasos EasyPanel, smoke, rollback y seguridad están definidos. El único trabajo de
DB (GRANTs + tablas del asistente) ya está aplicado en `ylhdbawrllqygfvllhdo`.
