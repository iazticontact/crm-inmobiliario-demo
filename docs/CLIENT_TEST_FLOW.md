# NowCRM — Flujo de Prueba como Cliente Nuevo

Guia para verificar que todo funciona registrandose como cliente real.
Fecha de referencia: mayo 2026.

---

## Estado actual por modulo

| Modulo | Estado | Requiere |
|---|---|---|
| Registro y auth | Funciona si el trigger SQL esta aplicado | SQL: `handle_new_user` trigger |
| Dashboard | Funciona con workspace real | workspace_id valido |
| Clientes | Funciona | workspace_id valido |
| Facturacion | Funciona | workspace_id valido |
| Calendario | Funciona (datos locales) | workspace_id valido |
| NowLabs AI (Assistant) | Funciona | OPENAI_API_KEY en servidor |
| Inbox | Funciona (simulacion) | workspace_id valido |
| WhatsApp real | Pendiente | Meta Business + Phone Number ID + token |
| Google Calendar sync | Parcial — OAuth UI activo | GOOGLE_CLIENT_ID/SECRET + tabla |
| Automatizaciones n8n | Pendiente | N8N_BASE_URL + workflows reales |
| PDFs/Documentos | Funciona | workspace_id valido |

---

## SQL previo obligatorio

Antes de registrarte, asegurate de que estas migraciones estan aplicadas en Supabase:

1. **Trigger de auto-provisioning** (`handle_new_user`) — ver `docs/INTEGRATIONS_SCHEMA_PLAN.md`
2. **Tablas**: `workspaces`, `profiles`, `clients`, `invoices`, `calendar_events`,
   `conversations`, `messages`, `activities`, `n8n_flows`, `integrations`
3. **Columnas extra de `whatsapp_connections`**: `phone_number_id`, `whatsapp_business_account_id`, `meta_business_id`
4. **RLS activo** en todas las tablas anteriores

Si no se aplica el trigger, el registro crea usuario en auth.users pero no crea
profile ni workspace. El dashboard quedara vacio y Settings mostrara el error
"Conecta tu cuenta para acceder a la configuracion completa de integraciones".

---

## Paso 1 — Crear cuenta nueva

1. Ve a `/login` (o `/register` si existe).
2. Introduce email y contrasena.
3. Confirma el email si hay email de confirmacion activo
   (requiere Resend o SMTP configurado, o desactivar "Confirm email" en Supabase Auth).
4. Seras redirigido a `/dashboard`.

**Que debe pasar:**
- Se crea un registro en `auth.users`.
- El trigger `handle_new_user` crea automaticamente un `workspace` y un `profile`.
- `/dashboard` muestra el workspace con datos vacios (0 clientes, 0 facturas, etc.).

**Errores posibles:**
- "Profile not found" → el trigger no esta aplicado. Aplica la migracion de `handle_new_user`.
- Redirigido a `/login` en bucle → email no confirmado. Revisa Supabase Auth settings.
- Dashboard con datos de otro workspace → problema de RLS. Revisa politicas de Supabase.

---

## Paso 2 — Explorar Dashboard

1. Comprueba que el nombre del workspace es correcto (derivado de tu email o metadata).
2. Los KPIs deben mostrar 0 clientes, 0 facturas, 0 eventos.
3. Las graficas pueden estar vacias — es correcto para un workspace nuevo.

**Logs a mirar:**
- Supabase → Table Editor → `profiles` → busca tu user id.
- Supabase → Table Editor → `workspaces` → busca el nombre creado.

---

## Paso 3 — Ir a Settings

1. Ve a `/settings`.
2. El badge superior debe mostrar "Persistente" (si el workspace se resolvio) o "Local" (si no hay workspace).
3. El bloque "Workspace" debe mostrar tu email y el nombre del workspace.

**Que deberias ver:**
- **Plataforma IA**: "Activo" → correcto, IA gestionada por NowCRM.
- **Infraestructura**: "Variables detectadas" si Supabase esta configurado.
- **Google Calendar**: "No configurado" → pendiente de OAuth.
- **WhatsApp Business**: "No configurado" → pendiente de Meta.
- **Automatizaciones**: flujos en estado "Demo" o "Pendiente config".

---

## Paso 4 — Ver estado de IA

1. En Settings → Plataforma IA.
2. Debes ver: "NowLabs AI: Activo", "Automatizaciones: Configurable", "Mantenimiento: Incluido".
3. No se pide ninguna clave de OpenAI. Es correcto.

---

## Paso 5 — Ver WhatsApp pendiente

1. En Settings → WhatsApp Business.
2. Estado: "No configurado".
3. La URL de webhook de NowCRM debe estar visible:
   `https://tu-dominio.com/api/integrations/meta/whatsapp/webhook`
4. Si la URL muestra `localhost:3000`, es porque `NEXT_PUBLIC_APP_URL` no esta configurado.
   Anadelo en `.env.local`: `NEXT_PUBLIC_APP_URL=https://tu-dominio.com`

---

## Paso 6 — Ver Google Calendar pendiente

1. En Settings → Google Calendar.
2. Estado: "No configurado".
3. El boton "Conectar con Google Calendar" esta activo (si tienes sesion real).
4. En modo demo, el boton esta deshabilitado — es correcto.

---

## Paso 7 — Conectar Google Calendar (si las envs existen)

Requisito: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` en `.env.local`.

1. Pulsa "Conectar con Google Calendar".
2. Se abre la pantalla de autorizacion de Google.
3. Selecciona tu cuenta Google y acepta los permisos.
4. Seras redirigido a `/settings?integration=google_calendar&status=pending`.

**Estado actual:**
- El callback recibe el `code` de Google correctamente.
- El intercambio de tokens esta documentado pero no activado (requiere implementar
  el bloque comentado en `/api/integrations/google/calendar/callback/route.ts`).
- El estado resultante sera "pending" hasta que se complete la implementacion.
- Mostrara toast: "Google Calendar pendiente — La conexion OAuth esta en proceso de configuracion."

**Para activar completamente:**
- Descomentar el bloque `TODO (production)` en `callback/route.ts`.
- Aplicar la tabla `google_calendar_connections` con columnas `refresh_token_enc`.
- Implementar cifrado del refresh token antes de guardarlo.

---

## Paso 8 — Configurar WhatsApp Meta (si tienes Phone Number ID)

Requisito: acceso a Meta for Developers y un numero verificado.

1. En Settings → WhatsApp Business, introduce:
   - Numero de telefono: `+34 600 000 000`
   - Phone Number ID: el que ves en Meta Developers
   - WABA ID: el ID de tu WhatsApp Business Account
2. Pulsa "Preparar WhatsApp".
3. El estado cambia a "Preparado · pendiente Meta" o "Pendiente webhook Meta".
4. Copia la URL de webhook de NowCRM y pegala en Meta Developers → Webhook.
5. Pide al equipo de NowCRM que configure `META_WEBHOOK_VERIFY_TOKEN` y `META_APP_SECRET` en el servidor.

**Errores esperados si falta schema:**
- "No se pudo preparar WhatsApp" → la tabla `whatsapp_connections` no tiene las columnas nuevas.
- Aplica: `ALTER TABLE whatsapp_connections ADD COLUMN IF NOT EXISTS phone_number_id text;` (etc.)

---

## Paso 9 — Enviar mensaje de prueba desde WhatsApp

Requisito: webhook verificado en Meta + `META_ACCESS_TOKEN` configurado en servidor.

1. Envia un mensaje de WhatsApp al numero verificado de NowCRM.
2. En NowCRM → Inbox, el mensaje debe aparecer en segundos.
3. El contacto se crea como cliente con canal "WhatsApp".

**Si no aparece:**
- Revisa Supabase → `conversations` — busca la entrada con canal `whatsapp`.
- Revisa los logs del servidor: `/api/inbox/whatsapp/inbound` debe recibir el payload.
- Revisa los logs de Meta: App Dashboard → WhatsApp → Logs de mensajes.

---

## Paso 10 — Crear cliente manualmente

1. Ve a `/clients`.
2. Pulsa "Nuevo cliente".
3. Rellena nombre, email, canal.
4. El cliente aparece en la lista.
5. Vuelve al Dashboard — el contador de clientes debe incrementar.

---

## Paso 11 — Preguntar a NowLabs AI por clientes

1. Ve al Assistant (NowLabs AI).
2. Escribe: "Cuantos clientes tengo?" o "Muestra los ultimos clientes registrados".
3. NowLabs AI debe responder con datos reales del workspace.

**Si responde con datos ficticios:**
- La IA esta usando mock data o el `workspace_id` no se esta pasando correctamente.
- Revisa que `currentUser.workspaceId` este definido antes de llamar al assistant.

---

## Paso 12 — Crear cita desde NowLabs AI

1. En el Assistant, escribe:
   "Agenda una reunion con Carlos Martinez para manana a las 11h. Tipo: demo."
2. La IA debe preparar la accion y pedir confirmacion.
3. Confirma.
4. Ve a `/calendar` — el evento debe aparecer.

---

## Paso 13 — Ver automatizaciones pendientes/activables

1. Ve a `/automations`.
2. Todas las automatizaciones que requieren WhatsApp o Calendar deben mostrar estado "Pendiente".
3. Las automatizaciones que solo requieren n8n pueden estar en "Demo".
4. El boton "Activar" debe estar deshabilitado hasta que las integraciones necesarias esten conectadas.

---

## Que funciona sin credenciales externas

- Registro y login (sin email confirmation)
- Dashboard con KPIs reales de workspace
- CRUD de clientes, facturas, eventos de calendario
- NowLabs AI (requiere OPENAI_API_KEY en servidor)
- Simulacion de mensaje WhatsApp entrante (boton "Simular lead" en Settings)
- PDFs de informes y facturas
- Historial de actividad

---

## Que requiere credenciales externas

| Funcionalidad | Variable necesaria | Donde configurar |
|---|---|---|
| NowLabs AI real | `OPENAI_API_KEY` | `.env.local` (servidor) |
| WhatsApp entrante real | `META_WEBHOOK_VERIFY_TOKEN`, `META_APP_SECRET` | `.env.local` + Meta Developers |
| WhatsApp saliente | `META_ACCESS_TOKEN`, `META_PHONE_NUMBER_ID` | `.env.local` (servidor) |
| Google Calendar OAuth | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` | `.env.local` + Google Cloud |
| Automatizaciones n8n | `N8N_BASE_URL`, `N8N_API_KEY` | `.env.local` (servidor) |
| Email de confirmacion | `RESEND_API_KEY` o SMTP | `.env.local` (servidor) |
| URL de la app publica | `NEXT_PUBLIC_APP_URL` | `.env.local` |

---

## Logs utiles para debugging

```
# Logs del servidor Next.js (terminal donde corre npm run dev)
[meta/webhook] POST received - revisa mensajes entrantes
[meta/webhook] NOWCRM_WEBHOOK_SECRET not set - falta variable
[google/calendar/connect] - inicio de OAuth
[google/calendar/callback] - resultado de OAuth

# Supabase logs
Dashboard → Logs → API Logs - peticiones a la BD
Dashboard → Auth → Users - lista de usuarios registrados
Dashboard → Table Editor → profiles - perfiles creados por trigger
Dashboard → Table Editor → workspaces - workspaces creados
```

---

## Checklist antes de dar acceso a un cliente real

- [ ] Trigger `handle_new_user` aplicado y probado
- [ ] RLS activo en todas las tablas
- [ ] `NEXT_PUBLIC_APP_URL` configurado con dominio real
- [ ] `OPENAI_API_KEY` configurado en servidor
- [ ] Webhook de Meta registrado y verificado (para WhatsApp)
- [ ] `META_ACCESS_TOKEN` configurado (para mensajes salientes)
- [ ] Google Calendar OAuth configurado o mensaje claro de "pendiente NowCRM"
- [ ] Email de confirmacion funcionando (Resend o SMTP)
- [ ] Deploy en produccion con variables seguras (Vercel / Hostinger)
- [ ] Dominio propio configurado
