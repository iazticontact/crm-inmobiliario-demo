> ⚠️ **LEGACY — NO VIGENTE.** Archivado en Fase 1D. Plan de migración ligado a
> la infraestructura antigua (VPS/n8n previos, marca NowCRM) que **ya no se
> reutiliza**. Algunas notas de "listo en código" pueden seguir siendo válidas,
> pero el plan de infraestructura no aplica a la infra nueva.

# Plan de migración a nuevo VPS — n8n + WhatsApp real

Este documento describe el orden quirúrgico para pasar de "todo preparado en
código" a "todo funcionando con infraestructura real". El objetivo es que la
única pieza variable sea la infraestructura externa: NowCRM ya está listo.

## 0. Estado actual (antes de migrar)

**Listo en código:**
- `/api/n8n/trigger` con auth Supabase, allowlist server-side, validación SSRF
  y respuesta sanitizada.
- `/api/integrations/meta/whatsapp/webhook` procesa inbound server-side sin
  `void fetch` ni dependencia de `NEXT_PUBLIC_APP_URL`.
- Helper `src/lib/whatsapp-inbound.ts` con dedupe, lookup por metadata y
  fallback schema-tolerante.
- Outbound persiste `send_status` honesto (`sent`/`failed`/`draft`/`pending_config`).
- Settings consume `/api/config/status` y bloquea auto-reply hasta ready.
- Soporte de mensajes no-texto (audio, imagen, video, ubicación, contactos,
  botones, reacciones) con placeholder en español.

**Pendiente fuera de código:**
- Nuevo VPS instalado con n8n + dominio + HTTPS.
- Migración de workflows del n8n antiguo.
- Cuenta Meta Business real + tokens.
- Variables de entorno en Vercel.
- SQL recomendado aplicado en Supabase.

## 1. Pre-VPS — qué cerrar antes de tocar infraestructura

- [ ] **Commit y push** de la rama `final-functional-polish` a remoto.
- [ ] **Revisión humana** del PR (este informe puede servir de checklist).
- [ ] **Lint/tsc/build verdes** en CI (no solo local).
- [ ] **Backup** del n8n antiguo:
  - [ ] Exportar todos los workflows (n8n → Workflows → ⋮ → Download).
  - [ ] Exportar credentials cifrados (`n8n export:credentials --backup`).
  - [ ] Listar webhooks expuestos públicamente para revisar antes de apagar.
- [ ] **Generar secretos nuevos** para la nueva instalación:
  - [ ] `N8N_ENCRYPTION_KEY` nuevo (32 bytes random).
  - [ ] `N8N_WEBHOOK_SECRET` nuevo (UUID v4).
  - [ ] `META_WEBHOOK_VERIFY_TOKEN` nuevo (UUID v4).
  - [ ] `NOWCRM_WEBHOOK_SECRET` nuevo (UUID v4).
  - Guárdalos en un gestor de secretos (1Password, Bitwarden), nunca en commits.
- [ ] **SQL listo para ejecutar** (ver [WHATSAPP_SCHEMA_RECOMMENDED_SQL.md](WHATSAPP_SCHEMA_RECOMMENDED_SQL.md)):
  - [ ] `ALTER TABLE messages ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT '{}'::jsonb NOT NULL;`
  - [ ] `CREATE INDEX IF NOT EXISTS idx_messages_metadata_external_message_id …`
  - [ ] (opcional) columna dedicada + unique index.
- [ ] **Revisar `whatsapp_connections`** en Supabase:
  - [ ] columna `phone_number_id text` existe.
  - [ ] columna `last_webhook_at timestamptz` existe.

## 2. Día del VPS — orden recomendado

### Paso 1 — Servidor + Docker (≈ 30 min)

- [ ] VPS con Ubuntu 22.04 LTS o similar.
- [ ] Firewall: solo `22/tcp` (SSH), `80/tcp` y `443/tcp`. Bloquear `5678`.
- [ ] Usuario no-root para todo.
- [ ] Docker + docker-compose instalados.
- [ ] `unattended-upgrades` activo.

### Paso 2 — n8n con Postgres + reverse proxy (≈ 1h)

- [ ] `docker-compose.yml` con:
  - n8n (image `n8nio/n8n:latest` o pin de versión).
  - Postgres 16 para n8n.
  - Caddy / Traefik / nginx-proxy como reverse proxy con Let's Encrypt.
- [ ] Variables de entorno n8n:
  - `N8N_HOST=n8n.tu-dominio.com`
  - `N8N_PROTOCOL=https`
  - `WEBHOOK_URL=https://n8n.tu-dominio.com/`
  - `N8N_PORT=5678`
  - `N8N_ENCRYPTION_KEY=<el-nuevo>`
  - `DB_TYPE=postgresdb`, `DB_POSTGRESDB_*` apuntando al postgres del compose.
  - `N8N_BASIC_AUTH_ACTIVE=true` con usuario/contraseña iniciales.
- [ ] DNS A record `n8n.tu-dominio.com → IP del VPS`.
- [ ] Verificar HTTPS válido (`curl -I https://n8n.tu-dominio.com`).
- [ ] Login en n8n y crear cuenta admin definitiva.

### Paso 3 — Importar workflows del n8n antiguo (≈ 30–60 min)

- [ ] Subir el JSON exportado y importar uno a uno.
- [ ] En cada workflow:
  - Comprobar que el path del webhook coincide con un slug allowlisted en
    `EVENT_TO_WORKFLOW_SLUG` (ver [N8N_PAYLOAD_CONTRACT.md](N8N_PAYLOAD_CONTRACT.md)).
  - Si el path antiguo no coincide, renombrar en n8n para que coincida con
    NowCRM (es la forma menos peligrosa: solo cambia n8n, no NowCRM).
  - Añadir un nodo IF al inicio que valide
    `$json.headers['x-nowcrm-secret'] === $vars.NOWCRM_WEBHOOK_SECRET`,
    responda 401 si no.
- [ ] Recrear credentials a mano (no importar del backup antiguo si las claves
      pueden estar comprometidas).
- [ ] **No activar** todavía los workflows. Mantenerlos en draft.

### Paso 4 — Variables en NowCRM/Vercel (≈ 15 min)

- [ ] En Vercel → Project Settings → Environment Variables (Production y Preview):
  - `N8N_BASE_URL=https://n8n.tu-dominio.com`
  - `N8N_API_KEY=<API key generada en n8n Settings>`
  - `N8N_WEBHOOK_SECRET=<el-nuevo>`
  - `META_WHATSAPP_ACCESS_TOKEN=<System User token>`
  - `META_APP_SECRET=<App Secret de Meta Developers>`
  - `META_WEBHOOK_VERIFY_TOKEN=<el-nuevo>`
  - `NOWCRM_WEBHOOK_SECRET=<el-nuevo>`
  - (mantén las de Supabase, OpenAI, Google ya existentes)
- [ ] Redeploy de Vercel.
- [ ] Verificar `/api/config/status` logueado: `meta.status='ready'`, `n8n.status='ready'`.

### Paso 5 — Primer trigger n8n desde NowCRM (≈ 15 min)

- [ ] Activar un workflow trivial en n8n (p.ej. `test-flow` que solo responda
      `{"ok": true, "executionId": "..."}`).
- [ ] Desde NowCRM → Settings → "Probar n8n" o desde `/automations`.
- [ ] Verificar:
  - Respuesta `status:'ok'`.
  - Log servidor: `[n8n/trigger]` con `http_status:200` y `workflow_slug:'test-flow'`.
  - Log n8n: el header `x-nowcrm-secret` llegó correcto.

### Paso 6 — Meta WhatsApp real (≈ 1h)

Seguir [META_WHATSAPP_SETUP_STEP_BY_STEP.md](META_WHATSAPP_SETUP_STEP_BY_STEP.md) **íntegro**, especialmente:

- [ ] Webhook registrado contra `https://tu-vercel.app/api/integrations/meta/whatsapp/webhook`.
- [ ] Verify GET responde con `hub.challenge`.
- [ ] Suscripción a campo `messages`.
- [ ] Workspace en NowCRM con `phone_number_id` correcto.

### Paso 7 — Primer mensaje real (15 min)

- [ ] Enviar mensaje desde un móvil al test number de Meta.
- [ ] Verificar logs servidor:
  - `[meta/webhook] POST received` con `hasSignature:true`.
  - `[meta/webhook] persisted batch` con `inserted:1`.
- [ ] Verificar Inbox: conversación nueva con tu nombre y mensaje.
- [ ] Verificar Settings → WhatsApp: `lastWebhookAt` actualizado.

### Paso 8 — Primer outbound real (15 min)

- [ ] En Inbox, escribir respuesta y pulsar **Enviar**.
- [ ] Verificar:
  - Mensaje aparece con badge "Enviado".
  - `metadata.provider_message_id` (wamid) presente.
  - Llega al móvil del usuario.

### Paso 9 — Activar workflows n8n reales (uno a uno)

- [ ] Para cada workflow, activar y probar con un evento real (factura, lead, etc.).
- [ ] Verificar idempotencia: disparar dos veces, no duplica efecto.
- [ ] Verificar errores: workflow que falla NO deja NowCRM en estado inconsistente.

### Paso 10 — Apagar n8n antiguo (solo después de validar el nuevo)

- [ ] Migrar cualquier webhook externo (Stripe, Calendly, etc.) al nuevo dominio.
- [ ] DNS antiguo → null o redirect 410.
- [ ] Apagar el VPS antiguo.
- [ ] Borrar tokens del antiguo de cualquier gestor de secretos.

## 3. Post-migración

- [ ] Activar `inbox_agent_settings.auto_reply_enabled` por workspace solo
      cuando el equipo del cliente lo pida y se haya probado manualmente
      durante al menos 1 semana.
- [ ] Considerar conectar **n8n MCP** (model-context-protocol) — solo después
      de tener varias semanas de uso estable.
- [ ] Considerar añadir rate-limit a `/api/n8n/trigger` por workspace
      (middleware Vercel Edge o similar).
- [ ] Considerar persistir el wamid de outbound en una tabla aparte
      (`outbound_message_status`) para tracking de delivered/read.

## 4. Checklist post-VPS (pruebas reales)

Cada una de estas pruebas debe pasar **antes** de declarar producción:

- [ ] Inbound texto: aparece en Inbox.
- [ ] Inbound audio: aparece en Inbox con texto `[nota de voz]`.
- [ ] Inbound imagen: aparece en Inbox con texto `[imagen] caption…`.
- [ ] Inbound ubicación: aparece con `[ubicacion: nombre - dirección]`.
- [ ] Dedupe: mismo `externalMessageId` dos veces → solo un mensaje.
- [ ] Phone link: mensaje de número que coincide con cliente → conversación
      ligada automáticamente al cliente.
- [ ] Outbound texto: enviado correctamente, badge "Enviado", wamid presente.
- [ ] Outbound con cliente sin teléfono: 400, badge "Fallido", razón clara.
- [ ] Outbound sin token Meta: badge "Pendiente config", **no** mintiendo "sent".
- [ ] Auto-reply OFF: enviar texto manual no dispara IA automática.
- [ ] n8n trigger con sesión: respuesta `ok` o `simulated`.
- [ ] n8n trigger sin sesión: 401.
- [ ] n8n trigger con `webhook_url: attacker.example.com` en body: IGNORADO.
- [ ] n8n trigger con event_type fuera del allowlist: 400.

## 5. Lo que NO se debe hacer durante la migración

- ❌ Conectar n8n MCP antes de validar todos los workflows.
- ❌ Activar workflows reales sin haber probado primero el header `x-nowcrm-secret`.
- ❌ Reutilizar el `N8N_ENCRYPTION_KEY` antiguo si el VPS antiguo ha estado
      expuesto a más administradores de los que confías ahora.
- ❌ Reutilizar `META_APP_SECRET` antiguo si la App de Meta también es nueva.
- ❌ Activar auto-reply automáticamente en todos los workspaces — debe ser
      opt-in por workspace.
- ❌ Borrar el VPS antiguo el mismo día que se monta el nuevo. Dejar 7 días
      en paralelo para volver atrás si algo se rompe.
