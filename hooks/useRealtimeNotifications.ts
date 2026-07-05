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
import type { RealtimePayload, RealtimeTable } from '@/types'

type ToastType = 'success' | 'info' | 'warning' | 'error'

interface NotificationConfig {
    table: RealtimeTable
    getMessage: (payload: RealtimePayload) => string | null
    type?: ToastType
}

const DEFAULT_NOTIFICATIONS: NotificationConfig[] = [
    {
        table: 'campaigns',
        getMessage: (payload) => {
            const data = payload.new as Record<string, unknown> | null
            if (!data) return null

            const oldData = (payload.old as Record<string, unknown> | null) ?? null

            // Realtime payload normalmente traz colunas do Postgres (snake_case).
            const newStatus = data.status
            const oldStatus = oldData?.status

            const newCompletedAt = (data.completed_at ?? data.completedAt) as unknown
            const oldCompletedAt = (oldData?.completed_at ?? oldData?.completedAt) as unknown

            if (payload.eventType === 'UPDATE') {
                // Só notificar quando houver TRANSIÇÃO real para o estado final.
                // Caso contrário, updates de contadores (delivered/read) após conclusão viram spam.
                if (newStatus === 'Concluído') {
                    const statusTransition = oldStatus !== 'Concluído'
                    const completedAtTransition = (oldCompletedAt == null) && (newCompletedAt != null)

                    if (!statusTransition && !completedAtTransition) return null

                    const name = (data.name as string | undefined) ?? 'Sem nome'
                    return `Campanha "${name}" concluída!`
                }
                if (newStatus === 'Falhou') {
                    const statusTransition = oldStatus !== 'Falhou'
                    if (!statusTransition) return null

                    const name = (data.name as string | undefined) ?? 'Sem nome'
                    return `Campanha "${name}" falhou`
                }
            }
            return null
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

    const handleEvent = useCallback((config: NotificationConfig, payload: RealtimePayload) => {
        if (!mountedRef.current) return

        const message = config.getMessage(payload)
        if (!message) return

        // Dedupe extra para proteger contra múltiplas subscriptions/reconnect/StrictMode.
        const key = dedupeKey(config, payload)
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
                handleEvent(config, payload)
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
