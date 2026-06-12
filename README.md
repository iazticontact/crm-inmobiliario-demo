# CRM Inmobiliario Demo

Prototipo funcional de CRM para inmobiliarias.

CRM Inmobiliario Demo es un workspace SaaS construido en Next.js + Supabase con:

- Inbox omnicanal (WhatsApp, Instagram, web, email).
- Asistente IA (Inbox copilot + Copilot CRM interno).
- Clientes con vista 360 y vinculación por canal.
- Operaciones por vertical: pipeline de oportunidades, expedientes y
  propiedades (Vertical Pack v1 — inmobiliaria, extranjería, servicios).
- Calendario interno + Google Calendar (OAuth).
- Facturación básica y automatizaciones (catálogo n8n).
- Settings por workspace con plantillas editables y vertical configurable.

---

## Estado actual

- **Demo funcional en local.** Arranca y se navega sin infraestructura externa
  (modo demo con datos mock profesionales de inmobiliaria).
- **Pendiente de infraestructura nueva.** Supabase, n8n, Google y WhatsApp/Meta
  reales se conectan en fases posteriores; sin claves, la app degrada con
  honestidad a `pending_config` en lugar de fingir éxito.
- Marca comercial final aún por definir; el nombre visible provisional es
  "CRM Inmobiliario Demo".

---

## Stack

- **Next.js 16** (App Router) · **React 19** · **TypeScript 5**
- **Supabase** (`@supabase/ssr` + `@supabase/supabase-js`) — Auth, Postgres con
  RLS, Storage
- **Tailwind CSS v4**, framer-motion, lucide-react, recharts, sonner
- **OpenAI** (Responses API) para el Asistente IA · **n8n** como brazo de
  automatización externo

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

> **Variables de entorno:** los valores reales van en `.env.local`, que **no se
> commitea** (está en `.gitignore`). `.env.example` es la plantilla de
> referencia y **no contiene secretos**. Nunca pongas claves en variables
> `NEXT_PUBLIC_*`.

> **Aviso Next.js 16:** esta versión introduce cambios respecto a la
> documentación pública generalista. Antes de escribir código, consulta
> `node_modules/next/dist/docs/` y respeta los avisos de deprecación
> (ver `AGENTS.md`). El servidor de desarrollo usa **Webpack**
> (`next dev --webpack`); el build de producción usa Turbopack.

---

## Scripts

| Comando | Acción |
|---------|--------|
| `npm run dev`   | Servidor de desarrollo (Webpack). |
| `npm run build` | Build de producción (Turbopack). |
| `npm run start` | Sirve el build de producción. |
| `npm run lint`  | ESLint. |

QA y CI esperan `npm run lint`, `npx tsc --noEmit` y `npm run build` verdes
antes de commitear cierres de fase.

---

## Estructura

```
src/
  app/
    (saas)/          # /dashboard, /clients, /inbox, /assistant, /opportunities,
                     # /automations, /calendar, /billing, /settings
    api/             # route handlers: assistant, inbox, integraciones, n8n
    login/, reset-password/, auth/callback
  components/        # UI: Sidebar, Topbar, SectionCard, drawers, ClientPicker, etc.
  lib/
    brand.ts         # nombres/textos de producto visibles (fuente central)
    supabase.ts      # cliente browser/server con SSR
    supabase-queries.ts
    vertical-queries.ts, workspace-settings.ts, workspace-templates.ts
    feature-flags.ts # gating de módulos por env
    ai.ts, agents/*  # Asistente IA + Copilot CRM (cerebro en agents/nowlabs-main-agent.ts)
    n8n-client.ts, meta-whatsapp.ts, integrations.ts
    mock-data.ts     # demo data — SOLO se sirve en modo demo
docs/                # ver docs/README.md (índice de documentación)
```

---

## Demo vs real

- En `/login` se puede entrar como **usuario demo**. Activa `DEMO_MODE_KEY`
  y la UI sirve datos de `src/lib/mock-data.ts` (Lucía Herrera, Roberto Díaz,
  etc.).
- Con sesión real (Supabase Auth), `useCurrentUser` resuelve el workspace y
  todas las páginas leen de Supabase. Los datos demo dejan de mostrarse.
- En clones de cliente: para ocultar la demo, define
  `NEXT_PUBLIC_ENABLE_DEMO_DATA=false`. Para ocultar módulos no contratados,
  usa los flags `NEXT_PUBLIC_ENABLE_*` (ver `.env.example`).

---

## Documentación

Índice completo en **`docs/README.md`**. Punteros rápidos:

- **`docs/ENVIRONMENT_VARIABLES.md`** — todas las env vars con dónde sacarlas.
- **`docs/QA_CHECKLIST.md`** — QA por fase + sección clone readiness.
- **`docs/META_WHATSAPP_OFFICIAL_SETUP.md`** — conectar WhatsApp real.
- **`docs/GOOGLE_CALENDAR_OFFICIAL_SETUP.md`** — conectar Google Calendar real.
- **`docs/N8N_PAYLOAD_CONTRACT.md`** — formato de eventos enviados a n8n.
- **`docs/supabase/`** — schema, Storage y RLS (zona protegida, no tocar sin revisión).

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

Propietario. Uso interno y para clientes contratados.
