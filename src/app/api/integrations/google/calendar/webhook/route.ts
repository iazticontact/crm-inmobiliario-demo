// POST/GET /api/integrations/google/calendar/webhook
//
// SKELETON — NOT ACTIVE in local development.
//
// Google Calendar push notifications (watch) require a publicly reachable HTTPS URL.
// To activate:
//   1. Deploy NowCRM behind a public HTTPS domain (https://app.nowcrm.io or similar).
//   2. Set GOOGLE_CALENDAR_WEBHOOK_URL=https://<your-domain>/api/integrations/google/calendar/webhook
//   3. Set GOOGLE_CALENDAR_WEBHOOK_TOKEN=<long-random-string>  (verified via X-Goog-Channel-Token header)
//   4. Per workspace, register a watch via Google Calendar API:
//        POST https://www.googleapis.com/calendar/v3/calendars/{calendarId}/events/watch
//        Body: { id, type:'web_hook', address: GOOGLE_CALENDAR_WEBHOOK_URL, token: GOOGLE_CALENDAR_WEBHOOK_TOKEN, expiration }
//      Save returned channel_id + resource_id + expiration_at into google_calendar_connections.
//   5. Run a daily cron that re-registers watches before they expire (Google maxes ~7 days).
//
// When a change happens in Google, Google POSTs to this URL with these headers:
//   X-Goog-Channel-ID, X-Goog-Channel-Token, X-Goog-Resource-ID,
//   X-Goog-Resource-State (sync | exists | not_exists), X-Goog-Message-Number
// The body is empty. We look up the workspace/calendar by channel_id, then fetch the
// changed events via events.list (using incremental_sync_tokens for efficiency).
//
// Until activation, this handler short-circuits with 503 and logs nothing sensitive.
// Do NOT enable in development — without HTTPS Google will refuse to register the watch
// and you'll burn quota on failed re-registration attempts.

import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'

function isEnabled(): boolean {
  return Boolean(
    process.env.GOOGLE_CALENDAR_WEBHOOK_URL?.trim() &&
    process.env.GOOGLE_CALENDAR_WEBHOOK_TOKEN?.trim() &&
    process.env.NODE_ENV === 'production',
  )
}

export async function GET() {
  // Health check / Google verification probe
  if (!isEnabled()) {
    return NextResponse.json({ ok: false, status: 'disabled', reason: 'Google webhook requires public HTTPS URL and env vars (see docs/GOOGLE_CALENDAR_REALTIME.md)' }, { status: 503 })
  }
  return NextResponse.json({ ok: true, status: 'enabled' })
}

export async function POST(req: NextRequest) {
  if (!isEnabled()) {
    // Reject explicitly — do not silently 200 OK, or Google will keep pushing.
    return NextResponse.json({ ok: false, error: 'webhook_disabled' }, { status: 503 })
  }

  const expectedToken = process.env.GOOGLE_CALENDAR_WEBHOOK_TOKEN?.trim()
  const channelToken = req.headers.get('x-goog-channel-token')
  if (!channelToken || channelToken !== expectedToken) {
    console.warn('[google/calendar/webhook] Token mismatch')
    return NextResponse.json({ ok: false, error: 'invalid_token' }, { status: 401 })
  }

  // Real implementation TODO (production phase):
  //   1. Read X-Goog-Channel-ID + X-Goog-Resource-ID from headers
  //   2. Look up workspace by webhook_channel_id
  //   3. Pull incremental changes via events.list with stored syncToken
  //   4. Upsert / soft-cancel local rows in calendar_events
  //   5. Persist the new nextSyncToken into incremental_sync_tokens[calendarId]
  //
  // For now: acknowledge and log.

  console.log('[google/calendar/webhook]', {
    channelId: req.headers.get('x-goog-channel-id')?.slice(0, 12),
    resourceState: req.headers.get('x-goog-resource-state'),
    messageNumber: req.headers.get('x-goog-message-number'),
  })

  return NextResponse.json({ ok: true, received: true, note: 'skeleton — replace with real handler before going live' })
}
