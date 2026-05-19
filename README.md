# NowCRM

CRM con IA omnicanal — base reutilizable de NowLabs.

NowCRM es un workspace SaaS construido en Next.js + Supabase con:

- Inbox omnicanal (WhatsApp, Instagram, web, email).
- Asistente NowLabs AI (Inbox copilot + Copilot CRM interno).
- Clientes con vista 360 y vinculación por canal.
- Operaciones por vertical: pipeline de oportunidades, expedientes y
  propiedades (Vertical Pack v1 — inmobiliaria, extranjería, servicios).
- Calendario interno + Google Calendar (OAuth).
- Facturación básica y automatizaciones (catálogo n8n).
- Settings por workspace con plantillas editables y vertical configurable.

---

## Puesta en marcha local

```bash
# 1. Instalar dependencias (Node 20+).
npm install

# 2. Variables de entorno.
cp .env.example .env.local
# rellena al menos los bloques de Supabase y NEXT_PUBLIC_APP_URL.

# 3. Migraciones Supabase: ver docs/SUPABASE_SCHEMA_NOTES.md.

# 4. Dev server.
npm run dev
# Abre http://localhost:3000.
```

> **Aviso:** la versión de Next.js de este repo es **16.x con Turbopack** y
> tiene cambios respecto a la documentación pública generalista. Antes de
> escribir código, consulta `node_modules/next/dist/docs/` y respeta los avisos
> de deprecación. Ver `AGENTS.md`.

---

## Scripts

| Comando | Acción |
|---------|--------|
| `npm run dev`   | Servidor de desarrollo (Turbopack). |
| `npm run build` | Build de producción. |
| `npm run start` | Sirve el build de producción. |
| `npm run lint`  | ESLint con flags estrictos. |

QA y CI esperan: `npm run lint -- --max-warnings=0`, `npx tsc --noEmit` y
`npm run build` verdes antes de commitear cierres de fase.

---

## Estructura

```
src/
  app/
    (saas)/          # /dashboard, /clients, /inbox, /assistant, /opportunities,
                     # /automations, /calendar, /billing, /settings
    api/             # route handlers: assistant, inbox, integraciones, n8n
    login/, reset-password/, auth/callback
  components/        # UI: Sidebar, MetricCard, drawers, ClientPicker, etc.
  lib/
    supabase.ts      # cliente browser/server con SSR
    supabase-queries.ts
    vertical-queries.ts, workspace-settings.ts, workspace-templates.ts
    feature-flags.ts # gating de módulos por env
    assistant-agent.ts, agents/*  # NowLabs AI + Copilot CRM
    n8n-client.ts, meta-whatsapp.ts, integrations.ts
    mock-data.ts     # demo data — SOLO se sirve en modo demo
docs/                # playbooks, contratos n8n, QA, schema notes
```

---

## Demo vs real

- En `/login` se puede entrar como **usuario demo**. Activa `DEMO_MODE_KEY`
  y la UI sirve datos de `src/lib/mock-data.ts` (Ana Rodríguez, Miguel Torres,
  etc.).
- Con sesión real (Supabase Auth), `useCurrentUser` resuelve el workspace y
  todas las páginas leen de Supabase. Los datos demo dejan de mostrarse.
- En clones de cliente: para ocultar la demo, define
  `NEXT_PUBLIC_ENABLE_DEMO_DATA=false`. Para ocultar módulos no contratados,
  usa los flags `NEXT_PUBLIC_ENABLE_*` (ver `.env.example`).

---

## Documentación

- **`docs/CLIENT_ADAPTATION_PLAYBOOK.md`** — clonar NowCRM para un cliente real.
- **`docs/INFRASTRUCTURE_NOWLABS.md`** — arquitectura objetivo (Vercel,
  Supabase, VPS, Cloudflare).
- **`docs/ENVIRONMENT_VARIABLES.md`** — todas las env vars con dónde sacarlas.
- **`docs/QA_CHECKLIST.md`** — QA por fase + sección clone readiness.
- **`docs/META_WHATSAPP_OFFICIAL_SETUP.md`** — conectar WhatsApp real.
- **`docs/GOOGLE_CALENDAR_OFFICIAL_SETUP.md`** — conectar Google Calendar real.
- **`docs/N8N_PAYLOAD_CONTRACT.md`** — formato de eventos enviados a n8n.

---

## Seguridad (resumen)

- `SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY`, `META_*`, `N8N_API_KEY` solo
  en variables server-side de Vercel. **Nunca** en cliente.
- RLS por `workspace_id` en cada tabla con datos de cliente.
- Webhooks Meta firmados con `META_APP_SECRET`.
- Webhooks salientes a n8n firmados con `N8N_WEBHOOK_SECRET`.
- Sin claves de integración, la app degrada a `pending_config` en vez de
  fingir éxito.

---

## Licencia

Propietario — NowLabs. Uso interno y para clientes contratados.
