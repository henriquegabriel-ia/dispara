import { useEffect, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type { AccountAlert } from '@/app/api/account/alerts/route'
import { getSupabaseBrowser } from '@/lib/supabase'

interface AlertsResponse {
  alerts: AccountAlert[]
  error?: string
}

async function fetchAlerts(): Promise<AlertsResponse> {
  const response = await fetch('/api/account/alerts', { cache: 'no-store' })
  if (!response.ok) {
    throw new Error('Falha ao carregar alertas')
  }
  return response.json()
}

async function dismissAlert(alertId: string): Promise<void> {
  const response = await fetch(`/api/account/alerts?id=${alertId}`, {
    method: 'DELETE'
  })
  if (!response.ok) {
    throw new Error('Falha ao dispensar alerta')
  }
}

async function dismissAllAlerts(): Promise<void> {
  const response = await fetch('/api/account/alerts?all=true', {
    method: 'DELETE'
  })
  if (!response.ok) {
    throw new Error('Falha ao dispensar alertas')
  }
}

export function useAccountAlerts() {
  const queryClient = useQueryClient()

  // Realtime: mantém o banner/alertas em sincronia sem depender apenas de polling.
  useEffect(() => {
    const supabaseClient = getSupabaseBrowser()
    if (!supabaseClient) return

    const mapRowToAlert = (row: any): AccountAlert => {
      const details = row?.details
      return {
        id: row?.id,
        type: row?.type,
        code: row?.code ?? null,
        message: row?.message,
        details:
          details == null
            ? null
            : (typeof details === 'string' ? details : JSON.stringify(details)),
        dismissed: !!row?.dismissed,
        created_at: row?.created_at,
      }
    }

    const channel = supabaseClient
      .channel('account-alerts-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'account_alerts' },
        (payload: any) => {
          const eventType = payload?.eventType ?? payload?.type
          const newRow = payload?.new ?? null
          const oldRow = payload?.old ?? null

          queryClient.setQueryData<AlertsResponse>(['account-alerts'], (current) => {
            const existing = current?.alerts || []

            // DELETE (raro no nosso caso; normalmente é UPDATE dismissed=true)
            if (eventType === 'DELETE') {
              const id = oldRow?.id
              if (!id) return current
              return { ...(current || {}), alerts: existing.filter((a) => a.id !== id) }
            }

            if (eventType === 'INSERT' || eventType === 'UPDATE') {
              if (!newRow?.id) return current

              // Se foi dispensado, some da lista
              if (newRow.dismissed) {
                return { ...(current || {}), alerts: existing.filter((a) => a.id !== newRow.id) }
              }

              const incoming = mapRowToAlert(newRow)
              const idx = existing.findIndex((a) => a.id === incoming.id)
              if (idx >= 0) {
                const next = [...existing]
                next[idx] = incoming
                return { ...(current || {}), alerts: next }
              }

              // Mantém o comportamento do GET: mais recente primeiro, limite 10
              return { ...(current || {}), alerts: [incoming, ...existing].slice(0, 10) }
            }

            return current
          })
        }
      )
      .subscribe()

    return () => {
      void channel.unsubscribe()
      supabaseClient.removeChannel(channel)
    }
  }, [queryClient])

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['account-alerts'],
    queryFn: fetchAlerts,
    refetchInterval: 60000, // Poll every 60 seconds (optimized)
    staleTime: 30000, // Keep data fresh for 30s
    refetchOnMount: false, // Don't refetch on mount if data is fresh
    refetchOnWindowFocus: false, // Don't refetch on focus to reduce load
  })

  const dismissMutation = useMutation({
    mutationFn: dismissAlert,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['account-alerts'] })
    }
  })

  const dismissAllMutation = useMutation({
    mutationFn: dismissAllAlerts,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['account-alerts'] })
    }
  })

  const alerts = data?.alerts || []

  // Group alerts by type for UI organization (memoized to avoid recalculating on every render)
  const { paymentAlerts, authAlerts, templateAlerts, systemAlerts, rateLimitAlerts } = useMemo(() => ({
    paymentAlerts: alerts.filter(a => a.type === 'payment'),
    authAlerts: alerts.filter(a => a.type === 'auth'),
    templateAlerts: alerts.filter(a => a.type === 'template'),
    systemAlerts: alerts.filter(a => a.type === 'system'),
    rateLimitAlerts: alerts.filter(a => a.type === 'rate_limit'),
  }), [alerts])

  // Get most critical alert for banner display (memoized)
  const criticalAlert = useMemo(() => paymentAlerts[0] || authAlerts[0] || null, [paymentAlerts, authAlerts])

  return {
    // All alerts
    alerts,

    // Grouped alerts
    paymentAlerts,
    authAlerts,
    templateAlerts,
    systemAlerts,
    rateLimitAlerts,

    // Most critical for banner
    criticalAlert,
    hasCriticalAlert: !!criticalAlert,

    // State
    isLoading,
    error,

    // Actions
    dismiss: (id: string) => dismissMutation.mutate(id),
    dismissAll: () => dismissAllMutation.mutate(),
    refetch,

    // Mutation states
    isDismissing: dismissMutation.isPending,
  }
}
