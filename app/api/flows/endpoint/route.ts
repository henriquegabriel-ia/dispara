/**
 * WhatsApp Flow Endpoint
 *
 * Endpoint para data_exchange em WhatsApp Flows.
 * Recebe requests criptografadas da Meta e responde com dados dinamicos.
 *
 * POST /api/flows/endpoint
 *
 * Handlers:
 * - ping: health check
 * - INIT: primeira tela do flow
 * - data_exchange: interacao do usuario
 * - BACK: usuario voltou para tela anterior
 */

import { NextRequest, NextResponse } from 'next/server'
import { settingsDb } from '@/lib/supabase-db'
import {
  decryptRequest,
  encryptResponse,
  createErrorResponse,
  generateKeyPair,
  type FlowDataExchangeRequest,
} from '@/lib/whatsapp/flow-endpoint-crypto'
import { handleFlowAction } from '@/lib/whatsapp/flow-endpoint-handlers'
import { getWhatsAppCredentials } from '@/lib/whatsapp-credentials'
import { metaSetEncryptionPublicKey } from '@/lib/meta-flows-api'

const PRIVATE_KEY_SETTING = 'whatsapp_flow_private_key'
const PUBLIC_KEY_SETTING = 'whatsapp_flow_public_key'
const LAST_KEY_REGEN_SETTING = 'whatsapp_flow_last_key_regen'

// Cooldown de 10 minutos entre regenerações de chave
const KEY_REGEN_COOLDOWN_MS = 10 * 60 * 1000

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    console.log('[flow-endpoint] 📥 POST received at', new Date().toISOString())

    // Valida campos obrigatorios
    const { encrypted_flow_data, encrypted_aes_key, initial_vector } = body
    if (!encrypted_flow_data || !encrypted_aes_key || !initial_vector) {
      console.error('[flow-endpoint] ❌ Campos obrigatorios ausentes')
      return NextResponse.json({ error: 'Campos obrigatorios ausentes' }, { status: 400 })
    }

    // Busca a chave privada (gera automaticamente se não existir)
    let privateKey = await settingsDb.get(PRIVATE_KEY_SETTING)

    if (!privateKey) {
      console.log('[flow-endpoint] 🔑 Chave privada não encontrada, gerando automaticamente...')

      const { publicKey, privateKey: newPrivateKey } = generateKeyPair()

      // Salva as chaves
      await Promise.all([
        settingsDb.set(PRIVATE_KEY_SETTING, newPrivateKey),
        settingsDb.set(PUBLIC_KEY_SETTING, publicKey),
      ])

      privateKey = newPrivateKey

      console.log('[flow-endpoint] ✅ Chaves RSA geradas e salvas automaticamente')

      // Tenta sincronizar com a Meta automaticamente
      try {
        const credentials = await getWhatsAppCredentials()
        if (credentials?.accessToken && credentials?.phoneNumberId) {
          await metaSetEncryptionPublicKey({
            accessToken: credentials.accessToken,
            phoneNumberId: credentials.phoneNumberId,
            publicKey,
          })
          console.log('[flow-endpoint] ✅ Chave pública sincronizada com a Meta automaticamente')
        } else {
          console.log('[flow-endpoint] ⚠️ Credenciais WhatsApp não configuradas, sincronização pendente')
        }
      } catch (syncError) {
        console.error('[flow-endpoint] ⚠️ Falha ao sincronizar com Meta (não-bloqueante):', syncError)
      }
    }

    // Descriptografa a request
    let decrypted
    try {
      decrypted = decryptRequest(
        { encrypted_flow_data, encrypted_aes_key, initial_vector },
        privateKey
      )
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      const isOaepError = errorMessage.includes('oaep') || errorMessage.includes('OAEP')

      console.error('[flow-endpoint] ❌ Erro ao descriptografar:', error)

      if (isOaepError) {
        // Verifica cooldown para evitar regenerar chaves em loop
        const lastRegenStr = await settingsDb.get(LAST_KEY_REGEN_SETTING)
        const lastRegen = lastRegenStr ? parseInt(lastRegenStr, 10) : 0
        const now = Date.now()
        const timeSinceLastRegen = now - lastRegen

        if (timeSinceLastRegen < KEY_REGEN_COOLDOWN_MS) {
          const remainingMinutes = Math.ceil((KEY_REGEN_COOLDOWN_MS - timeSinceLastRegen) / 60000)
          console.log(`[flow-endpoint] ⏳ OAEP Error, mas cooldown ativo. Aguarde ${remainingMinutes}min para nova tentativa de regeneração.`)
          console.log('[flow-endpoint] 💡 A Meta pode demorar alguns minutos para propagar a nova chave.')
        } else {
          console.log('[flow-endpoint] 🔑 OAEP Error detectado! Iniciando auto-recuperação...')

          // Auto-recuperação: regenera chaves e sincroniza com Meta
          try {
            const { publicKey: newPublicKey, privateKey: newPrivateKey } = generateKeyPair()

            await Promise.all([
              settingsDb.set(PRIVATE_KEY_SETTING, newPrivateKey),
              settingsDb.set(PUBLIC_KEY_SETTING, newPublicKey),
              settingsDb.set(LAST_KEY_REGEN_SETTING, String(now)),
            ])

            console.log('[flow-endpoint] ✅ Novas chaves RSA geradas')

            // Sincroniza com a Meta
            const credentials = await getWhatsAppCredentials()
            if (credentials?.accessToken && credentials?.phoneNumberId) {
              await metaSetEncryptionPublicKey({
                accessToken: credentials.accessToken,
                phoneNumberId: credentials.phoneNumberId,
                publicKey: newPublicKey,
              })
              console.log('[flow-endpoint] ✅ Nova chave pública sincronizada com a Meta')
              console.log('[flow-endpoint] 💡 A Meta pode levar até 5-10min para propagar a nova chave')
            } else {
              console.error('[flow-endpoint] ⚠️ Credenciais WhatsApp não configuradas, sincronização falhou')
            }
          } catch (recoveryError) {
            console.error('[flow-endpoint] ❌ Falha na auto-recuperação:', recoveryError)
          }
        }
      }

      return NextResponse.json(
        {
          error: 'Falha na descriptografia',
          hint: isOaepError
            ? 'Chaves foram regeneradas e sincronizadas. Tente novamente.'
            : undefined
        },
        { status: 421 }
      )
    }

    const flowRequest = decrypted.decryptedBody as unknown as FlowDataExchangeRequest
    console.log('[flow-endpoint] 🔓 Decrypted - Action:', flowRequest.action, 'Screen:', flowRequest.screen, 'Data:', JSON.stringify(flowRequest.data || {}))
    // #region agent log
    // #endregion

    // Health check - DEVE ser criptografado como todas as outras respostas
    // Ref: https://developers.facebook.com/docs/whatsapp/flows/guides/implementingyourflowendpoint#health_check_request
    if (flowRequest.action === 'ping') {
      console.log('[flow-endpoint] 🏓 PING received at', new Date().toISOString())
      const pingResponse = { data: { status: 'active' } }
      const encryptedPingResponse = encryptResponse(
        pingResponse,
        decrypted.aesKeyBuffer,
        decrypted.initialVectorBuffer
      )
      console.log('[flow-endpoint] 🔐 PING response encrypted, length:', encryptedPingResponse.length, 'isBase64:', !encryptedPingResponse.startsWith('{'))
      return new NextResponse(encryptedPingResponse, {
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
      })
    }

    // Processa a acao do flow
    let response
    try {
      response = await handleFlowAction(flowRequest)
      console.log('[flow-endpoint] ✅ Handler response:', JSON.stringify(response).substring(0, 500))
    } catch (error) {
      console.error('[flow-endpoint] ❌ Erro no handler:', error)
      response = createErrorResponse(
        error instanceof Error ? error.message : 'Erro interno'
      )
    }

    // Criptografa a response
    const encryptedResponse = encryptResponse(
      response,
      decrypted.aesKeyBuffer,
      decrypted.initialVectorBuffer
    )
    console.log('[flow-endpoint] 🔐 Response encrypted, length:', encryptedResponse.length)

    return new NextResponse(encryptedResponse, {
      status: 200,
      headers: { 'Content-Type': 'text/plain' },
    })
  } catch (error) {
    console.error('[flow-endpoint] Erro geral:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Erro interno' },
      { status: 500 }
    )
  }
}

/**
 * GET - Health check simples (sem criptografia)
 */
export async function GET() {
  const privateKey = await settingsDb.get(PRIVATE_KEY_SETTING)
  const configured = !!privateKey

  return NextResponse.json({
    status: configured ? 'ready' : 'not_configured',
    message: configured
      ? 'Flow endpoint configurado e pronto'
      : 'Chave privada nao configurada. Configure em /settings/flows',
  })
}
