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
                   Exchange code for refresh_token (server-side)
                                ↓
                   Store in google_calendar_connections (encrypted)
```

---

## Required environment variables

Add these to `.env.local` (never commit):

```
GOOGLE_CLIENT_ID=       # From Google Cloud Console — OAuth 2.0 Client ID
GOOGLE_CLIENT_SECRET=   # From Google Cloud Console — never expose to browser
GOOGLE_REDIRECT_URI=    # Must match exactly: https://yourdomain.com/api/integrations/google/calendar/callback
NEXT_PUBLIC_APP_URL=    # Used for redirect fallback, e.g. https://yourdomain.com
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

## OAuth scopes requested

| Scope | Purpose |
|---|---|
| `https://www.googleapis.com/auth/calendar` | Read calendars and calendar list |
| `https://www.googleapis.com/auth/calendar.events` | Create, edit, and delete events |

---

## Token storage

- **refresh_token** — stored encrypted in `google_calendar_connections.refresh_token_enc` (never sent to client)
- **access_token** — short-lived (1h), used server-side for API calls, never persisted or sent to browser
- **access_token_hash** — SHA-256 hash stored to detect token rotation, not the token itself

> The callback route skeleton in `/api/integrations/google/calendar/callback/route.ts` includes commented pseudocode for the token exchange. Uncomment and implement when `GOOGLE_CLIENT_SECRET` is configured.

---

## Database table: `google_calendar_connections`

```sql
create table if not exists google_calendar_connections (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  calendar_id text,
  primary_calendar text,
  refresh_token_enc text,          -- encrypted, never plaintext
  access_token_hash text,          -- hash only
  token_expiry timestamptz,
  status text not null default 'not_configured',
  last_sync_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (workspace_id)
);
```

---

## API routes

| Route | Method | Purpose |
|---|---|---|
| `/api/integrations/google/calendar/status` | GET | Returns connection state for settings page |
| `/api/integrations/google/calendar/connect` | GET | Builds OAuth URL and redirects user to Google |
| `/api/integrations/google/calendar/callback` | GET | Receives OAuth code, exchanges for tokens |

---

## Checklist before going live

- [ ] Google Calendar API enabled in Cloud Console
- [ ] OAuth consent screen configured and app reviewed (for External apps)
- [ ] `GOOGLE_CLIENT_ID` set
- [ ] `GOOGLE_CLIENT_SECRET` set (server-side only)
- [ ] `GOOGLE_REDIRECT_URI` matches exactly the URI registered in Cloud Console
- [ ] Token exchange implemented in `callback/route.ts`
- [ ] refresh_token encrypted at rest in Supabase
- [ ] Supabase table `google_calendar_connections` exists with RLS enabled
- [ ] Test: connect a Google account and verify status shows `connected`
