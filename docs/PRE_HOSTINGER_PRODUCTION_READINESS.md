# Pre-Hostinger — Production readiness (auditoría, sin desplegar)

**Fecha:** 2026-06-15 · **Base:** `c93e32a` · **NO se ha desplegado nada.**

> **Actualización 2026-06-15 (post-smoke `ebbf56b`):**
> - `OPENAI_API_KEY` **real ya añadida** por Oier (resuelve el bloqueante del
>   smoke automático); `AGENT_TOOL_SECRET` reforzado. → asistente IA probable
>   end-to-end (pendiente smoke navegador).
> - **Estrategia de despliegue detallada:** ver
>   [STAGING_HOSTINGER_STRATEGY.md](STAGING_HOSTINGER_STRATEGY.md)
>   (recomendación: **Hostinger VPS Ubuntu + Node LTS + PM2 + Nginx + SSL**).
> - **Runbook EasyPanel paso a paso (2026-06-16):**
>   [EASYPANEL_STAGING_DEPLOYMENT_RUNBOOK.md](EASYPANEL_STAGING_DEPLOYMENT_RUNBOOK.md)
>   — Nixpacks + Node 20 + `next start`, envs, Auth redirects, smoke, rollback.
>   GRANTs + tablas del asistente ya aplicados en `ylhdbawrllqygfvllhdo`.
> - **Antes de cliente final:** ocultar módulos sin backing (`WhatsApp`/Inbox,
>   `Facturación` ya oculta), activar leaked-password-protection en Supabase Auth.
>   Ver [PRODUCT_ARCHITECTURE_AUDIT.md](PRODUCT_ARCHITECTURE_AUDIT.md).

## 1. Estado actual
CRM Next.js 16.2.4 (Turbopack) + Supabase (proyecto `crm-inmobiliario-demo`,
RLS) + agente IA OpenAI. Lectura real cableada (dashboard/clientes/ficha/
operaciones/calendario/asistente), mutaciones controladas (RT4.x), executor del
asistente para 6 acciones CRM (RT5.1). `npm run build` ✅ (46 rutas).

## 2. Qué está listo
- Build de producción verde; tsc/lint verdes.
- RLS por workspace; aislamiento de datos; sin service_role en frontend.
- Demo offline preservada y separada del modo real (Data Reality Policy).
- Política anti-invención en el asistente.

## 3. Qué NO está listo (pre-deploy)
- **Asistente IA (estado actual):** ya disparan por chat (preparar→confirmar→RLS)
  create_operation, create_service_case (RT5.1b), y move_operation_stage,
  update_task, update_service_case (RT5.1b-2). **Pendiente (RT5.1b-3):**
  update_calendar_event (reprogramar) + due_date/assigned_to por chat.
- Storage/documents, RAG, billing real, inbox real, WhatsApp/Meta, Google
  Calendar OAuth: **no son producción** (futuro).
- Smoke test en navegador contra el Supabase de producción: pendiente (Oier).

## 4. Variables de entorno (NOMBRES, sin valores)
Server + cliente (las `NEXT_PUBLIC_*` se inlinean en build):
- `NEXT_PUBLIC_SUPABASE_URL` (requerida)
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (requerida; o `NEXT_PUBLIC_SUPABASE_ANON_KEY`)
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` (requerida si no hay publishable)
- `SUPABASE_SERVICE_ROLE_KEY` (**solo server**; requerida por `/api/agent/tool`,
  `/api/team/*`, admin)
- `OPENAI_API_KEY` (requerida para el asistente IA) · `OPENAI_ASSISTANT_MODEL`
  (opcional, default gpt-4o-mini) · `OPENAI_AGENT_ENABLED` (opcional)
- `AGENT_TOOL_SECRET` (**solo server**; gate de `/api/agent/tool`)
- `NEXT_PUBLIC_APP_URL` (URL pública del despliegue)
- `NODE_ENV=production`
- Flags opcionales: `NEXT_PUBLIC_ENABLE_DEMO_DATA` (default off en cliente real),
  `NEXT_PUBLIC_FORCE_OFFLINE_DEV` (NO en prod), `NEXT_PUBLIC_NOWLABS_INTERNAL`,
  `NEXT_PUBLIC_SHOW_DEBUG_PANEL` (off en prod)
- **Opcionales / futuras (no listas; dejar sin configurar si no se usan):**
  `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` (Google
  Calendar — futuro); `N8N_BASE_URL`, `N8N_WEBHOOK_SECRET`, `NOWCRM_WEBHOOK_SECRET`
  (n8n — futuro); Meta/WhatsApp (futuro).

> Nunca commitear valores. `.env.local` está gitignored (verificado: no trackeado).

## 5. Build / start
- Instalar: `npm ci` (o `npm install`).
- Build: `npm run build` (Next 16 Turbopack).
- Start: `npm run start` (`next start`, sirve `.next`).
- Node: usar la versión LTS del runtime (mismo major usado en dev). PM2/servicio
  systemd recomendado en VPS para `npm run start`.

## 6. Checklist ANTES de subir
- [ ] Crear `.env` en el servidor con TODAS las variables §4 (valores de prod).
- [ ] `NEXT_PUBLIC_SUPABASE_URL` apunta a `ylhdbawrllqygfvllhdo` (no legacy).
- [ ] `NEXT_PUBLIC_ENABLE_DEMO_DATA=false`, `NEXT_PUBLIC_FORCE_OFFLINE_DEV` ausente.
- [ ] `SUPABASE_SERVICE_ROLE_KEY` y `AGENT_TOOL_SECRET` solo en el server.
- [ ] `npm run build` verde en el servidor.
- [ ] Supabase: RLS ON en todas las tablas; políticas revisadas; auth URLs
      (Site URL / redirect) apuntando al dominio de prod.
- [ ] No subir: `.env*`, `.mcp.json`, `node_modules`, `.next` (build en server),
      `memory/`, secretos.

## 7. Checklist DESPUÉS de subir
- [ ] App levanta sin errores en logs.
- [ ] Login owner real funciona.
- [ ] Dashboard/clientes/operaciones cargan datos reales (no demo).
- [ ] Crear/editar tarea/operación/expediente/evento desde la ficha funciona.
- [ ] Asistente responde con datos reales; sin errores RLS; sin UUIDs.
- [ ] Botón "Ver demo inmobiliaria" sigue funcionando (demo offline).

## 8. Seguridad (estado verificado)
- **Sin service_role en frontend** (scan: en `settings`/comentarios solo aparece
  el *nombre* en textos de ayuda; uso real solo en route handlers server).
- Ref legacy `ktsgfukjgldeylfzrayr` ausente de `.env.local`.
- `.env.local` y `.mcp.json` gitignored / no trackeados.
- READ tools del agente gateadas por `AGENT_TOOL_SECRET`; CONFIRM con sesión real.

## 9. Supabase / RLS
RLS ON; aislamiento por workspace en todas las queries (`.eq('workspace_id')` +
políticas). Triggers `enforce_member_refs` validan `assigned_to`. No aplicar
migraciones desde el deploy; los cambios de schema van por el flujo de migraciones.

## 10. Smoke test producción (resumen)
Tras deploy: login real → dashboard → ficha cliente (crear/editar) → asistente
(consultas reales) → logout → demo. Sin datos inventados, sin errores RLS.

## 11. Rollback
- Mantener el commit/tag previo desplegable (`git`); para revertir, `git checkout`
  del commit estable + `npm ci && npm run build && npm run start` (o recargar el
  servicio PM2/systemd con el build anterior).
- No hay migraciones destructivas en este corte; el rollback de código no
  requiere rollback de DB.

## 12. Riesgos
- Rendimiento dev en Windows/OneDrive (no afecta a prod en VPS Linux).
- RT5.1b conversacional pendiente (no bloquea deploy del resto).
- Integraciones externas (Google/n8n/WhatsApp) marcadas como futuras: dejar sus
  envs sin configurar evita exposición accidental.

## 13. Recomendación final
**LISTO PARA STAGING** (VPS/Hostinger en entorno de pruebas con Supabase de
producción y `.env` server) para validar el flujo real end-to-end del CRM.
Para producción "cliente final": completar smoke test en navegador y decidir si
RT5.1b conversacional es bloqueante para la propuesta de valor del asistente
(el resto del CRM ya es operativo).

---

## N3 — Asistente conectado a n8n Agent V2 · 2026-06-20
El asistente del CRM usa el **n8n Agent V2** como cerebro (read-only), no el V1.
**Antes de desplegar a producción**, definir en el CRM (server-side, NO `NEXT_PUBLIC_`):
`N8N_ASSISTANT_V2_WEBHOOK_URL`, `N8N_ASSISTANT_V2_SECRET` (= el de n8n) y opcional
`ASSISTANT_PROVIDER=n8n`. El workflow n8n debe estar **activo**. Sin estas vars,
`/api/assistant/v2` responde "El agente todavía no está configurado" (sin caer al V1).
Cambió runtime → **requiere redeploy**. Ver `PHASE_N3_CONNECT_CRM_TO_N8N_AGENT_V2_REPORT.md`.

---

## N4 — memoria + cobertura del agente · 2026-06-21
Añade migración `20260621_n4_assistant_agent_memory` (memoria de trabajo, RLS) y toca
runtime (`/api/assistant/v2`, `/api/agent/tool`) → **requiere redeploy del CRM**. La tabla
guarda SOLO referencias (sin PII). `lead_score` queda fuera del alcance del LLM. Confirmar
tras desplegar: memoria de hilo, búsqueda por texto en `crm_read_query`, y que el agente
rehúsa mostrar lead score. Ver `PHASE_N4_AGENT_V2_PRO_MEMORY_AND_FULL_CRM_INTELLIGENCE_REPORT.md`.
