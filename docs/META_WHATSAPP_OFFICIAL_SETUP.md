# Meta WhatsApp Business Platform — Setup Guide

NowCRM uses the **WhatsApp Business Platform (Meta Cloud API)** — the official API from Meta, not any third-party provider.

---

## Architecture overview

```
User's WhatsApp → Meta Cloud API → POST /api/integrations/meta/whatsapp/webhook
                                          ↓
                              /api/inbox/whatsapp/inbound
                                          ↓
                              NowLabs AI inbox processing → Supabase
```

---

## Required environment variables

Add these to `.env.local` (never commit):

```
META_ACCESS_TOKEN=         # Permanent System User token from Meta Business Manager
META_PHONE_NUMBER_ID=      # From WhatsApp > Configuration > Phone numbers
META_WEBHOOK_VERIFY_TOKEN= # Your own random secret — used to verify webhook ownership
META_APP_SECRET=           # From your Meta App > Settings > Basic — used to verify X-Hub-Signature-256
```

---

## Step-by-step setup

### 1. Create a Meta App

1. Go to [developers.facebook.com](https://developers.facebook.com)
2. Create a new Business App
3. Add the **WhatsApp** product

### 2. Configure your phone number

1. In App Dashboard → WhatsApp → Getting Started
2. Add and verify your business phone number
3. Copy the **Phone Number ID** → set as `META_PHONE_NUMBER_ID`

### 3. Generate a permanent access token

1. Go to Meta Business Manager → System Users
2. Create a System User with the `whatsapp_business_messaging` permission
3. Generate a token with no expiry
4. Copy it → set as `META_ACCESS_TOKEN`

> **Security**: this token has full API access. Store server-side only, never expose to the browser.

### 4. Register the webhook

1. In App Dashboard → WhatsApp → Configuration → Webhook
2. Set the Callback URL: `https://yourdomain.com/api/integrations/meta/whatsapp/webhook`
3. Set the Verify Token to the value of your `META_WEBHOOK_VERIFY_TOKEN`
4. Subscribe to events: `messages`, `message_deliveries`, `message_reads`

NowCRM will respond to the GET verification challenge automatically once the env var is set.

### 5. Enable X-Hub-Signature-256 validation

1. In App → Settings → Basic → copy the **App Secret**
2. Set as `META_APP_SECRET`

The webhook POST handler will validate every incoming request using HMAC-SHA256.

---

## Database table: `whatsapp_connections`

```sql
create table if not exists whatsapp_connections (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  provider text not null default 'meta',
  meta_business_id text,
  whatsapp_business_account_id text,
  phone_number_id text,
  phone_number text,
  webhook_verify_token_configured boolean default false,
  webhook_url text,
  status text not null default 'not_configured',
  last_webhook_at timestamptz,
  last_test_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (workspace_id, provider)
);
```

---

## API routes

| Route | Method | Purpose |
|---|---|---|
| `/api/integrations/meta/whatsapp/status` | GET | Returns connection state for settings page |
| `/api/integrations/meta/whatsapp/webhook` | GET | Meta verification challenge |
| `/api/integrations/meta/whatsapp/webhook` | POST | Receive incoming messages |
| `/api/integrations/meta/whatsapp/test` | POST | Send a test message (requires credentials) |

---

## Sending messages (outbound)

Outbound messages use Meta's `/messages` endpoint:

```
POST https://graph.facebook.com/v19.0/{META_PHONE_NUMBER_ID}/messages
Authorization: Bearer {META_ACCESS_TOKEN}
Content-Type: application/json

{
  "messaging_product": "whatsapp",
  "to": "34612345678",
  "type": "template",
  "template": { "name": "hello_world", "language": { "code": "es" } }
}
```

> All outbound calls go through server-side API routes only. Never call the Meta Graph API directly from the browser.

---

## Checklist before going live

- [ ] Meta App reviewed and approved for production messaging
- [ ] Business phone number verified
- [ ] System User token generated with no expiry
- [ ] `META_WEBHOOK_VERIFY_TOKEN` set — webhook verified by Meta
- [ ] `META_APP_SECRET` set — X-Hub-Signature-256 validation active
- [ ] Supabase table `whatsapp_connections` exists with RLS enabled
- [ ] Test message sent and received in the inbox
