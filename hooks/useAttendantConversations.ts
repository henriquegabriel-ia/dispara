/**
 * Hook para buscar conversas na página de atendimento
 *
 * Usa React Query para cache e refetch automático.
 * Formata dados especificamente para a UI de atendimento.
 */

import { useQuery } from '@tanstack/react-query'

// =============================================================================
// TIPOS
// =============================================================================

export type AttendantConversationStatus = 'ai_active' | 'human_active' | 'handoff_requested' | 'resolved'

export interface AttendantConversation {
  id: string
  contactName: string
  contactPhone: string
  contactAvatar?: string
  status: AttendantConversationStatus
  lastMessage: string
  lastMessageAt: string // ISO string para serialização
  unreadCount: number
  isTyping?: boolean
  aiAgentName?: string
}

interface ConversationsResponse {
  conversations: AttendantConversation[]
  counts: {
    total: number
    urgent: number
    ai: number
    human: number
    resolved: number
  }
}

interface UseAttendantConversationsOptions {
  status?: 'open' | 'closed'
  search?: string
  buttonPayload?: string
  templateName?: string
  enabled?: boolean
  refetchInterval?: number
}

// =============================================================================
// FETCHER
// =============================================================================

async function fetchConversations(
  status?: string,
  search?: string,
  buttonPayload?: string,
  templateName?: string
): Promise<ConversationsResponse> {
  const params = new URLSearchParams()
  if (status) params.set('status', status)
  if (search) params.set('search', search)
  if (buttonPayload) params.set('button', buttonPayload)
  if (templateName) params.set('template', templateName)

  const url = `/api/attendant/conversations${params.toString() ? `?${params}` : ''}`
  const response = await fetch(url)

  if (!response.ok) {
    throw new Error('Falha ao carregar conversas')
  }

  return response.json()
}

// =============================================================================
// HOOK
// =============================================================================

export function useAttendantConversations(options: UseAttendantConversationsOptions = {}) {
  const {
    status,
    search,
    buttonPayload,
    templateName,
    enabled = true,
    refetchInterval = 10000, // Refetch a cada 10 segundos
  } = options

  const query = useQuery({
    queryKey: ['attendant-conversations', status, search, buttonPayload, templateName],
    queryFn: () => fetchConversations(status, search, buttonPayload, templateName),
    enabled,
    refetchInterval,
    staleTime: 5000, // Considera dados frescos por 5 segundos
  })

  return {
    conversations: query.data?.conversations || [],
    counts: query.data?.counts || { total: 0, urgent: 0, ai: 0, human: 0, resolved: 0 },
    isLoading: query.isLoading,
    isRefetching: query.isRefetching,
    error: query.error,
    refetch: query.refetch,
  }
}

// =============================================================================
// HELPERS
// =============================================================================

export function formatRelativeTime(dateString: string | Date): string {
  const date = typeof dateString === 'string' ? new Date(dateString) : dateString
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / (1000 * 60))
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60))
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

  if (diffMins < 1) return 'agora'
  if (diffMins < 60) return `${diffMins}min`
  if (diffHours < 24) return `${diffHours}h`
  if (diffDays < 7) return `${diffDays}d`

  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
}

export function getStatusEmoji(status: AttendantConversationStatus): string {
  const emojis: Record<AttendantConversationStatus, string> = {
    ai_active: '🤖',
    human_active: '👤',
    handoff_requested: '🚨',
    resolved: '✅',
  }
  return emojis[status]
}

export function getStatusLabel(status: AttendantConversationStatus): string {
  const labels: Record<AttendantConversationStatus, string> = {
    ai_active: 'IA Ativo',
    human_active: 'Humano',
    handoff_requested: 'Quer Humano',
    resolved: 'Resolvido',
  }
  return labels[status]
}

export function getStatusColor(status: AttendantConversationStatus): string {
  const colors: Record<AttendantConversationStatus, string> = {
    ai_active: 'text-blue-500',
    human_active: 'text-green-500',
    handoff_requested: 'text-red-500',
    resolved: 'text-slate-500',
  }
  return colors[status]
}
