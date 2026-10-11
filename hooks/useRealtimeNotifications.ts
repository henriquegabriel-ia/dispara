'use client'

/**
 * useRealtimeNotifications Hook
 * 
 * Subscribes to global events and shows toast notifications.
 * Part of US5: Real-time Notifications (T021)
 */

import { useEffect, useRef, useCallback } from 'react'
import { toast } from 'sonner'
import { createRealtimeChannel, subscribeToTable, activateChannel, removeChannel } from '@/lib/supabase-realtime'
import { campaignService } from '@/services/campaignService'
import type { RealtimePayload, RealtimeTable } from '@/types'

type ToastType = 'success' | 'info' | 'warning' | 'error'

interface NotificationConfig {
    table: RealtimeTable
    getMessage: (payload: RealtimePayload) => string | null | Promise<string | null>
    type?: ToastType
}

type CampaignFinalStatus = 'Concluído' | 'Falhou'

/**
 * Detecta a TRANSIÇÃO real de uma campanha para um estado final a partir do evento
 * realtime (só colunas whitelisted: id, status, completed_at...). Updates de contadores
 * (delivered/read) após a conclusão não são transição — senão viram spam.
 */
export function getCampaignFinalTransition(
    payload: RealtimePayload
): { id: string; status: CampaignFinalStatus } | null {
    if (payload.eventType !== 'UPDATE') return null

    const data = payload.new as Record<string, unknown> | null
    if (!data) return null
    const id = data.id
    if (typeof id !== 'string' || !id) return null

    const oldData = (payload.old as Record<string, unknown> | null) ?? null

    // Realtime payload normalmente traz colunas do Postgres (snake_case).
    const newStatus = data.status
    const oldStatus = oldData?.status

    const newCompletedAt = (data.completed_at ?? data.completedAt) as unknown
    const oldCompletedAt = (oldData?.completed_at ?? oldData?.completedAt) as unknown

    if (newStatus === 'Concluído') {
        const statusTransition = oldStatus !== 'Concluído'
        const completedAtTransition = (oldCompletedAt == null) && (newCompletedAt != null)

        if (!statusTransition && !completedAtTransition) return null
        return { id, status: 'Concluído' }
    }
    if (newStatus === 'Falhou') {
        const statusTransition = oldStatus !== 'Falhou'
        if (!statusTransition) return null
        return { id, status: 'Falhou' }
    }
    return null
}

// ----------------------------------------------------------------------------
// Confirmação da transição pela API (canal público: eventos forjáveis)
// ----------------------------------------------------------------------------

/** id+status que a API não confirmou (404 ou outro status) não são buscados de novo por este tempo. */
export const CAMPAIGN_CONFIRM_NEGATIVE_TTL_MS = 60_000
/** Teto de buscas por janela: ids aleatórios furam o cache negativo, o teto não. */
export const CAMPAIGN_CONFIRM_BUDGET = 5
export const CAMPAIGN_CONFIRM_BUDGET_WINDOW_MS = 10_000
const CAMPAIGN_CONFIRM_NEGATIVE_MAX_ENTRIES = 500

type ConfirmedCampaign = NonNullable<Awaited<ReturnType<typeof campaignService.getById>>>

const campaignConfirmations = {
    /** Busca em curso por id (eventos repetidos reaproveitam a mesma requisição) */
    inFlight: new Map<string, Promise<ConfirmedCampaign | undefined>>(),
    /** `${id}:${status}` → expira em (ms) */
    negative: new Map<string, number>(),
    /** Instantes das últimas buscas (orçamento) */
    recentLookups: [] as number[],
}

/** @internal Só para testes: zera caches e orçamento da confirmação. */
export function __resetCampaignConfirmationsForTests(): void {
    campaignConfirmations.inFlight.clear()
    campaignConfirmations.negative.clear()
    campaignConfirmations.recentLookups = []
}

function rememberUnconfirmed(key: string, now: number): void {
    const { negative } = campaignConfirmations
    if (negative.size >= CAMPAIGN_CONFIRM_NEGATIVE_MAX_ENTRIES) {
        negative.forEach((expiresAt, k) => {
            if (expiresAt <= now) negative.delete(k)
        })
        // Ainda cheio (flood de ids distintos): descarta os mais antigos
        while (negative.size >= CAMPAIGN_CONFIRM_NEGATIVE_MAX_ENTRIES) {
            const oldest = negative.keys().next().value
            if (oldest === undefined) break
            negative.delete(oldest)
        }
    }
    negative.set(key, now + CAMPAIGN_CONFIRM_NEGATIVE_TTL_MS)
}

/**
 * Confirma pela API autenticada que a campanha está mesmo no status final do evento.
 * O broadcast não traz o nome (canal público, sem dados de negócio) e aceita eventos
 * forjados, então cada evento custaria um GET /api/campaigns/<id>. Para não virar
 * amplificador: cache negativo com TTL (404 / status diferente), deduplicação das
 * buscas em curso por id e um teto de buscas por janela.
 *
 * @returns a campanha confirmada, ou null (não confirmada, em cache negativo ou sem orçamento)
 */
export async function confirmCampaignStatus(
    id: string,
    status: CampaignFinalStatus
): Promise<ConfirmedCampaign | null> {
    const now = Date.now()
    const negativeKey = `${id}:${status}`
    const expiresAt = campaignConfirmations.negative.get(negativeKey)
    if (expiresAt !== undefined) {
        if (expiresAt > now) return null
        campaignConfirmations.negative.delete(negativeKey)
    }

    let lookup = campaignConfirmations.inFlight.get(id)
    if (!lookup) {
        const recent = campaignConfirmations.recentLookups.filter(
            (at) => now - at < CAMPAIGN_CONFIRM_BUDGET_WINDOW_MS
        )
        if (recent.length >= CAMPAIGN_CONFIRM_BUDGET) {
            campaignConfirmations.recentLookups = recent
            return null
        }
        recent.push(now)
        campaignConfirmations.recentLookups = recent

        const request: Promise<ConfirmedCampaign | undefined> = campaignService.getById(id).catch(() => undefined)
        campaignConfirmations.inFlight.set(id, request)
        void request.finally(() => {
            if (campaignConfirmations.inFlight.get(id) === request) campaignConfirmations.inFlight.delete(id)
        })
        lookup = request
    }

    const campaign = await lookup
    if (!campaign || campaign.status !== status) {
        rememberUnconfirmed(negativeKey, Date.now())
        return null
    }
    return campaign
}

const DEFAULT_NOTIFICATIONS: NotificationConfig[] = [
    {
        table: 'campaigns',
        getMessage: async (payload) => {
            const transition = getCampaignFinalTransition(payload)
            if (!transition) return null

            // Busca pela API autenticada, que também confirma o status (ver confirmCampaignStatus).
            const campaign = await confirmCampaignStatus(transition.id, transition.status)
            if (!campaign) return null

            const name = campaign.name || 'Sem nome'
            return transition.status === 'Concluído'
                ? `Campanha "${name}" concluída!`
                : `Campanha "${name}" falhou`
        },
        // Tipo é inferido no handler (Concluído=success, Falhou=error)
    },
    // Note: Contacts notifications removed to avoid spam during bulk imports
]

interface UseRealtimeNotificationsOptions {
    /**
     * Enable/disable notifications (default: true)
     */
    enabled?: boolean

    /**
     * Custom notification configurations (default: campaigns + contacts)
     */
    notifications?: NotificationConfig[]
}

/**
 * Shows toast notifications for real-time events
 * 
 * @example
 * ```tsx
 * // In layout or root component
 * useRealtimeNotifications({ enabled: true })
 * ```
 */
export function useRealtimeNotifications({
    enabled = true,
    notifications = DEFAULT_NOTIFICATIONS,
}: UseRealtimeNotificationsOptions = {}) {
    const channelRef = useRef<ReturnType<typeof createRealtimeChannel> | null>(null)
    const mountedRef = useRef(true)
    const notifiedRef = useRef<Set<string>>(new Set())
    const pendingRef = useRef<Set<string>>(new Set())

    const inferType = useCallback((config: NotificationConfig, payload: RealtimePayload): ToastType => {
        if (config.type) return config.type

        if (config.table === 'campaigns' && payload.eventType === 'UPDATE') {
            const data = payload.new as Record<string, unknown> | null
            const status = data?.status
            if (status === 'Falhou') return 'error'
            if (status === 'Concluído') return 'success'
        }

        return 'info'
    }, [])

    const dedupeKey = useCallback((config: NotificationConfig, payload: RealtimePayload): string | null => {
        if (config.table !== 'campaigns') return null
        if (payload.eventType !== 'UPDATE') return null

        const data = payload.new as Record<string, unknown> | null
        if (!data) return null

        const id = (data.id as string | undefined) ?? null
        const status = (data.status as string | undefined) ?? null
        if (!id || !status) return null

        // Um toast por campanha+status por sessão
        return `campaign:${id}:${status}`
    }, [])

    const handleEvent = useCallback(async (config: NotificationConfig, payload: RealtimePayload) => {
        if (!mountedRef.current) return

        // Dedupe extra para proteger contra múltiplas subscriptions/reconnect/StrictMode.
        // `pending` evita buscar a mesma campanha 2x enquanto a primeira busca não volta.
        const key = dedupeKey(config, payload)
        if (key && (notifiedRef.current.has(key) || pendingRef.current.has(key))) return

        let message: string | null
        if (key) pendingRef.current.add(key)
        try {
            message = await config.getMessage(payload)
        } catch {
            message = null
        } finally {
            if (key) pendingRef.current.delete(key)
        }
        if (!message || !mountedRef.current) return

        if (key) {
            if (notifiedRef.current.has(key)) return
            notifiedRef.current.add(key)
        }

        const type = inferType(config, payload)

        // Show toast based on type
        switch (type) {
            case 'success':
                toast.success(message, key ? { id: key } : undefined)
                break
            case 'warning':
                toast.warning(message, key ? { id: key } : undefined)
                break
            case 'error':
                toast.error(message, key ? { id: key } : undefined)
                break
            case 'info':
            default:
                toast.info(message, key ? { id: key } : undefined)
        }
    }, [dedupeKey, inferType])

    useEffect(() => {
        if (!enabled) return

        mountedRef.current = true

        const channelName = `notifications-${Date.now()}`
        const channel = createRealtimeChannel(channelName)

        // Skip if Supabase not configured
        if (!channel) {
            // Warning is handled centrally in supabase-realtime.ts
            return
        }

        channelRef.current = channel

        // Subscribe to each configured table
        notifications.forEach((config) => {
            subscribeToTable(channel, config.table, '*', (payload) => {
                void handleEvent(config, payload)
            })
        })

        // Activate with silent mode to avoid duplicate error logs
        activateChannel(channel, undefined, { silent: true }).catch(() => {
            // Errors are logged centrally in supabase-realtime.ts
        })

        return () => {
            mountedRef.current = false
            if (channelRef.current) {
                removeChannel(channelRef.current)
                channelRef.current = null
            }
        }
    }, [enabled, notifications, handleEvent])
}
