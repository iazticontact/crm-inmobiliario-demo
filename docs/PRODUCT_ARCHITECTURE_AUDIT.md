# Product Architecture & Module Audit — CRM Inmobiliario

> **Fecha:** 2026-06-15 · **HEAD:** `ebbf56b` · **Modo:** auditoría arquitectura +
> backend + UX (sin implementar features). **No se desplegó nada.**
> Política transversal: [DATA_REALITY_POLICY.md](DATA_REALITY_POLICY.md).

Este documento ordena el producto antes de seguir metiendo features: qué es
**core**, qué es **addon/futuro**, qué está **sólido** y qué es **promesa sin
backing**. Es la fuente de verdad de límites de módulo para el roadmap y las
decisiones de producto.

---

## 1. Estado verificado (no opiniones)

- **Build/lint/types:** `tsc --noEmit` ✅, `eslint --max-warnings=0` ✅,
  `next build` ✅ (46 rutas). Next.js 16.2.4 (Turbopack).
- **Supabase** (`ylhdbawrllqygfvllhdo`): **10 tablas** en `public`, todas con
  **RLS ON** + políticas: `workspaces, profiles, workspace_members, clients,
  properties, opportunities, service_cases, tasks, calendar_events, activities`.
  Counts seed-exactos (8/7/7/5/10/8/14/1/1/1), **1 solo `workspace_id` por tabla**
  (sin fuga), owner vinculado a profile (ws "Demo Inmobiliaria").
- **NO existen** en la base de datos: `invoices`, `documents`, `conversations`,
  `messages`. → Billing, Storage/documentos e Inbox/WhatsApp **no tienen backing
  de schema todavía**.
- **Env:** `OPENAI_API_KEY` real (live), `AGENT_TOOL_SECRET` fuerte,
  `NEXT_PUBLIC_NOWLABS_INTERNAL=false`, `NEXT_PUBLIC_ENABLE_DEMO_DATA=false`.

---

## 2. Mapa de módulos: core vs addon vs futuro

| Módulo | Ruta | Backing real (tabla) | Estado | Clasificación |
|---|---|---|---|---|
| Dashboard | `/dashboard` | sí (agrega core) | ✅ funcional | **CORE** |
| Clientes + ficha 360 | `/clients`, `/clients/[id]` | `clients` (+rel) | ✅ funcional | **CORE** |
| Inmuebles | dentro de Gestión | `properties` | ✅ funcional | **CORE** |
| Operaciones / Pipeline | `/opportunities` ("Gestión") | `opportunities` | ✅ funcional | **CORE** |
| Expedientes | ficha / Gestión | `service_cases` | ✅ funcional | **CORE** |
| Tareas | ficha | `tasks` | ✅ funcional | **CORE** |
| Calendario interno | `/calendar` | `calendar_events` | ✅ funcional | **CORE** |
| Actividad | ficha / feeds | `activities` | ✅ funcional | **CORE** |
| Asistente IA | `/assistant` | lee todo + executor | ✅ funcional (OpenAI live) | **CORE diferenciador** |
| **WhatsApp / Inbox** | `/inbox` | ❌ `conversations`/`messages` no existen | ⚠️ **dormante** (vacío/banners) | **FUTURO (oculto recomendado)** |
| **Facturación** | `/billing` | ❌ `invoices` no existe | ⚠️ mock; **ya oculto** (internal) | **FUTURO** |
| **Automatizaciones / n8n** | `/automations` | n8n externo no configurado | ⚠️ **ya oculto** (internal) | **FUTURO/ADDON** |
| **Google Calendar sync** | `/api/integrations/google/*` | OAuth env vacío | ⚠️ dormante | **ADDON opcional** |
| Configuración | `/settings` | sí | ✅ funcional | **CORE** |

> **Regla de límite de módulo:** un módulo solo es "core funcional" si tiene
> tabla real + RLS + UI que lee/escribe datos reales del workspace. Lo demás es
> futuro/addon y **no debe aparecer en la navegación del cliente como si
> funcionara**.

---

## 3. Auditoría de backend

### 3.1 Lo que está SÓLIDO (no tocar)
- **Frontera real/demo (Data Reality Policy):** gate demo-primero antes de tocar
  Supabase en cada página; sin fallback a mock en modo real; empty states
  profesionales. Verificado en dashboard/clients/ficha.
- **RLS por workspace** en las 10 tablas + helpers `current_workspace_ids()`,
  `current_workspace_role()`, `is_workspace_admin()` (SECURITY DEFINER, uso
  intencionado por las políticas).
- **`service_role` solo server-side:** `src/lib/supabase-admin.ts` documentado
  server-only y **fail-safe a `null`** si la key no está (en bundle cliente la
  key no existe → no puede filtrarse). Uso real confinado a route handlers
  (`/api/agent/tool`, `/api/team/*`, documents, webhooks). En `settings`/
  `supabase-queries` solo aparece como texto/comentario.
- **Executor del asistente** (`/api/assistant/confirm`): modelo de confianza
  ejemplar — auth desde cookie (nunca del body), `workspace_id`/`user_id` desde
  `profiles`, `preparedAction` tratado como **hints no confiables** y
  re-validado (allowlist de tipo, `clientId` UUID-en-workspace, parsers ISO
  estrictos de fecha/hora, cap de importe de factura), escritura vía cliente
  cookie-bound → **RLS última línea de defensa**; nunca devuelve el error crudo
  de Supabase. Hook n8n fire-and-forget que no bloquea ni deshace.
- **READ tools** (`/api/agent/tool`): gateadas por `AGENT_TOOL_SECRET`,
  `service_role` server-side, todas `.eq(workspace_id)`.
- **Inbox API** (`/api/inbox/conversations`): aun sin tabla, el handler ya está
  bien diseñado — auth por cookie, `profiles.role` server-side como única señal
  de autorización, filtro `channel='whatsapp'` no eludible por query param.

### 3.2 RIESGOS / deuda (no bloqueantes)
- **R1 — Rutas sin tabla:** `/api/inbox/*` y el action `invoice` del executor
  referencian tablas inexistentes (`conversations`, `invoices`). En real devuelven
  vacío/error controlado (no rompen el CRM), pero son **superficie muerta** que
  confunde y conviene **gatear/ocultar** hasta su fase. (Ver §4 UX.)
- **R2 — Leaked-password-protection OFF** en Supabase Auth (advisor WARN).
  Activar antes de producción cliente final.
- **R3 — `invoice`/`report`/`booking`/`task` legacy** en el executor conviven con
  las acciones RT5.1 nuevas; `invoice` apunta a tabla inexistente. Documentar que
  `invoice` está dormido hasta 2E-4 (no se puede disparar end-to-end sin tabla).

### 3.3 Qué NO tocar
- El agente OpenAI (`nowlabs-main-agent.ts`, ~2k líneas) y la página del
  asistente (~3.4k líneas): alto riesgo/coste, ya funcionan. Solo wiring puntual
  cuando toque (RT5.1b-3).
- Schema/RLS: cambios solo por el flujo de migraciones, nunca desde deploy.

### 3.4 Hardening pequeño recomendado (opcional, no aplicado en esta fase)
- **H1 (recomendado):** ocultar `WhatsApp`/Inbox de la navegación del cliente
  (marcar `internal: true` en `Sidebar.tsx`, como Facturación/Automatizaciones) o
  poner `NEXT_PUBLIC_ENABLE_INBOX=false` en clones, hasta 2E-5. Cambio de 1 línea,
  reversible. **Es decisión de producto/demo → ver §4 y decisión WhatsApp.**
- **H2 (microcopy):** `Calendar` → `Calendario` y `Gestión` → `Operaciones` para
  consistencia es-ES y claridad no técnica. Cambio de labels, bajo riesgo.

---

## 4. Auditoría UX (usuario NO técnico)

Navegación actual del cliente (`NEXT_PUBLIC_NOWLABS_INTERNAL=false`):
`Dashboard · WhatsApp · Clientes · Gestión · Calendar · Asistente IA · Configuración`.

### Hallazgos
1. **WhatsApp visible pero no funcional (alto):** lleva a un inbox sin tabla ni
   Meta configurado → el cliente ve una promesa vacía. **Recomendación H1.**
2. **Labels mixtos idioma/claridad (medio):** `Calendar` (inglés) y `Gestión`
   (vago) frente a una UI por lo demás en es-ES y orientada a inmobiliaria.
   **Recomendación H2.**
3. **Facturación/Automatizaciones (OK):** ya ocultos por `internal`. Correcto.
4. **Densidad general (OK/bajo):** las páginas core (clientes, ficha, operaciones,
   calendario) son razonables; el riesgo no es densidad sino **módulos futuros
   visibles**.

### Principio UX para clones de cliente
- Navegación **mínima por defecto**: solo módulos con backing real.
- Módulos futuros: ocultos por flag hasta que existan (no "coming soon" en la
  barra principal de un cliente que paga).
- Microcopy es-ES, sin jerga técnica; nunca exponer nombres de env/keys (ya
  controlado por `NEXT_PUBLIC_NOWLABS_INTERNAL`).

---

## 5. Conclusión

- El **núcleo del CRM + asistente IA es sólido y seguro** para smoke/staging.
- El trabajo pendiente NO es arreglar el core, sino **definir límites de módulo**
  (billing, storage, inbox/WhatsApp, Google) y **no enseñarlos hasta que sean
  reales**. Las decisiones concretas viven en los `PRODUCT_DECISION_*.md`.
- Hardening sugerido (H1/H2) es opcional, pequeño y reversible; **no se aplicó**
  en esta fase por ser decisión de producto/demo (pendiente de visto bueno de Oier).
