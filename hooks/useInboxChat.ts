/**
 * useInboxChat - AI SDK v6 chat hook for inbox
 * Uses useChat from @ai-sdk/react with proper patterns
 */

'use client'

import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport, type UIMessage } from 'ai'
import { useCallback, useMemo, useEffect } from 'react'

// =============================================================================
// Types
// =============================================================================

export interface UseInboxChatOptions {
  /** Conversation ID to chat with */
  conversationId: string | null
  /** AI Agent ID to use */
  agentId: string | null
  /** Callback when AI decides to handoff */
  onHandoff?: (reason: string, summary?: string) => void
  /** Callback when message is sent */
  onMessageSent?: (content: string) => void
  /** Callback on error */
  onError?: (error: Error) => void
}

export interface InboxChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  createdAt?: Date
  // Tool result data if available
  toolResult?: {
    sentiment?: string
    confidence?: number
    shouldHandoff?: boolean
    handoffReason?: string
  }
}

// Tool output type for respond tool
interface RespondToolOutput {
  message?: string
  sentiment?: string
  confidence?: number
  shouldHandoff?: boolean
  handoffReason?: string
  handoffSummary?: string
}

// =============================================================================
// Hook
// =============================================================================

export function useInboxChat(options: UseInboxChatOptions) {
  const { conversationId, agentId, onHandoff, onMessageSent, onError } = options

  // Only enable chat if we have both IDs
  const isEnabled = Boolean(conversationId && agentId)

  // Use the chat hook with transport
  const chat = useChat({
    // Transport with custom body data
    transport: new DefaultChatTransport({
      api: '/api/inbox/chat',
      body: {
        conversationId,
        agentId,
      },
    }),

    // Handle tool calls - check for handoff
    onToolCall: async ({ toolCall }: { toolCall: { toolName: string; output?: unknown } }) => {
      // Handle the respond tool result
      if (toolCall.toolName === 'respond' && toolCall.output) {
        const result = toolCall.output as RespondToolOutput

        // Trigger handoff callback if needed
        if (result?.shouldHandoff && onHandoff) {
          onHandoff(
            result.handoffReason || 'Transferido para atendente',
            result.handoffSummary
          )
        }
      }
    },

    // Error handling
    onError: (error: Error) => {
      console.error('[useInboxChat] Error:', error)
      onError?.(error)
    },
  })

  const {
    messages,
    sendMessage: sdkSendMessage,
    status,
    error,
    regenerate,
    stop,
    setMessages,
  } = chat

  // Send message wrapper
  const sendMessage = useCallback(
    async (content: string) => {
      if (!isEnabled) {
        console.warn('[useInboxChat] Cannot send: missing conversationId or agentId')
        return
      }

      // Send via SDK - v6 uses text property
      sdkSendMessage({ text: content })

      // Notify callback
      onMessageSent?.(content)
    },
    [isEnabled, sdkSendMessage, onMessageSent]
  )

  // Clear messages (useful when switching conversations)
  const clearMessages = useCallback(() => {
    setMessages([])
  }, [setMessages])

  // Clear messages when conversation changes
  useEffect(() => {
    clearMessages()
  }, [conversationId, clearMessages])

  // Transform messages to our format
  const transformedMessages: InboxChatMessage[] = useMemo(() => {
    return messages.map((msg: UIMessage) => {
      const message: InboxChatMessage = {
        id: msg.id,
        role: msg.role as 'user' | 'assistant',
        content: '',
      }

      // Extract content from parts
      if (msg.parts) {
        for (const part of msg.parts) {
          if (part.type === 'text') {
            message.content = part.text
          }
          // Handle tool result - check for respond tool
          if (part.type.startsWith('tool-') && 'output' in part) {
            const output = part.output as RespondToolOutput
            if (output?.message) {
              message.content = output.message
              message.toolResult = {
                sentiment: output.sentiment,
                confidence: output.confidence,
                shouldHandoff: output.shouldHandoff,
                handoffReason: output.handoffReason,
              }
            }
          }
        }
      }

      return message
    })
  }, [messages])

  // Derived states
  const isReady = status === 'ready'
  const isLoading = status === 'submitted' || status === 'streaming'
  const isStreaming = status === 'streaming'

  return {
    // Messages
    messages: transformedMessages,
    rawMessages: messages,

    // Actions
    sendMessage,
    clearMessages,
    regenerate,
    stop,

    // Status
    status,
    isReady,
    isLoading,
    isStreaming,
    isEnabled,

    // Error
    error,
  }
}
