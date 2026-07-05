/**
 * AI Respond Endpoint - Versão Simplificada
 *
 * Endpoint único que processa mensagens do inbox com IA.
 * Substitui a arquitetura complexa de workflow durável por um fluxo direto.
 *
 * Fluxo:
 * 1. Webhook recebe mensagem → dispara via QStash.publish()
 * 2. Este endpoint: busca dados → processa IA → envia WhatsApp
 *
 * Usa Fluid Compute com maxDuration=300 (5 minutos) - suficiente para 99% dos casos.
 */

import { NextRequest, NextResponse } from 'next/server'
import { inboxDb } from '@/lib/inbox/inbox-db'
import { processChatAgent, type ContactContext } from '@/lib/ai/agents/chat-agent'
import { sendWhatsAppMessage, sendTypingIndicator } from '@/lib/whatsapp-send'
import { getSupabaseAdmin } from '@/lib/supabase'
import { redis } from '@/lib/redis'
import type { AIAgent } from '@/types'

// Fluid Compute: 5 minutos de timeout (suficiente para IA)
export const maxDuration = 300

// Desabilita cache
export const dynamic = 'force-dynamic'

// =============================================================================
// Types
// =============================================================================

interface AIRespondRequest {
  conversationId: string
  /** Tempo de debounce configurado no agente (para verificação de "parou de digitar") */
  debounceMs?: number
  /** ID da mensagem WhatsApp que disparou o processamento (para deduplicação) */
  messageId?: string
}

// =============================================================================
// POST Handler
// =============================================================================

export async function POST(req: NextRequest) {
  const startTime = Date.now()

  console.log(`🤖 [AI-RESPOND] ========================================`)
  console.log(`🤖 [AI-RESPOND] Request received at ${new Date().toISOString()}`)

  try {
    // 1. Parse request
    const body = (await req.json()) as AIRespondRequest
    const { conversationId, debounceMs, messageId } = body

    if (!conversationId) {
      console.log(`❌ [AI-RESPOND] Missing conversationId`)
      return NextResponse.json({ error: 'Missing conversationId' }, { status: 400 })
    }

    console.log(`🤖 [AI-RESPOND] Processing conversation: ${conversationId}, debounceMs: ${debounceMs}, messageId: ${messageId}`)

    // 1.2. DEDUPLICAÇÃO: Verifica se essa mensagem já foi processada
    // Última linha de defesa contra duplicatas (QStash retry, race conditions, etc.)
    if (messageId && redis) {
      const dedupKey = `ai:processed:${messageId}`
      const alreadyProcessed = await redis.get(dedupKey)

      if (alreadyProcessed) {
        console.log(`⏭️ [AI-RESPOND] Duplicate detected - message ${messageId} already processed at ${alreadyProcessed}`)
        return NextResponse.json({
          success: true,
          deduplicated: true,
          messageId,
          reason: 'already-processed',
        })
      }

      // Marca como "processando" ANTES de iniciar (evita race condition)
      // TTL de 30 minutos - tempo suficiente para qualquer processamento
      await redis.setex(dedupKey, 1800, new Date().toISOString())
      console.log(`🔒 [AI-RESPOND] Dedup lock acquired for message ${messageId}`)
    }

    // 1.5. Verificação de debounce - usuário parou de digitar?
    // Verifica se passou tempo suficiente desde a ÚLTIMA MENSAGEM
    if (debounceMs && debounceMs > 0 && redis) {
      const redisKey = `ai:lastmsg:${conversationId}`
      const lastMsgTimestamp = await redis.get<number>(redisKey)

      if (lastMsgTimestamp) {
        const now = Date.now()
        const timeSinceLastMsg = now - lastMsgTimestamp

        // Se não passou tempo suficiente, usuário ainda está digitando
        // Outro job (mais recente) vai processar
        if (timeSinceLastMsg < debounceMs) {
          console.log(`⏭️ [AI-RESPOND] Skipping - user still typing (${timeSinceLastMsg}ms < ${debounceMs}ms)`)
          return NextResponse.json({ skipped: true, reason: 'user-still-typing' })
        }

        // Passou tempo suficiente - usuário parou de digitar
        // Limpa a chave e processa
        await redis.del(redisKey)
        console.log(`🤖 [AI-RESPOND] User stopped typing (${timeSinceLastMsg}ms >= ${debounceMs}ms) - processing`)
      }
    }

    // 2. Busca conversa
    const conversation = await inboxDb.getConversation(conversationId)

    if (!conversation) {
      console.log(`❌ [AI-RESPOND] Conversation not found: ${conversationId}`)
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
    }

    // 3. Verifica se está em modo bot
    if (conversation.mode !== 'bot') {
      console.log(`⏭️ [AI-RESPOND] Skipping - mode is "${conversation.mode}", not "bot"`)
      return NextResponse.json({ skipped: true, reason: 'not-in-bot-mode' })
    }

    // 4. Verifica se automação está pausada
    if (conversation.automation_paused_until) {
      const pauseTime = new Date(conversation.automation_paused_until).getTime()
      if (pauseTime > Date.now()) {
        console.log(`⏭️ [AI-RESPOND] Skipping - automation paused until ${conversation.automation_paused_until}`)
        return NextResponse.json({ skipped: true, reason: 'automation-paused' })
      }
    }

    // 5. Busca agente
    const agent = await getAgentForConversation(conversation.ai_agent_id)

    if (!agent) {
      console.log(`❌ [AI-RESPOND] No agent configured`)
      return NextResponse.json({ error: 'No agent configured' }, { status: 400 })
    }

    if (!agent.is_active) {
      console.log(`⏭️ [AI-RESPOND] Skipping - agent "${agent.name}" is not active`)
      return NextResponse.json({ skipped: true, reason: 'agent-not-active' })
    }

    console.log(`🤖 [AI-RESPOND] Using agent: ${agent.name} (${agent.model})`)

    // 6. Busca mensagens recentes
    const { messages } = await inboxDb.listMessages(conversationId, { limit: 20 })
    console.log(`🤖 [AI-RESPOND] Found ${messages.length} messages`)

    if (messages.length === 0) {
      console.log(`⏭️ [AI-RESPOND] Skipping - no messages found`)
      return NextResponse.json({ skipped: true, reason: 'no-messages' })
    }

    // 7. Busca dados do contato (se existir)
    let contactData: ContactContext | undefined
    if (conversation.contact_id) {
      contactData = await getContactData(conversation.contact_id)
      if (contactData) {
        console.log(`🤖 [AI-RESPOND] Contact data loaded: ${contactData.name || 'unnamed'}`)
      }
    }

    // 8. Processa com IA
    console.log(`🚀 [AI-RESPOND] Calling processChatAgent...`)

    const result = await processChatAgent({
      agent,
      conversation,
      messages,
      contactData,
    })

    console.log(`✅ [AI-RESPOND] AI result: success=${result.success}, latency=${result.latencyMs}ms`)

    // 8. Trata erro da IA
    if (!result.success || !result.response?.message) {
      console.log(`❌ [AI-RESPOND] AI failed: ${result.error}`)

      // Auto-handoff em caso de erro
      await handleAutoHandoff(conversationId, conversation.phone, result.error || 'AI processing failed')

      return NextResponse.json({
        success: false,
        error: result.error || 'Empty response',
        handedOff: true,
      })
    }

    // 9. Envia resposta via WhatsApp (com split por parágrafos)
    console.log(`📤 [AI-RESPOND] Sending WhatsApp message to ${conversation.phone}...`)

    // Busca o whatsapp_message_id da ÚLTIMA mensagem inbound para typing indicator e quote
    // IMPORTANTE: usar findLast() para pegar a mais recente, não a primeira
    const lastInboundMessage = messages.findLast(m => m.direction === 'inbound' && m.whatsapp_message_id)
    const typingMessageId = lastInboundMessage?.whatsapp_message_id

    if (typingMessageId) {
      console.log(`⌨️ [AI-RESPOND] Will use typing indicator with message_id: ${typingMessageId}`)
    } else {
      console.log(`⚠️ [AI-RESPOND] No inbound message_id found, typing indicator disabled`)
    }

    // Split por \n\n (igual Evolution API) - cada parágrafo vira uma mensagem
    const messageParts = splitMessageByParagraphs(result.response.message)
    console.log(`📤 [AI-RESPOND] Message split into ${messageParts.length} parts`)

    const messageIds: string[] = []

    for (let i = 0; i < messageParts.length; i++) {
      const part = messageParts[i]

      // Envia typing indicator antes de cada parte (se tiver message_id)
      if (typingMessageId) {
        await sendTypingIndicator({ messageId: typingMessageId })
        console.log(`⌨️ [AI-RESPOND] Typing indicator sent for part ${i + 1}`)
      }

      // Delay proporcional ao tamanho da mensagem (simula digitação)
      // 10ms por caractere, mínimo 800ms, máximo 2s
      const typingDelay = Math.min(Math.max(part.length * 10, 800), 2000)
      await new Promise(r => setTimeout(r, typingDelay))

      // Se shouldQuoteUserMessage e é a primeira parte, envia como reply
      const shouldQuote = i === 0 && result.response.shouldQuoteUserMessage && typingMessageId

      const sendResult = await sendWhatsAppMessage({
        to: conversation.phone,
        type: 'text',
        text: part,
        replyToMessageId: shouldQuote ? typingMessageId : undefined,
      })

      if (shouldQuote) {
        console.log(`💬 [AI-RESPOND] First message sent as reply to user message`)
      }

      if (sendResult.success && sendResult.messageId) {
        messageIds.push(sendResult.messageId)

        // Salva cada parte no banco
        await inboxDb.createMessage({
          conversation_id: conversationId,
          direction: 'outbound',
          content: part,
          message_type: 'text',
          whatsapp_message_id: sendResult.messageId,
          delivery_status: 'sent',
          ai_response_id: i === 0 ? result.logId || null : null, // Só a primeira tem o logId
          ai_sentiment: i === messageParts.length - 1 ? result.response.sentiment : null, // Só a última tem sentiment
          ai_sources: i === messageParts.length - 1 ? result.response.sources || null : null,
        })

        console.log(`✅ [AI-RESPOND] Part ${i + 1}/${messageParts.length} sent: ${sendResult.messageId}`)

        // Pausa entre mensagens para o typing da próxima ser mais visível
        if (i < messageParts.length - 1) {
          await new Promise(r => setTimeout(r, 500)) // 500ms de "respiro"
        }
      } else {
        console.error(`❌ [AI-RESPOND] Failed to send part ${i + 1}:`, sendResult.error)
      }
    }

    console.log(`✅ [AI-RESPOND] All ${messageIds.length} messages sent`)

    // 10. Handoff se necessário
    if (result.response.shouldHandoff) {
      console.log(`🔄 [AI-RESPOND] Processing handoff request...`)

      await inboxDb.updateConversation(conversationId, { mode: 'human' })

      await inboxDb.createMessage({
        conversation_id: conversationId,
        direction: 'outbound',
        content: `🤖 **Transferência para atendente**\n\n${result.response.handoffReason ? `**Motivo:** ${result.response.handoffReason}\n` : ''}${result.response.handoffSummary ? `**Resumo:** ${result.response.handoffSummary}` : ''}`,
        message_type: 'internal_note',
        delivery_status: 'delivered',
        payload: {
          type: 'ai_handoff',
          reason: result.response.handoffReason,
          summary: result.response.handoffSummary,
          timestamp: new Date().toISOString(),
        },
      })

      console.log(`✅ [AI-RESPOND] Handoff completed`)
    }

    const elapsed = Date.now() - startTime

    console.log(`🎉 [AI-RESPOND] ========================================`)
    console.log(`🎉 [AI-RESPOND] COMPLETED in ${elapsed}ms`)
    console.log(`🎉 [AI-RESPOND] Sentiment: ${result.response.sentiment}`)
    console.log(`🎉 [AI-RESPOND] Handoff: ${result.response.shouldHandoff}`)
    console.log(`🎉 [AI-RESPOND] ========================================`)

    return NextResponse.json({
      success: true,
      conversationId,
      sentiment: result.response.sentiment,
      handoff: result.response.shouldHandoff,
      latencyMs: elapsed,
    })
  } catch (error) {
    const elapsed = Date.now() - startTime

    console.error(`💥 [AI-RESPOND] ========================================`)
    console.error(`💥 [AI-RESPOND] EXCEPTION after ${elapsed}ms`)
    console.error(`💥 [AI-RESPOND] Error:`, error)
    console.error(`💥 [AI-RESPOND] ========================================`)

    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Internal error' },
      { status: 500 }
    )
  }
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Busca dados do contato para injetar no contexto da IA
 */
async function getContactData(contactId: string): Promise<ContactContext | undefined> {
  const supabase = getSupabaseAdmin()
  if (!supabase) return undefined

  const { data, error } = await supabase
    .from('contacts')
    .select('name, email, created_at')
    .eq('id', contactId)
    .single()

  if (error || !data) return undefined

  return {
    name: data.name || undefined,
    email: data.email || undefined,
    created_at: data.created_at || undefined,
  }
}

/**
 * Busca o agente de IA para uma conversa
 * Prioridade: agente específico da conversa → agente padrão
 */
async function getAgentForConversation(agentId: string | null): Promise<AIAgent | null> {
  const supabase = getSupabaseAdmin()
  if (!supabase) return null

  // Tenta agente específico
  if (agentId) {
    const { data } = await supabase.from('ai_agents').select('*').eq('id', agentId).single()
    if (data) return data as AIAgent
  }

  // Fallback para agente padrão
  const { data } = await supabase
    .from('ai_agents')
    .select('*')
    .eq('is_active', true)
    .eq('is_default', true)
    .single()

  return (data as AIAgent) || null
}

/**
 * Auto-handoff em caso de erro
 * Envia mensagem de fallback e transfere para humano
 */
async function handleAutoHandoff(
  conversationId: string,
  phone: string,
  errorMessage: string
): Promise<void> {
  console.log(`🚨 [AI-RESPOND] Auto-handoff due to error: ${errorMessage}`)

  const fallbackMessage =
    'Desculpe, estou com dificuldades técnicas. Vou transferir você para um atendente.'

  // Envia mensagem de fallback
  const sendResult = await sendWhatsAppMessage({
    to: phone,
    type: 'text',
    text: fallbackMessage,
  })

  if (sendResult.success && sendResult.messageId) {
    await inboxDb.createMessage({
      conversation_id: conversationId,
      direction: 'outbound',
      content: fallbackMessage,
      message_type: 'text',
      whatsapp_message_id: sendResult.messageId,
      delivery_status: 'sent',
    })
  }

  // Muda para modo humano
  await inboxDb.updateConversation(conversationId, { mode: 'human' })

  // Cria nota interna
  await inboxDb.createMessage({
    conversation_id: conversationId,
    direction: 'outbound',
    content: `🤖 **Transferência automática**\n\n**Motivo:** Erro técnico: ${errorMessage}`,
    message_type: 'internal_note',
    delivery_status: 'delivered',
  })
}

/**
 * Divide mensagem por parágrafos (double line breaks)
 * Igual ao Evolution API - cada parágrafo vira uma mensagem separada
 */
function splitMessageByParagraphs(message: string): string[] {
  return message
    .split('\n\n')
    .map(part => part.trim())
    .filter(part => part.length > 0)
}
