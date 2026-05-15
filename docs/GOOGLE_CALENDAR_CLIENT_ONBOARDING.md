# Google Calendar — Guía de vinculación

Este documento explica los dos niveles de trabajo necesarios para que la sincronización de Google Calendar funcione en NowCRM.

---

## Nivel A — Configuración de plataforma (equipo técnico, una sola vez)

Lo hace el equipo de NowCRM. El cliente **no necesita saber nada de esto**.

### Qué se configura

En Vercel (o el servidor de producción), como variables de entorno seguras:

| Variable | Qué es | Dónde se obtiene |
|---|---|---|
| `GOOGLE_CLIENT_ID` | ID del cliente OAuth | Google Cloud Console → Credentials |
| `GOOGLE_CLIENT_SECRET` | Secreto del cliente OAuth | Google Cloud Console → Credentials |
| `GOOGLE_REDIRECT_URI` | URL de callback registrada | Debe coincidir con lo registrado en Cloud Console |
| `NEXT_PUBLIC_APP_URL` | Dominio base de NowCRM | Ej: `https://nowcrm.tudominio.com` |
| `SUPABASE_SERVICE_ROLE_KEY` | Clave de servicio Supabase | Supabase → Project Settings → API |

Ninguna de estas variables se muestra al cliente ni aparece en el navegador.

### Qué ocurre en el servidor

Cuando el cliente pulsa "Autorizar con Google":

1. El servidor redirige a Google con `client_id`, `scope` y `redirect_uri`
2. Google redirige de vuelta al callback `/api/integrations/google/calendar/callback`
3. El servidor intercambia el código por un `refresh_token` usando `client_secret` (nunca sale del servidor)
4. El `refresh_token` se guarda en `google_calendar_connections.refresh_token_enc`
5. El estado pasa a `connected`

El cliente nunca ve tokens, nunca edita variables, nunca toca `.env`.

### Cuándo queda lista la plataforma

- Google Calendar API habilitada en Cloud Console
- OAuth consent screen configurado (External o Internal)
- Redirect URI registrado en Cloud Console y coincide exactamente con `GOOGLE_REDIRECT_URI`
- Las 5 variables de entorno presentes en el servidor

---

## Nivel B — Vinculación del cliente (desde /settings)

Esto lo hace **cada cliente** desde su panel de NowCRM. No requiere conocimiento técnico.

### Pasos

1. Ir a **Configuración → Google Calendar**
2. Pulsar **"Autorizar con Google"**
3. Se abre la pantalla de inicio de sesión de Google
4. Iniciar sesión con la cuenta Google que quieras vincular
5. Aceptar los permisos de calendario que solicita NowCRM:
   - Leer calendarios
   - Crear y editar eventos
6. Google redirige de vuelta a NowCRM automáticamente
7. La página muestra **"Google Calendar conectado"** y el badge cambia a verde

### Qué ocurre después

- Las citas creadas en NowCRM se pueden sincronizar con Google Calendar pulsando "Sincronizar" en el evento
- El calendario sincronizado es el **principal** de la cuenta Google autorizada
- Si el cliente quiere cambiar a otro calendario, puede editar el Calendar ID en la sección avanzada

### Si algo falla

| Mensaje | Qué significa | Qué hacer |
|---|---|---|
| "La plataforma NowCRM aun no tiene Google OAuth configurado" | El equipo técnico no ha configurado las credenciales en el servidor | Contactar con el equipo técnico de NowCRM |
| "Google no concedió permiso permanente" | Google no devolvió un token de larga duración | Ir a myaccount.google.com → Seguridad → Apps con acceso → Revocar NowCRM → Volver a autorizar |
| "Tu sesión expiró durante la autorización" | La sesión de NowCRM caducó mientras estabas en Google | Cerrar sesión, volver a entrar e intentarlo de nuevo |
| "Error al guardar la conexión" | Problema técnico en el servidor | Contactar con el equipo técnico de NowCRM |

### El cliente nunca debe

- Editar `.env.local` o cualquier archivo de configuración
- Ver ni copiar ningún secreto o token
- Configurar nada en Google Cloud Console

---

## Preguntas frecuentes

**¿Se puede vincular más de una cuenta Google?**
Actualmente NowCRM vincula una cuenta Google por workspace. Para cambiar de cuenta, desconecta la actual y vuelve a autorizar con la nueva.

**¿Qué calendario se usa?**
El calendario principal (`primary`) de la cuenta Google autorizada. Se puede cambiar en la sección "Calendar ID (avanzado)" dentro de Configuración.

**¿Los eventos de Google Calendar aparecen en NowCRM?**
La sincronización actual es de NowCRM → Google Calendar (NowCRM crea eventos en Google). La importación de eventos de Google a NowCRM es una función futura.

**¿Qué pasa si revoco el acceso desde Google?**
La siguiente vez que NowCRM intente sincronizar un evento, fallará con `token_refresh_failed`. El estado cambia a error. El cliente deberá volver a autorizar desde Configuración.
