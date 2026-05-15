# Google Calendar — Official OAuth Setup Guide

NowCRM integrates with **Google Calendar** using the official OAuth 2.0 flow via Google Cloud Console.

---

## Architecture overview

```
User clicks "Connect" → GET /api/integrations/google/calendar/connect
                                ↓
                   Redirect to Google consent screen
                                ↓
              GET /api/integrations/google/calendar/callback?code=...
                                ↓
          POST https://oauth2.googleapis.com/token (server-side, secret never leaves)
                                ↓
           Upsert google_calendar_connections { status='connected', refresh_token_enc }
                                ↓
                   Redirect → /settings?integration=google_calendar&status=connected
```

Once connected, sync works as:

```
POST /api/integrations/google/calendar/sync-event { eventId }
        ↓
  Read refresh_token_enc from google_calendar_connections (server-side only)
        ↓
  POST https://oauth2.googleapis.com/token  (grant_type=refresh_token)
        ↓
  POST https://www.googleapis.com/calendar/v3/calendars/primary/events
        ↓
  Patch calendar_events { google_event_id, last_synced_at, ... }
        ↓
  Return { ok: true, synced: true, googleEventId }   — never exposes tokens
```

---

## Required environment variables

Add to `.env.local` (never commit):

```
GOOGLE_CLIENT_ID=       # From Google Cloud Console — OAuth 2.0 Client ID
GOOGLE_CLIENT_SECRET=   # From Google Cloud Console — server-side only, never sent to browser
GOOGLE_REDIRECT_URI=    # Must match exactly: https://yourdomain.com/api/integrations/google/calendar/callback
NEXT_PUBLIC_APP_URL=    # Used for redirect fallback, e.g. https://yourdomain.com
SUPABASE_SERVICE_ROLE_KEY=  # Used server-side to bypass RLS for the token upsert in callback
```

---

## Step-by-step setup

### 1. Create a Google Cloud project

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Create a new project (or reuse an existing one)
3. Enable the **Google Calendar API** (APIs & Services → Library)

### 2. Configure OAuth consent screen

1. APIs & Services → OAuth consent screen
2. Choose **External** (for all Google accounts) or **Internal** (for G Suite only)
3. Fill in app name, support email, developer email
4. Add scopes:
   - `https://www.googleapis.com/auth/calendar`
   - `https://www.googleapis.com/auth/calendar.events`
5. Add test users while in development mode

### 3. Create OAuth 2.0 credentials

1. APIs & Services → Credentials → Create Credentials → OAuth client ID
2. Application type: **Web application**
3. Add Authorized redirect URIs:
   - `http://localhost:3000/api/integrations/google/calendar/callback` (development)
   - `https://yourdomain.com/api/integrations/google/calendar/callback` (production)
4. Copy the **Client ID** → `GOOGLE_CLIENT_ID`
5. Copy the **Client Secret** → `GOOGLE_CLIENT_SECRET`

### 4. Set redirect URI

Set `GOOGLE_REDIRECT_URI` to exactly match one of the URIs registered in step 3 for the current environment.

---

## SQL migrations required

Run these in Supabase SQL Editor before testing. All are idempotent (`IF NOT EXISTS`).

### google_calendar_connections — sync_enabled column

```sql
ALTER TABLE public.google_calendar_connections
  ADD COLUMN IF NOT EXISTS sync_enabled boolean NOT NULL DEFAULT false;
```

### calendar_events — Google sync columns

Required for `sync-event` to patch local events after syncing to Google Calendar:

```sql
ALTER TABLE public.calendar_events ADD COLUMN IF NOT EXISTS google_event_id text;
ALTER TABLE public.calendar_events ADD COLUMN IF NOT EXISTS google_sync_status text;
ALTER TABLE public.calendar_events ADD COLUMN IF NOT EXISTS google_synced_at timestamptz;
ALTER TABLE public.calendar_events ADD COLUMN IF NOT EXISTS google_calendar_id text;
ALTER TABLE public.calendar_events ADD COLUMN IF NOT EXISTS sync_source text;
ALTER TABLE public.calendar_events ADD COLUMN IF NOT EXISTS last_synced_at timestamptz;
```

### google_calendar_connections table (if it doesn't exist yet)

```sql
CREATE TABLE IF NOT EXISTS public.google_calendar_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  calendar_id text,
  primary_calendar text,
  refresh_token_enc text,       -- plaintext for now; TODO: encrypt at rest
  access_token_hash text,       -- SHA-256 hash only, never the token
  token_expiry timestamptz,
  status text NOT NULL DEFAULT 'not_configured',
  sync_enabled boolean NOT NULL DEFAULT false,
  last_sync_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (workspace_id)
);
```

---

## OAuth scopes requested

| Scope | Purpose |
|---|---|
| `https://www.googleapis.com/auth/calendar` | Read calendars and calendar list |
| `https://www.googleapis.com/auth/calendar.events` | Create, edit, and delete events |

---

## Token storage

| What | Where | How |
|---|---|---|
| `refresh_token` | `google_calendar_connections.refresh_token_enc` | Plaintext (TODO: encrypt). Never sent to browser. |
| `access_token` | Not stored | Obtained on each sync via refresh_token. Discarded after use. |
| `access_token_hash` | `google_calendar_connections.access_token_hash` | SHA-256 hash only (column reserved, currently unused). |

> **TODO before production**: encrypt `refresh_token_enc` using a server-side key (e.g. AES-256-GCM). The column name `_enc` signals this intent.

---

## How to test end-to-end

### Prerequisites
- All env vars set (see above)
- SQL migrations run
- `SUPABASE_SERVICE_ROLE_KEY` set (needed for the upsert in callback)
- Logged in to NowCRM

### Step 1 — Initiate the flow

Navigate to `/settings` and click "Connect Google Calendar". Alternatively:

```
GET http://localhost:3000/api/integrations/google/calendar/connect
```

You will be redirected to Google's consent screen. Accept. Google redirects back to:

```
GET /api/integrations/google/calendar/callback?code=XXXX&state=<user_id>
```

### Step 2 — Verify the callback succeeded

After the callback, the browser lands on:

```
/settings?integration=google_calendar&status=connected
```

If it shows `status=error`, check the server logs for `[google/calendar/callback]` messages. Common reasons:

| reason | Cause |
|---|---|
| `token_exchange_failed` | Invalid client_id/secret or code expired (codes expire in ~60s) |
| `no_refresh_token` | Google didn't return refresh_token — user must revoke access at myaccount.google.com and reconnect |
| `no_workspace` | User's profile has no workspace_id |
| `db_error` | Supabase upsert failed — check SQL migrations and SUPABASE_SERVICE_ROLE_KEY |
| `unauthenticated` | Session expired during redirect — log in again |
| `state_mismatch` | Possible CSRF or session changed mid-flow |

### Step 3 — Verify the DB row

In Supabase SQL Editor:

```sql
SELECT workspace_id, calendar_id, status, sync_enabled, token_expiry, last_sync_at
FROM public.google_calendar_connections;
```

Expected: one row with `status = 'connected'`, `sync_enabled = true`, `refresh_token_enc` non-null.

### Step 4 — Check the status API

```
GET http://localhost:3000/api/integrations/google/calendar/status
```

Expected response:

```json
{
  "ok": true,
  "connection": {
    "workspaceId": "...",
    "provider": "google_calendar",
    "connectionStatus": "connected",
    "calendarId": "primary",
    "lastSyncAt": "..."
  }
}
```

### Step 5 — Sync an event

```bash
curl -X POST http://localhost:3000/api/integrations/google/calendar/sync-event \
  -H "Content-Type: application/json" \
  -d '{"eventId": "<uuid of a calendar_events row>"}'
```

Expected response:

```json
{
  "ok": true,
  "synced": true,
  "googleEventId": "...",
  "calendarId": "primary"
}
```

Check Google Calendar — the event should appear.

### Step 6 — Verify DB patch

```sql
SELECT id, title, google_event_id, last_synced_at
FROM public.calendar_events
WHERE google_event_id IS NOT NULL;
```

---

## API routes

| Route | Method | Purpose |
|---|---|---|
| `/api/integrations/google/calendar/connect` | GET | Redirects user to Google consent screen |
| `/api/integrations/google/calendar/callback` | GET | Receives code, exchanges for tokens, stores connection |
| `/api/integrations/google/calendar/status` | GET | Returns connection state for settings page |
| `/api/integrations/google/calendar/sync-event` | POST | Syncs one local event to Google Calendar |

---

## Checklist

- [x] Google Calendar API enabled in Cloud Console
- [ ] OAuth consent screen configured (External apps need review for production)
- [x] `GOOGLE_CLIENT_ID` configured
- [x] `GOOGLE_CLIENT_SECRET` configured (server-side only)
- [x] `GOOGLE_REDIRECT_URI` matches Cloud Console registration
- [x] Token exchange implemented in `callback/route.ts`
- [x] `refresh_token` stored in `google_calendar_connections.refresh_token_enc`
- [ ] `refresh_token_enc` encrypted at rest (currently plaintext — TODO)
- [x] `sync-event` reads refresh_token and calls Google API server-side
- [x] No tokens exposed to browser at any point
- [ ] SQL migrations run in Supabase (see SQL section above)
- [ ] Tested end-to-end: connect → status=connected → sync-event → event in Google Calendar
