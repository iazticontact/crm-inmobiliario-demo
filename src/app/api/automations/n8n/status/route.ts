import { NextResponse } from 'next/server'
import { checkN8nStatus } from '@/lib/n8n-client'

export const runtime = 'nodejs'

export async function GET() {
  const result = await checkN8nStatus()
  // Never expose N8N_API_KEY — only safe fields are returned
  return NextResponse.json({
    ok: result.ok,
    status: result.status,
    baseUrl: result.baseUrl,
    reason: result.reason,
  })
}
