import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'

/**
 * POST /api/push/subscribe
 *
 * Salva uma nova subscription de push no banco
 */
export async function POST(request: Request) {
  try {
    const subscription = await request.json()

    if (!subscription?.endpoint || !subscription?.keys) {
      return NextResponse.json({ error: 'Subscription inválida' }, { status: 400 })
    }

    const supabase = await createClient()

    // Upsert: atualiza se já existir, insere se não
    const { error } = await supabase.from('push_subscriptions').upsert(
      {
        endpoint: subscription.endpoint,
        keys: subscription.keys,
        user_agent: request.headers.get('user-agent'),
        last_used_at: new Date().toISOString(),
      },
      {
        onConflict: 'endpoint',
      }
    )

    if (error) {
      console.error('[Push Subscribe] Erro:', error)
      return NextResponse.json({ error: 'Erro ao salvar subscription' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[Push Subscribe] Erro inesperado:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}
