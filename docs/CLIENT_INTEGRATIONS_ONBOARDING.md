# NowCRM — Onboarding de Integraciones por Cliente

Guia paso a paso para que un cliente conecte sus propias cuentas desde `/settings`.

---

## Que gestiona NowCRM (no requiere accion del cliente)

| Servicio | Gestionado por |
|---|---|
| Base de datos (Supabase) | NowCRM |
| IA / NowLabs AI | NowCRM |
| Motor de automatizaciones (n8n) | NowCRM |
| Hosting y deploy | NowCRM |
| Mantenimiento y actualizaciones | NowCRM |
| Soporte tecnico | NowCRM |

El cliente NUNCA tiene que tocar claves API, tokens ni archivos de configuracion del servidor.

---

## Que conecta el cliente desde /settings

| Integracion | Quien lo hace | Que necesita |
|---|---|---|
| WhatsApp Business | El cliente | Meta Business + numero verificado |
| Google Calendar | El cliente | Cuenta Google personal o de empresa |
| Email (futuro) | El cliente | Dominio propio |

---

## A — WhatsApp Business (Meta Cloud API oficial)

### Requisitos previos

- Cuenta de Facebook/Meta personal o de empresa.
- Numero de telefono que NO este ya registrado en WhatsApp Business.
  (Puede ser un numero nuevo, un numero SIM, o un numero virtual.)
- Acceso a Meta for Developers: [developers.facebook.com](https://developers.facebook.com)

---

### Paso 1 — Crear o acceder a Meta Business Suite

1. Ve a [business.facebook.com](https://business.facebook.com)
2. Inicia sesion con tu cuenta de Facebook.
3. Crea un negocio si no tienes uno: "Crear cuenta" → nombre de empresa → correo → pais.
4. Anota el **Meta Business ID** (aparece en Configuracion del negocio → Informacion del negocio).

---

### Paso 2 — Crear una App en Meta for Developers

1. Ve a [developers.facebook.com/apps](https://developers.facebook.com/apps)
2. Pulsa "Crear app".
3. Elige tipo: **Business** (o "Empresa").
4. Nombre de la app: por ejemplo "NowCRM MiEmpresa".
5. Email de contacto del desarrollador.
6. Vincula tu Meta Business Suite al crear la app.
7. Pulsa "Crear app".

---

### Paso 3 — Anadir WhatsApp al producto

1. En el Dashboard de tu app, busca "Anadir producto".
2. Selecciona **WhatsApp** → "Configurar".
3. Selecciona o crea tu **WhatsApp Business Account (WABA)**.
4. Anota el **WABA ID** (aparece en la pantalla de configuracion).

---

### Paso 4 — Verificar el numero de telefono

1. En App Dashboard → WhatsApp → Getting Started.
2. Pulsa "Anadir numero de telefono".
3. Introduce el numero con prefijo internacional (ej: +34 600 000 000).
4. Elige verificacion por SMS o llamada.
5. Introduce el codigo de verificacion.
6. Una vez verificado, anota el **Phone Number ID** (visible en la lista de numeros).

---

### Paso 5 — Configurar el webhook en NowCRM

1. En NowCRM, ve a **Settings → WhatsApp Business**.
2. Copia la **URL de webhook de NowCRM** que aparece en el panel.
   Ejemplo: `https://tu-dominio.com/api/integrations/meta/whatsapp/webhook`
3. Introduce en el formulario:
   - Numero de telefono verificado
   - Phone Number ID
   - WABA ID
   - Meta Business ID (opcional)
4. Pulsa **"Preparar WhatsApp"**.

---

### Paso 6 — Registrar el webhook en Meta

1. En App Dashboard → WhatsApp → Configuracion → Webhook.
2. Pulsa "Editar".
3. Pega la **URL de webhook de NowCRM** en "URL de devolucion de llamada".
4. En "Verificar token", pide a NowCRM el `META_WEBHOOK_VERIFY_TOKEN` de tu workspace
   (lo configura el equipo de NowCRM en el servidor, no lo introduces tu en el panel).
5. Pulsa "Verificar y guardar".
6. Meta enviara una peticion GET y NowCRM respondera automaticamente con el challenge.
7. Suscribete a los eventos: `messages`, `message_deliveries`, `message_reads`.

> **Importante**: El token de verificacion lo gestiona NowCRM en el servidor.
> Nunca lo pegas en el panel del cliente — solo en la consola de Meta Developers.

---

### Paso 7 — Proporcionar el access token a NowCRM

El **System User Access Token** de Meta es una clave secreta que NowCRM necesita
para enviar mensajes salientes en tu nombre. Este token NUNCA se introduce en el
panel del cliente.

1. En Meta Business Suite → Configuracion → Usuarios del sistema.
2. Crea un "Usuario del sistema" con permiso `whatsapp_business_messaging`.
3. Genera un token con duracion "Sin vencimiento".
4. Envia el token de forma segura al equipo de NowCRM (no por email ni Slack sin cifrar).

El equipo de NowCRM lo configurara en el servidor como variable de entorno segura.

---

### Paso 8 — Enviar mensaje de prueba

1. Desde cualquier telefono, envia un mensaje de WhatsApp al numero verificado.
2. En NowCRM, ve a **Inbox**.
3. Comprueba que el mensaje aparece en la lista de conversaciones.
4. Si no aparece en 30 segundos, revisa:
   - Que el webhook este verificado en Meta (paso 6).
   - Que NowCRM tenga configurado el token de acceso (paso 7).
   - Que el Phone Number ID guardado en Settings sea el correcto.

---

### Estados posibles en Settings → WhatsApp

| Estado | Significado |
|---|---|
| No configurado | Aun no has guardado ningun dato |
| Preparado · pendiente Meta | Datos guardados, webhook no registrado en Meta |
| Pendiente webhook Meta | Phone Number ID guardado, falta registrar webhook |
| Conectado y verificado | Todo OK — mensajes entrantes activos |
| Error | Problema con el token o webhook — contacta NowCRM |

---

## B — Google Calendar (OAuth oficial)

### Requisitos previos

- Cuenta de Google (Gmail o Google Workspace).
- La aplicacion de NowCRM debe estar configurada con credenciales OAuth de Google
  (lo gestiona el equipo de NowCRM en el servidor).

---

### Paso 1 — Iniciar conexion desde Settings

1. En NowCRM, ve a **Settings → Google Calendar**.
2. Pulsa **"Conectar con Google Calendar"**.
3. Se abrira la pantalla de autorizacion de Google.

---

### Paso 2 — Autorizar en Google

1. Selecciona la cuenta de Google que quieres conectar.
2. Revisa los permisos solicitados:
   - Ver y editar eventos del calendario
3. Pulsa "Permitir".
4. Seras redirigido de vuelta a NowCRM.

---

### Paso 3 — Confirmar conexion

1. En Settings → Google Calendar, el estado debe mostrar **"Conectado"**.
2. Si muestra error, revisa:
   - Que hayas aceptado todos los permisos en Google.
   - Que NowCRM tenga configuradas las credenciales OAuth (contacta NowCRM si no es el caso).
3. Si muestra "Pendiente", el equipo de NowCRM necesita activar el intercambio de tokens.
   Contacta con soporte.

---

### Paso 4 — Crear una cita de prueba

1. En NowCRM, abre **NowLabs AI** (Assistant).
2. Escribe: "Crea una cita de prueba para manana a las 10h con el cliente Carlos".
3. Confirma la accion.
4. Comprueba en Google Calendar que el evento aparece.

---

### Que hace NowCRM con tu calendario

- Lee eventos para mostrarlos en el Dashboard y el modulo de Calendario.
- Crea eventos cuando el cliente o la IA programa una cita.
- No borra eventos sin confirmacion del usuario.
- No accede a otros datos de tu cuenta Google.
- Los tokens se guardan cifrados en la base de datos. No se exponen nunca al navegador.

---

## C — n8n / Automatizaciones

### El cliente NO configura n8n directamente.

El equipo de NowCRM gestiona la instancia de n8n y los workflows.
El cliente puede:

1. Activar o desactivar automatizaciones desde **Settings → n8n / Flujos operativos**.
2. Ver el estado de cada flujo (activo, pendiente, error).
3. Solicitar nuevas automatizaciones al equipo de NowCRM.

### Requisitos para activar automatizaciones

Cada automatizacion indica que integracione necesita:

| Automatizacion | Requiere |
|---|---|
| Bienvenida a nuevo cliente | WhatsApp Business |
| Recordatorio factura vencida | WhatsApp Business o Email |
| Resumen diario IA | Sin requisitos adicionales |
| Reunion agendada | Google Calendar + Email |
| Re-engagement leads frios | WhatsApp Business |
| Conversacion urgente | WhatsApp Business |

---

## D — Email (futuro)

Pendiente de fase siguiente. Requerira:
- Dominio propio verificado.
- Configuracion de remitente (Resend u otro proveedor).
- El equipo de NowCRM configurara el SMTP/API.

---

## Contacto con soporte NowCRM

Para cualquier duda o incidencia durante el onboarding:
- Email: soporte@nowcrm.io (o el canal que el equipo indique)
- No compartas tokens, claves API ni contrasenas por canales no cifrados.
