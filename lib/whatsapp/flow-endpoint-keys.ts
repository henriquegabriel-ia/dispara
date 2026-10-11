/**
 * WhatsApp Flow Endpoint - gestão automática das chaves RSA
 *
 * Gerar/regenerar a chave e re-registrar a pública na Meta é uma ação com efeito
 * colateral forte: a Meta passa a cifrar com a chave nova e todos os Flows em
 * andamento recebem 421 até a propagação. Por isso o endpoint só faz isso quando
 * a request tem assinatura X-Hub-Signature-256 VERIFICADA (prova de que veio da
 * Meta). Sem App Secret (modo unsigned_allowed) qualquer um consegue mandar lixo,
 * então nunca há regeneração automática — o dono gera as chaves em Configurações.
 */

import { settingsDb } from '@/lib/supabase-db'
import { generateKeyPair } from '@/lib/whatsapp/flow-endpoint-crypto'
import { getWhatsAppCredentials } from '@/lib/whatsapp-credentials'
import { metaSetEncryptionPublicKey } from '@/lib/meta-flows-api'

export const FLOW_PRIVATE_KEY_SETTING = 'whatsapp_flow_private_key'
export const FLOW_PUBLIC_KEY_SETTING = 'whatsapp_flow_public_key'
export const FLOW_LAST_KEY_REGEN_SETTING = 'whatsapp_flow_last_key_regen'

// Cooldown de 10 minutos entre regenerações de chave
export const FLOW_KEY_REGEN_COOLDOWN_MS = 10 * 60 * 1000

export type FlowKeyRecoveryDecision =
  | 'regenerate'      // assinatura verificada, chave ausente/trocada, fora do cooldown
  | 'cooldown'        // regenerou há pouco; espera a Meta propagar a chave
  | 'unverified'      // assinatura não verificada: nunca gera/regenera
  | 'not_applicable'  // erro de decifração que não indica chave trocada

/**
 * - missing_key: não há chave privada salva (ou a leitura do banco falhou — por
 *   isso o cooldown também vale aqui, para não sobrescrever a chave boa em loop);
 * - oaep_error: a AES key não abre com a nossa chave privada (a Meta usa outra pública);
 * - other_error: qualquer outra falha de decifração (não regenera).
 */
export type FlowKeyRecoveryTrigger = 'missing_key' | 'oaep_error' | 'other_error'

export function isOaepDecryptError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return message.includes('oaep') || message.includes('OAEP')
}

export function decideFlowKeyRecovery(params: {
  signatureVerified: boolean
  trigger: FlowKeyRecoveryTrigger
  lastRegenAt: number
  now: number
}): FlowKeyRecoveryDecision {
  if (params.trigger === 'other_error') return 'not_applicable'
  if (!params.signatureVerified) return 'unverified'
  const lastRegenAt = Number.isFinite(params.lastRegenAt) ? params.lastRegenAt : 0
  if (params.now - lastRegenAt < FLOW_KEY_REGEN_COOLDOWN_MS) return 'cooldown'
  return 'regenerate'
}

export async function getLastFlowKeyRegenAt(): Promise<number> {
  const raw = await settingsDb.get(FLOW_LAST_KEY_REGEN_SETTING)
  const parsed = raw ? parseInt(raw, 10) : 0
  return Number.isFinite(parsed) ? parsed : 0
}

/**
 * Gera um novo par RSA, salva nas settings (com o timestamp do cooldown) e tenta
 * registrar a chave pública na Meta (best-effort).
 */
export async function rotateFlowEndpointKeys(now: number = Date.now()): Promise<{ metaSynced: boolean }> {
  const { publicKey, privateKey } = generateKeyPair()

  await Promise.all([
    settingsDb.set(FLOW_PRIVATE_KEY_SETTING, privateKey),
    settingsDb.set(FLOW_PUBLIC_KEY_SETTING, publicKey),
    settingsDb.set(FLOW_LAST_KEY_REGEN_SETTING, String(now)),
  ])
  console.log('[flow-endpoint] ✅ Novas chaves RSA geradas')

  try {
    const credentials = await getWhatsAppCredentials()
    if (credentials?.accessToken && credentials?.phoneNumberId) {
      await metaSetEncryptionPublicKey({
        accessToken: credentials.accessToken,
        phoneNumberId: credentials.phoneNumberId,
        publicKey,
      })
      console.log('[flow-endpoint] ✅ Nova chave pública sincronizada com a Meta')
      console.log('[flow-endpoint] 💡 A Meta pode levar até 5-10min para propagar a nova chave')
      return { metaSynced: true }
    }
    console.error('[flow-endpoint] ⚠️ Credenciais WhatsApp não configuradas, sincronização com a Meta pendente')
  } catch (syncError) {
    console.error('[flow-endpoint] ⚠️ Falha ao sincronizar chave com a Meta (não-bloqueante):', syncError)
  }
  return { metaSynced: false }
}
