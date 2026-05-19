# Infraestructura NowLabs — arquitectura objetivo

Documento de referencia: **dónde corre cada cosa**, **qué se aloja en cada
servicio** y **qué se prohíbe explícitamente** en cada uno. Es el mapa que
seguimos al adaptar NowCRM a un cliente real.

> Estado: las apps ya corren en Vercel y Supabase. El VPS Contabo está en
> configuración paralela; n8n no está conectado en producción todavía. Meta y
> Google se conectan por cliente cuando contratan.

---

## 1. Mapa general

```
   ┌──────────────────────────────┐        ┌──────────────────────────────┐
   │     Cloudflare (DNS/SSL)     │        │          Vercel              │
   │  panel.nowlabs.es            │        │  - NowCRM (Next.js app)      │
   │  app.cliente.com             │ ───►   │  - landings / micrositios    │
   │  n8n.nowlabs.es              │        │  - APIs Next route handlers  │
   │  hooks.nowlabs.es            │        │  - cron lightweight          │
   │  status.nowlabs.es           │        └─────────────┬────────────────┘
   └──────────────┬───────────────┘                      │
                  │                                      │ Service role +
                  │                                      │ RLS por workspace
                  ▼                                      ▼
   ┌──────────────────────────────┐        ┌──────────────────────────────┐
   │      VPS Contabo (NowLabs)   │        │      Supabase Cloud          │
   │  - n8n (orquestación)        │ ◄────► │  - Postgres + RLS            │
   │  - webhooks privados         │        │  - Auth                      │
   │  - monitorización (uptime)   │        │  - Storage (documentos)      │
   │  - cron jobs pesados         │        │  - Edge Functions (futuras)  │
   │  - backups Supabase off-site │        └─────────────┬────────────────┘
   └──────────────┬───────────────┘                      │
                  │                                      │
                  ▼                                      ▼
   ┌──────────────────────────────────────────────────────────────────┐
   │              APIs externas (cuenta NowLabs o cliente)            │
   │  - Meta Graph (WhatsApp / Instagram)                             │
   │  - Google Calendar OAuth                                         │
   │  - OpenAI (NowLabs AI)                                           │
   │  - Stripe (cuando se conecte billing real)                       │
   └──────────────────────────────────────────────────────────────────┘
```

---

## 2. Subdominios NowLabs

| Subdominio | Apunta a | Para qué |
|------------|----------|----------|
| `panel.nowlabs.es` | Vercel | Demo madre NowCRM y backoffice interno |
| `n8n.nowlabs.es` | VPS Contabo | Panel n8n privado (solo NowLabs) |
| `hooks.nowlabs.es` | VPS Contabo | Webhooks entrantes públicos hacia n8n |
| `status.nowlabs.es` | VPS Contabo o página estática | Uptime y health checks |
| `app.<cliente>.com` | Vercel (deploy del fork del cliente) | CRM del cliente |
| `crm.<cliente>.com` | Vercel (alias) | Alternativa cuando el cliente prefiere `crm.` |

Cloudflare gestiona DNS + SSL + WAF básico para todo. Cuentas Vercel y
Supabase del cliente pueden ser propias del cliente (recomendado) o de NowLabs
(modelo gestionado).

---

## 3. Qué va en cada sitio

### Vercel
- Apps **Next.js** (NowCRM y futuros productos NowLabs).
- Endpoints `app/api/*` (route handlers).
- Lógica de UI, OAuth callbacks de Google, webhook receiver de Meta.
- Variables de entorno **por entorno** (Production / Preview / Development).
- Imágenes optimizadas y CDN global automáticamente.

### Supabase Cloud
- Postgres con RLS por `workspace_id`.
- `auth.users` y `profiles`.
- Tablas core CRM (`clients`, `conversations`, `messages`, `invoices`,
  `activities`, `events`, `opportunities`, `service_cases`, `properties`,
  `workspace_settings`, `workspace_templates`).
- Storage para documentos del cliente (expedientes extranjería, contratos
  inmobiliarios) con políticas por workspace.
- Backups gestionados por Supabase + dump diario adicional al VPS (paso 6).

### VPS Contabo (NowLabs)
- **n8n self-hosted** detrás de Nginx + Cloudflare (autenticación básica + IP
  allowlist para el panel).
- **Webhooks privados** que no pueden vivir en Vercel (long-poll, conexiones
  persistentes, jobs > 60s).
- **Monitorización**: uptime-kuma o equivalente con alertas a Slack/email
  NowLabs.
- **Cron jobs pesados** (resúmenes IA semanales, batch de scoring).
- **Backups off-site** del Supabase de cada cliente (`pg_dump` diario cifrado).
- **Logs centralizados** de n8n y aplicaciones NowLabs (no de clientes).

### APIs externas
- Cuentas propias del cliente cuando es posible (Meta Business, Google Cloud,
  Stripe del cliente).
- Cuenta NowLabs cuando el cliente prefiere modelo "todo gestionado"
  (típicamente OpenAI vía NowLabs API key).

---

## 4. Qué **no** va en cada sitio

### En Vercel **no** va
- Servicios long-running (excede los 60s de los route handlers serverless).
- n8n.
- Postgres ni almacenamiento de archivos.
- Cron pesado (el cron de Vercel se reserva a tareas ≤ 10s).
- Datos persistentes que no sean a Supabase.

### En Supabase **no** va
- Código de orquestación (ese va en Vercel o n8n).
- Secretos de cliente final (Meta tokens, Google tokens) en plain text — usar
  Vault/encrypted columns donde se requiera.

### En el VPS **no** va
- Datos de clientes en BD propia. El Postgres del cliente vive en Supabase
  Cloud, **no** en el VPS.
- El frontend del CRM (lo sirve Vercel).
- Acceso del cliente. Los clientes **nunca** ven el VPS ni su n8n.

---

## 5. Modelo de clientes en n8n

- Un único n8n **central** en `n8n.nowlabs.es` opera para todos los clientes.
- Cada cliente es una **carpeta + prefijo de tag** (`cliente_xxx_*`).
- Cada workflow se llama `cliente_xxx_<evento>`.
- Credentials separadas por cliente; nunca compartir credentials entre clientes.
- Los webhooks de cada cliente tienen su propio path
  (`/webhook/cliente_xxx_<event>`).
- `N8N_WEBHOOK_SECRET` (en NowCRM del cliente) firma cada llamada saliente; n8n
  rechaza llamadas sin la firma.

Cuando un cliente crece tanto que necesita su propio n8n, lo migramos a un
VPS separado, mismo modelo.

---

## 6. Backups

| Capa | Quién hace el backup | Dónde se guarda | Retención |
|------|----------------------|-----------------|-----------|
| Supabase (BD) | Supabase Cloud | Servicio Supabase | 7-30 días según plan |
| Supabase (BD) | Cron en VPS | Bucket S3 cifrado (`backups.nowlabs.es`) | 90 días |
| n8n (workflows) | Cron en VPS | Mismo bucket | 90 días |
| Vercel | n/a (código vive en GitHub) | GitHub privado | Indefinido |
| Storage Supabase | Cron en VPS | Bucket S3 cifrado | 30 días |

Restore drill: una vez por trimestre, restaurar un backup en una Supabase de
prueba y verificar que la app sigue arrancando contra él.

---

## 7. Monitorización y alertas

- **Vercel**: alertas nativas (error rate, build failures) → email NowLabs.
- **Supabase**: dashboard + `mcp__claude_ai_Supabase__get_advisors` periódico
  para detectar problemas de seguridad/perf.
- **VPS / n8n**: uptime-kuma con checks HTTP cada minuto contra
  `panel.nowlabs.es`, `hooks.nowlabs.es`, `app.<cliente>.com`. Alertas a Slack
  y email.
- **Apps cliente**: cada NowCRM cliente expone `/api/config/status`
  (autenticado). El cron del VPS pinguea con una cuenta dedicada y verifica
  que los flags esperados estén en `true`.
- **Logs**: lo mínimo en Vercel; el resto en VPS (loki / journald). Nunca logs
  con tokens.

---

## 8. Seguridad

- **Service role de Supabase**: solo en variables server-side de Vercel. Nunca
  en cliente, nunca en VPS expuesto.
- **n8n panel**: detrás de IP allowlist + auth. Cloudflare en modo "I'm under
  attack" en caso de incidente.
- **Webhooks Meta**: validados con `META_APP_SECRET` (HMAC). Sin la app
  secret, NowCRM rechaza con 503.
- **Webhooks salientes a n8n**: firmados con `x-nowcrm-secret` =
  `N8N_WEBHOOK_SECRET`. n8n los valida antes de procesar.
- **`SUPABASE_SERVICE_ROLE_KEY`** rotada al menos cada 90 días o ante salida
  de personal con acceso.
- **Auditoría**: cada workflow n8n loguea `cliente_xxx_*` en una tabla
  central; las llamadas críticas (envío de WhatsApp, creación de factura)
  generan `activities` en Supabase.

---

## 9. Costes externos (orden de magnitud)

| Servicio | Coste mensual aproximado |
|----------|--------------------------|
| Vercel (Pro)               | ~$20–60 / mes según teams |
| Supabase Cloud (Pro)       | $25 por proyecto activo + storage |
| Cloudflare                 | Plan gratuito + Pro $20 si se quiere WAF avanzado |
| VPS Contabo (n8n + cron)   | ~$10–30 / mes |
| OpenAI (NowLabs AI)        | variable — capear con budget mensual y rate-limit |
| Meta (WhatsApp Cloud API)  | conversaciones según volumen, plantillas gratis |
| Google Cloud (Calendar)    | gratuito en escala NowLabs |

Cada cliente paga su propio Supabase + Vercel salvo modelo gestionado, donde
NowLabs factura una cuota fija que incluye infraestructura.

---

## 10. Flujo de despliegue

```
  Local (Cursor / VS Code)
        │
        │ git push
        ▼
   GitHub (repo base / fork cliente)
        │
        │ Vercel detecta push
        ▼
   Vercel build & deploy
        │
        ▼
  Producción (panel.nowlabs.es o app.<cliente>.com)

  Cambios en n8n se hacen siempre en el panel n8n y se exportan a JSON
  al repo `nowlabs-n8n-flows` para revisión y backup.
```

- Cada PR a `main` lanza preview en Vercel.
- Merges a `main` despliegan a producción.
- n8n no toca el flujo de Vercel — se opera aparte.

---

## 11. Estado actual (revisar al cierre de fase)

- [x] Vercel: NowCRM madre desplegado en `panel.nowlabs.es` (demo).
- [x] Supabase Cloud: proyecto base NowCRM con RLS, workspaces y verticales.
- [x] Cloudflare: DNS y SSL para subdominios NowLabs.
- [ ] VPS Contabo: configurado, **n8n todavía no conectado a NowCRM real**.
- [ ] `status.nowlabs.es`: pendiente publicar dashboard público.
- [ ] Backups off-site Supabase: pendiente cron en VPS.
- [ ] Plantillas Meta WhatsApp: por cliente, gestión manual hasta tener
      pipeline propio.

Cuando estos elementos estén marcados, se considera que la infraestructura está
en "estado producción" para empezar a onboardar clientes en serio.
