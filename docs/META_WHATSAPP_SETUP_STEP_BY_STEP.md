# Meta WhatsApp Cloud API — Setup paso a paso para NowCRM

Esta guía explica, en orden estricto, cómo conectar un número de WhatsApp
Business real a NowCRM usando la **Meta WhatsApp Cloud API oficial**. Sigue
los pasos tal cual: equivocarse en el orden suele obligar a empezar de cero.

> **Aviso importante**
>
> - Usa una cuenta personal real de Meta (no una marca como "NowAI") para crear
>   el Business Portfolio. Meta puede pedir verificación con DNI más adelante.
> - **Nada de tokens en Settings de NowCRM.** Los secretos viven en el servidor.
> - NowCRM no enviará mensajes hasta que las cuatro variables de servidor
>   estén presentes **y** el workspace tenga `phone_number_id` configurado.

## 0. Lo que vas a conseguir

Al final del proceso, en `.env.local` (dev) o Vercel (prod) tendrás:

```
META_WHATSAPP_ACCESS_TOKEN   # System User token con permisos WhatsApp
META_APP_SECRET              # firma HMAC-SHA256 del webhook
META_WEBHOOK_VERIFY_TOKEN    # token aleatorio que tú generas
NOWCRM_WEBHOOK_SECRET        # secreto interno NowCRM (independiente de Meta)
META_GRAPH_VERSION           # opcional, default v21.0
```

Y en NowCRM (Settings → WhatsApp Business) tendrás:

```
Phone Number ID
WhatsApp Business Account ID (WABA ID)
Meta Business ID (opcional)
Número visible (+34 …)
```

## 1. Business Portfolio (antes Business Manager)

1. Entra a https://business.facebook.com con tu cuenta personal real.
2. Crea un **Business Portfolio** con el nombre de la empresa.
3. En *Configuración de la empresa → Personas* añade a los socios reales como
   administradores. No uses "Now AI" / "NowCRM" como nombre del Portfolio.

## 2. App de Meta + producto WhatsApp

1. https://developers.facebook.com/ → **My Apps → Create App**.
2. Tipo: **Business**, finalidad: WhatsApp.
3. Asocia la App al Business Portfolio del paso 1.
4. En la App, abre **Add Product → WhatsApp → Set up**.
5. Meta te ofrece un **test number** gratuito. Lo usaremos para validar el flujo
   antes de migrar al número real.

## 3. Datos que necesitas anotar

En **WhatsApp → API Setup**:

| Campo                          | Cómo se llama en Meta             | Dónde va         |
| ------------------------------ | --------------------------------- | ---------------- |
| Phone Number ID                | "Phone number ID" (test o real)   | Settings → WhatsApp |
| WhatsApp Business Account ID   | "WhatsApp Business Account ID"    | Settings → WhatsApp |
| Meta Business ID               | desde Business Settings → Info    | Settings → WhatsApp (opcional) |
| Display Phone Number           | "From"                            | Settings → WhatsApp (visible) |
| Temporary access token         | "Temporary access token"          | **NO. Solo para curl manual.** |

## 4. App Secret

1. En la App: **Settings → Basic**.
2. Pulsa **Show** junto a *App Secret*.
3. Cópialo a `.env.local` como `META_APP_SECRET`.

Este secreto firma con HMAC-SHA256 cada POST que envía Meta a tu webhook. Sin
él el endpoint rechaza los webhooks en producción.

## 5. Verify Token (lo genera NowCRM, lo registra Meta)

Tienes que **inventar tú** un token aleatorio. No lo da Meta.

```powershell
# PowerShell — genera un UUID v4
[guid]::NewGuid().ToString()
```

Cópialo a `.env.local` como `META_WEBHOOK_VERIFY_TOKEN`. Lo volverás a pegar
en Meta al registrar el webhook (paso 7).

## 6. System User Token (el de verdad)

1. En **Business Settings → Users → System Users → Add**.
2. Rol: *Admin*.
3. Dale acceso a la App de Meta del paso 2.
4. Genera un **System User Token** con los scopes:
   - `whatsapp_business_management`
   - `whatsapp_business_messaging`
   - `business_management`
5. Marca **Never expires** (los tokens normales caducan en horas).
6. Cópialo a `.env.local` como `META_WHATSAPP_ACCESS_TOKEN`.

## 7. URL pública del webhook

Meta solo envía webhooks a HTTPS público. En desarrollo:

```powershell
# Opción A — Cloudflared (recomendado, gratis, sin login)
cloudflared tunnel --url http://localhost:3000

# Opción B — Ngrok
ngrok http 3000
```

En producción, Vercel ya da `https://tu-dominio.vercel.app`.

La URL del webhook que registras en Meta es:

```
https://TU_DOMINIO/api/integrations/meta/whatsapp/webhook
```

## 8. Registrar el webhook en Meta

1. En la App de Meta: **WhatsApp → Configuration → Webhook → Configure**.
2. **Callback URL**: la del paso 7.
3. **Verify token**: el que generaste en el paso 5.
4. Pulsa **Verify and save**. NowCRM responderá con el `hub.challenge`.
5. En **Webhook Fields** suscríbete a:
   - `messages`
   - `message_deliveries` (opcional)
   - `message_reads` (opcional)

## 9. NOWCRM_WEBHOOK_SECRET (interno, no es Meta)

Es un secreto **independiente de Meta** que NowCRM usa para autenticar
puentes internos (p.ej. el simulador de Inbox).

```powershell
[guid]::NewGuid().ToString()
```

Cópialo como `NOWCRM_WEBHOOK_SECRET` en `.env.local`.

## 10. Configurar el workspace en NowCRM

Settings → WhatsApp Business:

- **Numero de teléfono verificado** → +34 600 000 000 (el "Display Phone Number")
- **Phone Number ID** → el del paso 3
- **WABA ID** → el del paso 3
- **Meta Business ID** → opcional, el del paso 3
- Pulsa **Guardar configuracion**

NowCRM lo guarda en `whatsapp_connections` y la cuenta queda como
`webhook_pending` hasta que llegue el primer mensaje real.

## 11. Primera prueba

1. En el test number de Meta, añade tu propio móvil como **Allowed recipient**.
2. Envía un mensaje desde tu móvil al test number.
3. Verifica:
   - Logs del server: `[meta/webhook] persisted batch { received: 1, inserted: 1 }`
   - Inbox: aparece la conversación con tu nombre y mensaje.
   - Settings → WhatsApp: `lastWebhookAt` se actualiza.
4. **No respondas todavía desde NowCRM**. Auto-reply OFF por defecto.

## 12. Probar envío manual (opcional, fuera de auto-reply)

Desde Inbox, escribe una respuesta y pulsa **Enviar**:

- Si el server tiene `META_WHATSAPP_ACCESS_TOKEN` y el workspace tiene
  `phone_number_id` → el mensaje se envía y queda como `sent` con un
  `provider_message_id` (wamid).
- Si falta algo → el mensaje queda como `pending_config` (no como "failed").

## 13. Migrar al número real

Una vez validado con el test number:

1. En **WhatsApp → API Setup → Add phone number**, registra tu número real.
2. Sigue el OTP de Meta para verificarlo.
3. Repite paso 10 con los IDs nuevos.

## 14. Production checklist

Antes de poner esto delante de un cliente:

- [ ] `META_APP_SECRET` presente en Vercel (no en cliente).
- [ ] `META_WEBHOOK_VERIFY_TOKEN` presente en Vercel.
- [ ] `META_WHATSAPP_ACCESS_TOKEN` es un System User token (no temporal).
- [ ] `NOWCRM_WEBHOOK_SECRET` presente.
- [ ] Webhook registrado en Meta con HTTPS público.
- [ ] Workspace tiene `phone_number_id` y `whatsapp_business_account_id`.
- [ ] Mensaje real recibido y persistido (Inbox + `lastWebhookAt`).
- [ ] Auto-reply sigue OFF.

## Apéndice — variables que **NUNCA** van en Settings

Estas variables son secretos de plataforma y **no se introducen en la UI**:

- `META_WHATSAPP_ACCESS_TOKEN`
- `META_APP_SECRET`
- `META_WEBHOOK_VERIFY_TOKEN`
- `NOWCRM_WEBHOOK_SECRET`
- `OPENAI_API_KEY`
- `N8N_API_KEY`
- `N8N_WEBHOOK_SECRET`
- `SUPABASE_SERVICE_ROLE_KEY`

Si una de estas aparece en un campo de Settings, es un bug. Reportalo.
