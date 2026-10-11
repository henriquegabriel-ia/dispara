import { NextRequest, NextResponse } from 'next/server'
import { settingsDb } from '@/lib/supabase-db'
import {
  clearStoredMetaAppSecretVerification,
  getMetaAppConfigPublic,
  getStoredMetaAppSecretState,
  hashMetaAppSecret,
  validateMetaAppCredentials,
} from '@/lib/meta-app-credentials'
import { isSupabaseConfigured } from '@/lib/supabase'
import { META_APP_SECRET_MISSING_ALERT_ID, clearMetaAppSecretCache } from '@/lib/meta-webhook-signature'
import { dismissMetaIntegrationAlerts } from '@/lib/meta-integration-alerts'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// GET - Retorna status público (não expõe o secret)
export async function GET() {
  try {
    const cfg = await getMetaAppConfigPublic()
    return NextResponse.json(cfg, {
      headers: {
        'Cache-Control': 'private, no-store, no-cache, must-revalidate, max-age=0',
        Pragma: 'no-cache',
        Expires: '0',
      },
    })
  } catch (error) {
    console.error('Error fetching Meta App config:', error)
    // Evita 500 para não quebrar a página de Settings.
    return NextResponse.json({
      source: 'none',
      appId: null,
      hasAppSecret: false,
      isConfigured: false,
      ...(isSupabaseConfigured() ? { warning: 'Falha ao carregar config do Meta App.' } : { warning: 'Supabase não configurado.' }),
    })
  }
}

/**
 * Zera a verificação do App Secret quando o secret salvo muda: o novo secret volta a
 * 'report_only' até a Meta mandar uma assinatura válida para ele. Se for o MESMO
 * secret já comprovado (o form reenvia ao salvar), mantém. Best-effort: mesmo sem
 * limpar, o hash comprovado não confere com um secret diferente.
 */
async function resetVerificationIfSecretChanged(nextSecret: string | null): Promise<void> {
  try {
    if (nextSecret) {
      const current = await getStoredMetaAppSecretState()
      if (current.verifiedHash && current.verifiedHash === hashMetaAppSecret(nextSecret)) return
    }
    await clearStoredMetaAppSecretVerification()
  } catch (error) {
    console.warn('[meta-app] Falha ao zerar a verificação do App Secret (best-effort):', error)
  }
}

// POST - Salva App ID/Secret no Supabase settings
// Observação: secret NUNCA é retornado; no máximo confirmamos booleanos.
export async function POST(request: NextRequest) {
  try {
    if (!isSupabaseConfigured()) {
      return NextResponse.json({ error: 'Supabase não configurado. Complete o setup antes de salvar.' }, { status: 400 })
    }

    const body = (await request.json().catch(() => ({}))) as { appId?: unknown; appSecret?: unknown }
    const appId = String(body?.appId || '').trim()
    const appSecret = String(body?.appSecret || '').trim()

    if (!appId) {
      return NextResponse.json({ error: 'appId é obrigatório' }, { status: 400 })
    }

    // Para upload (Resumable Upload API), precisamos apenas do App ID.
    // O App Secret é opcional: usado em diagnósticos (/debug_token) e na assinatura
    // X-Hub-Signature-256 do webhook e do endpoint de Flows. Um secret errado não pode
    // ser salvo: o par App ID + App Secret é conferido na Graph antes de gravar.
    let appSecretValidation: 'valid' | 'unavailable' | null = null
    let warning: string | undefined
    if (appSecret) {
      const validation = await validateMetaAppCredentials(appId, appSecret)
      if (validation.status === 'invalid') {
        return NextResponse.json(
          {
            error:
              'App Secret não confere com o App ID informado. Copie o App Secret do mesmo App em developers.facebook.com > App > Configurações > Básico (não use o Client Token).',
            code: 'invalid_app_secret',
            details: { graphCode: validation.graphCode, message: validation.message },
          },
          { status: 400 }
        )
      }
      appSecretValidation = validation.status
      if (validation.status === 'unavailable') {
        console.warn('[meta-app] Não foi possível validar o App Secret na Graph; salvando assim mesmo:', validation.message)
        warning =
          'Não foi possível validar o App Secret com a Meta agora. Ele foi salvo e fica em verificação: a assinatura só passa a ser exigida depois que a Meta enviar uma requisição assinada com ele.'
      }
    }

    await settingsDb.set('metaAppId', appId)
    if (appSecret) {
      await resetVerificationIfSecretChanged(appSecret)
      await settingsDb.set('metaAppSecret', appSecret)
      // O secret também verifica a assinatura do webhook (cache de 60s por instância).
      clearMetaAppSecretCache()
      await dismissMetaIntegrationAlerts(META_APP_SECRET_MISSING_ALERT_ID)
    }

    const cfg = await getMetaAppConfigPublic()
    return NextResponse.json({
      success: true,
      ...cfg,
      ...(appSecret
        ? {
            appSecretValidation,
            // Mesmo validado na Graph, só uma assinatura válida prova que é o App que
            // envia o webhook: até lá, 'report_only' (ver lib/meta-webhook-signature.ts).
            signatureVerification: 'pending_verification' as const,
          }
        : {}),
      ...(warning ? { warning } : {}),
    })
  } catch (error) {
    console.error('Error saving Meta App config:', error)
    return NextResponse.json({ error: 'Failed to save Meta App config' }, { status: 502 })
  }
}

// DELETE - Remove do DB (não mexe nas env vars)
export async function DELETE() {
  try {
    if (!isSupabaseConfigured()) {
      return NextResponse.json({ error: 'Supabase não configurado. Complete o setup antes de remover.' }, { status: 400 })
    }

    await settingsDb.set('metaAppId', '')
    await settingsDb.set('metaAppSecret', '')
    await resetVerificationIfSecretChanged(null)
    clearMetaAppSecretCache()

    const cfg = await getMetaAppConfigPublic()
    return NextResponse.json({ success: true, ...cfg })
  } catch (error) {
    console.error('Error deleting Meta App config:', error)
    return NextResponse.json({ error: 'Failed to delete Meta App config' }, { status: 502 })
  }
}
