import { NextResponse } from 'next/server'

export const dynamic = 'force-static'

/**
 * M2 static export: the real webhook logic now lives in a Supabase Edge Function.
 * This route exists purely so the build succeeds — it is never invoked at runtime.
 * The BSP webhook URL points at the Edge Function directly.
 */
export async function POST() {
  return NextResponse.json({ migrated: true }, { status: 200 })
}
