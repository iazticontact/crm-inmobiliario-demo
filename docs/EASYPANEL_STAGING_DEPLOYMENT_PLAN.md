# EasyPanel Staging Deployment Plan — CRM Inmobiliario

> **Fecha:** 2026-06-15 · **HEAD:** `2ccfa76` · **Tipo:** plan de despliegue
> (NO se despliega en esta fase). Relacionado:
> [STAGING_HOSTINGER_STRATEGY.md](STAGING_HOSTINGER_STRATEGY.md),
> [AI_N8N_MCP_RUNTIME_ARCHITECTURE.md](AI_N8N_MCP_RUNTIME_ARCHITECTURE.md),
> [N8N_AUTOMATION_STRATEGY.md](N8N_AUTOMATION_STRATEGY.md).

## A. Objetivo
Desplegar el CRM en **staging** (VPS Hostinger + EasyPanel) para probarlo en un
entorno real (Linux, sin la lentitud de OneDrive en local), **antes** de
producción y **antes** de activar n8n. Validar el flujo real end-to-end con la
`OPENAI_API_KEY` real y Supabase cloud.

## B. Infra conocida
- **VPS Hostinger** (probable KVM2 — ~2 vCPU / 8 GB RAM). Suficiente para `next
  start`; el `next build` consume RAM (ver §F nota de memoria).
- **EasyPanel** instalado (PaaS sobre Docker + Traefik, SSL Let's Encrypt auto).
- **n8n** ya instalado como servicio aparte en el mismo VPS → **se mantiene
  separado y dormido** respecto al CRM en esta fase.
- **Supabase cloud** externo (`ylhdbawrllqygfvllhdo`) — no cambia.
- **OpenAI** externo (vía env).

## C. Arquitectura staging
```
Internet
  └─ Traefik (EasyPanel, SSL)
       ├─ staging.crm.tudominio.com  → [App EasyPanel] CRM Next.js (next start :3000)
       └─ n8n.tudominio.com          → [Service EasyPanel] n8n (YA existente, separado)
CRM ── HTTPS ──> Supabase cloud (ylhdbawrllqygfvllhdo)  (datos + RLS + Auth)
CRM ── HTTPS ──> OpenAI API
CRM ── (n8n hook DORMIDO: N8N_BASE_URL sin configurar en staging)
```
- CRM = **app separada** en EasyPanel. n8n = servicio separado (no se toca).
- Sin WhatsApp/Meta, sin Google OAuth, sin Storage/RAG, sin billing real, sin
  automatizaciones n8n productivas en esta fase.

## D. Variables de entorno (NOMBRES, sin valores)
> Crear en EasyPanel → app CRM → **Environment**. Valores de staging, nunca en Git.

**Requeridas (runtime + build):**
- `NEXT_PUBLIC_SUPABASE_URL` → debe apuntar a `ylhdbawrllqygfvllhdo` (no legacy).
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (o `NEXT_PUBLIC_SUPABASE_ANON_KEY`).
- `NEXT_PUBLIC_APP_URL` → `https://staging.crm.tudominio.com`.
- `NODE_ENV=production`.

**Requeridas solo server (runtime):**
- `OPENAI_API_KEY` (asistente IA).
- `OPENAI_ASSISTANT_MODEL` (opcional; default gpt-4o-mini).
- `AGENT_TOOL_SECRET` (gate de `/api/agent/tool`).
- `SUPABASE_SERVICE_ROLE_KEY` (solo server; usado por `/api/agent/tool`,
  `/api/team/*`, documents, webhooks).

**Flags recomendados en staging:**
- `NEXT_PUBLIC_ENABLE_DEMO_DATA=false` (o `true` solo si quieres el botón demo).
- `NEXT_PUBLIC_NOWLABS_INTERNAL=false` (nav cliente; `true` solo para ver
  WhatsApp/Facturación/Automatizaciones internas).
- **NO** poner `NEXT_PUBLIC_FORCE_OFFLINE_DEV` (es escotilla de dev).

**Dormidas (dejar SIN configurar en staging):**
- `N8N_BASE_URL`, `N8N_WEBHOOK_SECRET`, `N8N_API_KEY` (n8n vendrá después).
- `GOOGLE_*`, `META_*`, `NOWCRM_WEBHOOK_SECRET` (integraciones futuras).

> ⚠️ **CRÍTICO (Next.js):** las `NEXT_PUBLIC_*` se **inlinean en BUILD**, no en
> runtime. En EasyPanel deben existir **antes/durante el build** (EasyPanel las
> pasa al build). Si cambias una `NEXT_PUBLIC_*`, hay que **rebuild**, no solo
> reiniciar.

## E. No activar todavía
WhatsApp Meta · Google OAuth · Storage/RAG · billing real · automatizaciones n8n
productivas. Solo CRM core + asistente IA contra Supabase + OpenAI.

## F. Pasos en EasyPanel (cuando se decida desplegar)
1. **Crear proyecto/app**: EasyPanel → Create → **App** (no "Static").
2. **Source = GitHub**: conectar la cuenta, repo `iazticontact/crm-inmobiliario-demo`,
   **branch `main`**. (Opcional: auto-deploy on push.)
3. **Build method = Nixpacks** (auto-detecta Next). Alternativa: Dockerfile propio
   si se quiere control fino (no necesario hoy).
4. **Node version ≥ 20** (Next 16 lo exige). En Nixpacks fijarlo con variable
   `NIXPACKS_NODE_VERSION=20` (o `22`). *(Opcional a futuro: añadir un `.nvmrc`
   al repo — es cambio de código, no se hace en esta fase.)*
5. **Build command**: `npm ci && npm run build` (Nixpacks suele hacerlo solo;
   fijarlo si hace falta).
6. **Start command**: `npm run start` (= `next start`; escucha en `PORT`/3000).
7. **Port**: 3000 (que coincida con lo que Traefik enruta a la app).
8. **Environment**: añadir todas las vars §D (valores de staging).
9. **Domains**: añadir `staging.crm.tudominio.com`; EasyPanel provisiona **SSL
   Let's Encrypt** automáticamente. *(DNS: A record del subdominio → IP del VPS;
   lo hace Oier, no Claude.)*
10. **Health check**: path `/login` (200) o `/`.
11. **Deploy** y revisar **Logs** de build y runtime.

> 🧠 **Nota de memoria:** `next build` puede consumir bastante RAM. En un VPS
> ajustado, si el build muere por OOM: añadir swap, o construir con
> `NODE_OPTIONS=--max-old-space-size=2048`, o usar `output: 'standalone'`
> (optimización opcional de imagen; cambio de `next.config.ts`, futuro).

## G. Validaciones post-deploy (smoke en staging)
- [ ] App levanta sin errores en **Logs** (build + runtime).
- [ ] `https://staging.crm.tudominio.com/login` carga (SSL OK).
- [ ] Login owner real → Dashboard con datos reales (no demo).
- [ ] Nav cliente = Dashboard · Clientes · Operaciones · Calendario · Asistente IA
      · Configuración (WhatsApp **no** visible).
- [ ] Ficha cliente: crear/editar tarea/operación/expediente/evento; **persiste**
      al recargar; sin UUIDs visibles.
- [ ] Asistente: consultas reales + acciones (preparar→confirmar) sin errores RLS,
      sin inventar.
- [ ] Demo ("Ver demo inmobiliaria") funciona y **no** escribe en Supabase.
- [ ] Supabase counts suben tras crear (verificable read-only).
- [ ] Sin secretos en logs; sin `service_role` en cliente.

## H. Rollback
- EasyPanel guarda despliegues → **redeploy del commit anterior** (o apuntar la
  app a un commit/tag estable, p. ej. `demo-v1` o el último verde).
- Revisar env si el fallo es de configuración.
- **No tocar la DB**: no hay migraciones destructivas en este corte → el rollback
  de código no requiere rollback de Supabase.

## I. Seguridad
- **n8n con auth** y en subdominio propio; **no exponer webhooks internos** sin
  secreto. n8n y CRM = servicios separados.
- **Envs separadas staging/prod** (otra app EasyPanel + otros valores; idealmente
  proyecto Supabase dedicado para prod cliente más adelante).
- `SUPABASE_SERVICE_ROLE_KEY` y `AGENT_TOOL_SECRET` **solo server-side** (no
  `NEXT_PUBLIC_`). Nunca en Git, nunca en logs.
- Supabase Auth: configurar **Site URL / redirect URLs** al dominio de staging.
- Activar **leaked-password-protection** en Supabase Auth (advisor WARN actual).
- **Backups:** snapshots del VPS; export de workflows n8n (cuando se active).
- Sin legacy (`ktsgfukjgldeylfzrayr`, NowLabs/CostaDelSol).

## J. Qué hace Oier vs. qué NO hace Claude
- **Oier (manual):** DNS del subdominio, crear la app en EasyPanel, pegar envs
  con valores reales, lanzar el deploy, smoke en staging.
- **Claude:** NO despliega, NO toca DNS, NO toca `.env.local`, NO instala en el
  VPS. Solo deja el plan y, si hace falta, ajustes de repo (build script, etc.)
  validados con tsc/lint/build.

## K. Veredicto
**Plan listo.** En cuanto el smoke navegador local pase (ver smoke report), este
plan permite levantar staging de forma segura y reproducible, con n8n dormido y
sin integraciones externas activas.
