import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'

/**
 * POST /api/push/unsubscribe
 *
 * Remove uma subscription de push do banco
 */
export async function POST(request: Request) {
  try {
    const { endpoint } = await request.json()

    if (!endpoint) {
      return NextResponse.json({ error: 'Endpoint obrigatório' }, { status: 400 })
    }

    const supabase = await createClient()

    const { error } = await supabase.from('push_subscriptions').delete().eq('endpoint', endpoint)

    if (error) {
      console.error('[Push Unsubscribe] Erro:', error)
      return NextResponse.json({ error: 'Erro ao remover subscription' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[Push Unsubscribe] Erro inesperado:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}
