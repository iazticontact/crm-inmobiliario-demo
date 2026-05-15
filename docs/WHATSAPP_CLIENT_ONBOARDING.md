# WhatsApp Business — Guía de vinculación por cliente

Este documento explica los dos niveles de trabajo para conectar WhatsApp Business con NowCRM.

---

## Nivel A — Configuración de plataforma (equipo técnico NowCRM, una vez)

El cliente **no necesita saber nada de esto**.

### Variables de entorno configuradas en el servidor

| Variable | Qué es | Quién la configura |
|---|---|---|
| `META_APP_SECRET` | Secreto de la App Meta, para validar X-Hub-Signature-256 | NowCRM (en Vercel) |
| `META_WEBHOOK_VERIFY_TOKEN` | Token aleatorio para que Meta verifique el webhook | NowCRM (en Vercel) |
| `META_ACCESS_TOKEN` | System User Token para envíos salientes | NowCRM (en Vercel) |
| `NOWCRM_WEBHOOK_SECRET` | Secreto interno entre el webhook y el handler de Inbox | NowCRM (en Vercel) |
| `NEXT_PUBLIC_APP_URL` | Dominio base de NowCRM | NowCRM (en Vercel) |

Ninguna de estas variables se muestra al cliente ni aparece en el navegador.

### Qué hace NowCRM con estos secretos

- `META_APP_SECRET` → valida que cada POST del webhook viene realmente de Meta (HMAC-SHA256)
- `META_WEBHOOK_VERIFY_TOKEN` → responde al challenge de verificación de Meta (GET del webhook)
- `META_ACCESS_TOKEN` → envía mensajes salientes en nombre del cliente via Graph API
- `NOWCRM_WEBHOOK_SECRET` → autenticación interna entre `/api/integrations/meta/whatsapp/webhook` y `/api/inbox/whatsapp/inbound`

### Webhook público de NowCRM

La URL que el cliente pega en Meta Developers es:

```
{NEXT_PUBLIC_APP_URL}/api/integrations/meta/whatsapp/webhook
```

Esta URL es pública (Meta necesita llegar a ella) pero está protegida por HMAC-SHA256. Sin `META_APP_SECRET` válido, los POSTs fraudulentos son rechazados con 401.

---

## Nivel B — Vinculación del cliente (desde /settings)

### Qué necesita el cliente antes de empezar

- Una cuenta de Facebook/Meta activa
- Acceso a [business.facebook.com](https://business.facebook.com) (o creación de una)
- Un número de teléfono que **no esté ya registrado en WhatsApp Business**

### Paso 1 — Crear o acceder a Meta Business Suite

1. Ve a [business.facebook.com](https://business.facebook.com)
2. Inicia sesión con tu cuenta de Facebook
3. Crea un negocio si no tienes uno: "Crear cuenta" → nombre de empresa → email → país
4. Anota el **Meta Business ID** (Configuración del negocio → Información del negocio)

### Paso 2 — Crear una App en Meta for Developers y añadir WhatsApp

1. Ve a [developers.facebook.com/apps](https://developers.facebook.com/apps)
2. Pulsa "Crear app" → tipo **Business**
3. En el Dashboard de la app → "Añadir producto" → selecciona **WhatsApp** → "Configurar"
4. Selecciona o crea tu **WhatsApp Business Account (WABA)**
5. Anota el **WABA ID** que aparece en pantalla

### Paso 3 — Verificar el número de teléfono

1. App Dashboard → WhatsApp → Getting Started
2. Pulsa "Añadir número de teléfono"
3. Introduce el número con prefijo internacional (ej: +34 600 000 000)
4. Verifica por SMS o llamada
5. Anota el **Phone Number ID** (visible en la lista de números una vez verificado)

### Paso 4 — Guardar los IDs en NowCRM Settings

1. Ve a **Configuración → WhatsApp Business** en NowCRM
2. Introduce:
   - **Número de teléfono verificado** (ej: +34 600 000 000)
   - **Phone Number ID** (de Meta Developers)
   - **WhatsApp Business Account ID / WABA ID**
   - **Meta Business ID** (opcional, para auditoría)
3. Pulsa **"Guardar configuración"**
4. El estado pasa a "Preparado · pendiente webhook"

### Paso 5 — Registrar el webhook en Meta

1. App Dashboard → WhatsApp → Configuración → Webhook → "Editar"
2. En "URL de devolución de llamada" pega la URL que aparece en NowCRM:
   ```
   https://tu-dominio.nowcrm.com/api/integrations/meta/whatsapp/webhook
   ```
3. En "Verificar token" — **NO lo introduces tú**. El equipo técnico de NowCRM ya ha configurado `META_WEBHOOK_VERIFY_TOKEN` en el servidor. Simplemente pulsa **"Verificar y guardar"**. NowCRM responderá automáticamente al challenge de Meta.
4. Suscríbete a los eventos: `messages`, `message_deliveries`, `message_reads`

### Paso 6 — Probar la conexión

- Desde cualquier teléfono, envía un mensaje de WhatsApp al número verificado
- En NowCRM → **Inbox**, el mensaje debe aparecer en menos de 10 segundos
- En NowCRM → **Settings → WhatsApp**, el estado muestra la fecha/hora del último webhook recibido

Alternativamente, desde Settings puedes pulsar **"Probar conexión"** para verificar que el servidor tiene las credenciales configuradas.

---

## Estados posibles en Settings → WhatsApp

| Estado | Badge | Significado | Qué hacer |
|---|---|---|---|
| No configurado | Gris | Sin datos guardados | Completa los pasos 1–4 |
| Preparado · pendiente webhook | Indigo | IDs guardados, falta registrar webhook | Completa el paso 5 |
| Pendiente webhook Meta | Naranja | Datos guardados, webhook no verificado | Verifica el webhook en Meta Developers |
| Conectado y verificado | Verde | Todo OK — mensajes entrantes activos | Ninguna acción necesaria |
| Error de conexion | Rojo | Problema técnico | Contacta con el equipo técnico de NowCRM |

---

## Qué ve el cliente si la plataforma no está configurada

Si `META_WEBHOOK_VERIFY_TOKEN` no está en el servidor, al intentar verificar el webhook desde Meta, Meta recibirá un error 503. El cliente verá en Meta Developers que la verificación falla.

En ese caso, el cliente debe contactar con el equipo técnico de NowCRM — el problema es de plataforma, no del cliente.

El banner "Configuración de plataforma — gestionada por NowCRM" en Settings lo deja claro: el cliente nunca toca los secretos del servidor.

---

## El cliente nunca debe

- Editar `.env.local` ni ningún archivo de servidor
- Ver ni copiar `META_APP_SECRET`, `META_WEBHOOK_VERIFY_TOKEN` ni `META_ACCESS_TOKEN`
- Pegar tokens en el formulario de Settings (solo IDs numéricos de Meta)
- Compartir el System User Access Token por canales no cifrados (email, Slack sin cifrar)

---

## Preguntas frecuentes

**¿Se pueden conectar múltiples números de WhatsApp?**
Actualmente NowCRM soporta un número de WhatsApp por workspace. Para cambiar de número, desconecta el actual y repite el proceso con el nuevo número.

**¿Qué pasa si el token de acceso caduca?**
Los System User Tokens generados sin expiración no caducan a menos que sean revocados manualmente. Si el token caduca, el equipo técnico de NowCRM genera uno nuevo y lo actualiza en el servidor — el cliente no necesita hacer nada.

**¿Cuánto tarda en aparecer un mensaje en el Inbox?**
En condiciones normales, los mensajes de WhatsApp aparecen en NowCRM en menos de 5 segundos. Meta puede tardar hasta 30 segundos en reenviar el webhook en condiciones de alta carga.

**¿NowCRM puede enviar mensajes de WhatsApp salientes?**
Sí, mediante plantillas aprobadas por Meta. Las respuestas libres solo están disponibles dentro de la ventana de 24 horas después de que el cliente haya enviado un mensaje primero. Esta funcionalidad se activa desde el Inbox una vez que el número está conectado.
