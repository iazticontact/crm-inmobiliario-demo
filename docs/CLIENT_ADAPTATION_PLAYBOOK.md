# Client Adaptation Playbook — NowCRM base

Este documento describe **cómo clonar NowCRM (la base madre) para un cliente real** sin
romper la demo, sin filtrar secretos y sin asumir integraciones que el cliente todavía
no tiene contratadas.

Está pensado para que cualquier persona del equipo NowLabs pueda hacer una adaptación
limpia en una mañana.

> **Importante:** este playbook NO modifica NowCRM madre. Las adaptaciones viven en
> el repo del cliente. La base se actualiza vía rebase periódico.

---

## 1. Modelo mental

NowCRM madre = un **producto base reutilizable**. Cada cliente real es un **fork
ligero** con:

- branding propio (nombre, logo, colores, dominio),
- workspace propio en Supabase Cloud (RLS por workspace_id ya está hecha),
- variables de entorno propias,
- integraciones reales solo donde el cliente las haya contratado,
- módulos del CRM **visibles solo si aplican** (vía feature flags simples).

Nada del código del cliente debería divergir de la base más allá de:
- `src/app/(public)/` (landing y copy específicos),
- `public/` (logos, favicons, OG),
- `.env.local` y variables en Vercel,
- los flags `NEXT_PUBLIC_ENABLE_*`,
- el `workspace_settings` por defecto (vertical, idioma, zona horaria, tono).

Si necesitas cambiar lógica del CRM para un cliente: hazlo en la base madre detrás
de un flag, no como un parche divergente.

---

## 2. Clonado (paso a paso)

1. **Forkea o clona** el repo `nowcrm-demo` a un repo privado nuevo del cliente
   (ej.  `nowcrm-cliente-xxx`).
2. **No copies `.env.local`.** Crea uno nuevo desde `.env.example`
   (ver [`docs/ENVIRONMENT_VARIABLES.md`](./ENVIRONMENT_VARIABLES.md)).
3. **No copies datos reales** ni dumps de Supabase de otro cliente.
4. **Crea un proyecto Supabase Cloud nuevo** para el cliente. NowCRM no comparte
   base de datos entre clientes.
5. **Crea un proyecto Vercel nuevo** apuntando al fork.
6. **Conecta dominio del cliente** vía Cloudflare → Vercel.
7. **Configura las variables de entorno** en Vercel (Production / Preview / Dev
   separados — usa al menos Production y Preview).

---

## 3. Branding

Cambiar siempre, antes de enseñarlo al cliente:

| Sitio | Qué cambiar |
|-------|-------------|
| `src/app/(public)/page.tsx` y similares | Copy de la landing |
| `src/components/Sidebar.tsx` | Texto "NowCRM Pro" → marca del cliente si procede |
| `src/app/layout.tsx` / `metadata` | Título y descripción HTML |
| `public/favicon*`, `public/og*` | Iconos y OG images |
| `tailwind.config` / paleta Tailwind | Colores corporativos si los hay |

> Mantén "NowCRM by NowLabs" como pie de página discreto en clientes white-label
> light. Para white-label total: retira referencias visibles a NowCRM / NowLabs
> en el front, pero **deja los comentarios y nombres de variables en el código**
> — facilita rebases.

---

## 4. Variables de entorno

La lista completa está en [`docs/ENVIRONMENT_VARIABLES.md`](./ENVIRONMENT_VARIABLES.md).

Mínimo viable para un cliente nuevo:

```env
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
NEXT_PUBLIC_APP_URL=https://crm.cliente.com
```

Opcional (cuando esté contratado):
- `OPENAI_API_KEY` para NowLabs AI
- `META_*` para WhatsApp / Instagram cuando Meta esté aprobado
- `N8N_*` cuando el VPS Contabo + n8n del cliente esté listo
- `GOOGLE_*` para Calendar OAuth

---

## 5. Feature flags (módulos visibles)

Ver [`src/lib/feature-flags.ts`](../src/lib/feature-flags.ts).

**Todos los flags están encendidos por defecto.** Para ocultar un módulo en el clone
del cliente, añade `NEXT_PUBLIC_ENABLE_<flag>=false` en Vercel.

| Flag | Default | Qué oculta cuando vale `false` |
|------|:-------:|--------------------------------|
| `NEXT_PUBLIC_ENABLE_BILLING`        | on | Entrada de nav "Facturación" |
| `NEXT_PUBLIC_ENABLE_AUTOMATIONS`    | on | Entrada de nav "Automatizaciones" |
| `NEXT_PUBLIC_ENABLE_INBOX`          | on | Entrada de nav "Inbox" omnicanal |
| `NEXT_PUBLIC_ENABLE_ASSISTANT`      | on | Entrada de nav "Asistente IA" |
| `NEXT_PUBLIC_ENABLE_OPPORTUNITIES`  | on | Entrada de nav "Operaciones" (Vertical Pack) |
| `NEXT_PUBLIC_ENABLE_CALENDAR`       | on | Entrada de nav "Calendario" |
| `NEXT_PUBLIC_ENABLE_INSTAGRAM`      | on | Reservado para Inbox / Settings — gating de UI Instagram |
| `NEXT_PUBLIC_ENABLE_WHATSAPP`       | on | Reservado para Inbox / Settings — gating de UI WhatsApp |
| `NEXT_PUBLIC_ENABLE_DEMO_DATA`      | on | Datos demo (`recentActivity`, `aiInsights`, `weeklyLeads`) |

Notas:

- Los flags **solo ocultan UI**. La seguridad real viene de RLS, sesión y de que
  las claves de integración (Meta, OpenAI, n8n) no estén configuradas. Un módulo
  "oculto" cuya página se visite por URL directa sigue siendo accesible — esto
  es intencional para no bloquear soporte interno.
- **No metas un flag por cada feature pequeña.** Si una sección dentro de
  Settings no aplica, el patrón correcto es desactivarla con `pending_config`
  (sin claves) más que con un flag.

---

## 6. Supabase

1. **Proyecto nuevo** por cliente (no reutilizar Cloud de otro cliente).
2. **Migraciones**: aplica las migraciones del repo en orden. Tras aplicarlas,
   verifica que existen como mínimo `workspaces`, `profiles`, `clients`,
   `conversations`, `messages`, `invoices`, `activities`, `events`,
   `workspace_settings`, `opportunities`, `service_cases`, `properties`.
3. **RLS**: confirma `force_rls = on` en tablas con datos de workspace. Recuerda
   que el service_role necesita política explícita aunque `force_rls=false` no
   esté activado — ver [`docs/SUPABASE_SCHEMA_NOTES.md`](./SUPABASE_SCHEMA_NOTES.md).
4. **Auth**: en Supabase Auth, configura el dominio del cliente como Site URL y
   añade los redirect URLs (`/auth/callback`).
5. **Storage**: si el cliente sube documentos (extranjería, contratos), crea el
   bucket privado correspondiente con política por workspace.
6. **NO** copies usuarios de auth.users entre proyectos.

---

## 7. `workspace_settings` por defecto

Cada workspace puede elegir su vertical y tono. Para un cliente concreto, deja
la fila precargada (vía SQL en su Supabase, no en el repo):

```sql
insert into workspace_settings (workspace_id, vertical, business_name, default_language, timezone, ai_tone)
values ('<uuid del workspace>', 'real_estate', 'Inmobiliaria Cliente SL', 'es', 'Europe/Madrid', 'professional')
on conflict (workspace_id) do nothing;
```

Verticales soportadas hoy: `general`, `real_estate`, `immigration`,
`professional_services`, `mixed`.

---

## 8. Plantillas y automatizaciones

- Plantillas de mensajes viven por workspace en `workspace_templates` (UI:
  Settings → Plantillas).
- Las automatizaciones n8n del repo son **catálogo**, no se importan al cliente
  hasta que tiene n8n. Mientras tanto se muestran como `pending_config`.
- Cuando el VPS n8n del cliente esté listo, configura `N8N_BASE_URL` +
  `N8N_API_KEY` + `N8N_WEBHOOK_SECRET` y los flows pasan a `connected` en
  Settings → n8n.

---

## 9. Google Calendar

1. Crea un proyecto en Google Cloud para el cliente (o reutiliza el de NowLabs si
   el cliente acepta el branding del consentimiento).
2. Credenciales OAuth 2.0 con redirect `https://<dominio-cliente>/api/integrations/google/calendar/callback`.
3. Configura `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`.
4. El cliente conecta su Google desde Settings → Calendar.
5. Sin estas tres, el botón muestra "pendiente configuración" — no rompe nada.

---

## 10. WhatsApp / Instagram (Meta)

**No conectar hasta que:**
- El cliente tenga Business Manager verificado,
- y haya aprobación de plantillas si las va a usar.

Mientras tanto:
- Deja el Inbox visible (default) o ocúltalo con `NEXT_PUBLIC_ENABLE_INBOX=false`.
- Las claves `META_*` no estarán configuradas → outbound se guarda como
  `pending_config` automáticamente. El webhook responde 503 si falta verify
  token. Esto es seguro.

Cuando se conecte:
- Sigue [`docs/META_WHATSAPP_OFFICIAL_SETUP.md`](./META_WHATSAPP_OFFICIAL_SETUP.md).
- Suscribe el número del cliente al webhook NowCRM (`https://<dominio-cliente>/api/integrations/meta/whatsapp/webhook`).

---

## 11. n8n (cuando el VPS esté listo)

Hoy el VPS Contabo NowLabs todavía no está conectado. Mientras tanto:
- `N8N_BASE_URL` vacía → `/api/n8n/trigger` responde `simulated`.
- Las automatizaciones aparecen como `pending_config` en Settings.

Cuando el VPS esté listo (ver [`docs/INFRASTRUCTURE_NOWLABS.md`](./INFRASTRUCTURE_NOWLABS.md)):
1. Levanta n8n en `n8n.nowlabs.es` (subdominio interno NowLabs).
2. Crea un workspace n8n por cliente (carpetas / tags).
3. Configura `N8N_BASE_URL` (la URL pública del VPS, no la IP),
   `N8N_API_KEY`, `N8N_WEBHOOK_SECRET` en Vercel del cliente.
4. Confirma desde `/api/automations/n8n/status`.

> Los clientes **no** tienen acceso al panel de n8n. Solo NowLabs lo opera.

---

## 12. Checklist antes de enseñar al cliente

- [ ] Branding cambiado (logo, título, OG).
- [ ] Variables de Supabase del cliente configuradas en Vercel.
- [ ] `NEXT_PUBLIC_APP_URL` apunta al dominio del cliente.
- [ ] `workspace_settings` con vertical y zona horaria del cliente.
- [ ] Datos demo ocultos si no quieres mostrarlos: `NEXT_PUBLIC_ENABLE_DEMO_DATA=false`.
- [ ] Flags `NEXT_PUBLIC_ENABLE_*` ajustados a lo que el cliente vea.
- [ ] Login real funciona contra la Supabase del cliente.
- [ ] Cuenta de prueba creada con datos genéricos (no datos reales del cliente).
- [ ] Calendar conectado o claramente `pending_config`.
- [ ] WhatsApp / Instagram `pending_config` si no contratado.
- [ ] Build verde en Vercel.

---

## 13. Checklist antes de producción

- [ ] DNS y SSL OK (Cloudflare → Vercel).
- [ ] Supabase Auth con dominio del cliente como Site URL.
- [ ] RLS revisada (`get_advisors` en MCP Supabase).
- [ ] Backups de Supabase activos.
- [ ] `SUPABASE_SERVICE_ROLE_KEY` solo en Vercel server-side env.
- [ ] No hay claves de otro cliente en el deploy.
- [ ] Lint + tsc + build verdes.
- [ ] Datos demo OFF (`NEXT_PUBLIC_ENABLE_DEMO_DATA=false`) si el cliente entra
      a producción.
- [ ] Plantillas Meta aprobadas (si usa WhatsApp).
- [ ] Webhook Meta verificado y firmado.
- [ ] Política de privacidad y términos del cliente publicados.

---

## 14. Qué **NO** copiar al cliente

- `.env.local` de NowLabs.
- Cualquier `SUPABASE_SERVICE_ROLE_KEY` que no sea del proyecto Supabase del cliente.
- `OPENAI_API_KEY` compartida sin acuerdo (cada cliente debería tener su key, o
  facturársele aparte si usa la de NowLabs).
- Datos reales de demos (`Ana Rodríguez`, `Miguel Torres`, etc. son demo y se
  pueden mostrar; cualquier dato proveniente de un cliente real **nunca** debe
  copiarse a otro).
- Documentos internos NowLabs (`DEMO_SCRIPT_ANDREI.md`, fixtures comerciales).

---

## 15. Cuando madre cambia

Para mantener un cliente al día con NowCRM madre:

1. `git remote add base git@github.com:nowlabs/nowcrm.git` (una vez).
2. `git fetch base main`.
3. `git rebase base/main` en una rama de actualización.
4. Resuelve conflictos solo en branding / flags. Si hay conflictos en lógica
   del CRM, **es señal de que el cliente está divergiendo** — abrir PR en madre
   para llevar el cambio allá y volver a rebasar limpio.

---

## 16. Soporte y troubleshooting rápido

- **Dashboard vacío en cliente real** → revisa que `workspace_id` esté seteado
  en el perfil del usuario logueado y que existan filas en sus tablas. Ver
  [`src/app/(saas)/dashboard/page.tsx`](../src/app/(saas)/dashboard/page.tsx).
- **"Modo demo" sale aunque hay usuario real** → el cliente Supabase del
  navegador no se está creando. Revisa `NEXT_PUBLIC_SUPABASE_URL` y la clave
  publishable/anon.
- **Botón "Conectar Google Calendar" no abre OAuth** → falta una de las tres
  `GOOGLE_*` o el redirect no coincide.
- **WhatsApp envía pero no llega** → token caducado, plantilla no aprobada o
  número no suscrito al webhook NowCRM.
- **n8n no responde** → `N8N_BASE_URL` no configurada; el endpoint responderá
  `simulated`, eso no es un bug.
