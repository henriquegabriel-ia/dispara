import { NextRequest, NextResponse } from 'next/server'
import { getCalendarChannel, markCalendarNotification } from '@/lib/google-calendar'
import { isSupabaseConfigured } from '@/lib/supabase'

export async function POST(request: NextRequest) {
  try {
    if (!isSupabaseConfigured()) {
      return NextResponse.json({ ok: false, error: 'Supabase nao configurado' }, { status: 400 })
    }

    const channel = await getCalendarChannel()
    const channelToken = request.headers.get('x-goog-channel-token')
    const resourceState = request.headers.get('x-goog-resource-state')

    if (!channel || !channelToken || channelToken !== channel.token) {
      return NextResponse.json({ ok: false }, { status: 401 })
    }

    await markCalendarNotification({ resourceState })

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('[google-calendar] webhook error:', error)
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}

export async function GET() {
  return NextResponse.json({ ok: true })
}
