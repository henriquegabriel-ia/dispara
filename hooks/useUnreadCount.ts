/**
 * T069: Lightweight hook for unread conversations count
 * Used by sidebar to display unread badge without loading full conversation data
 */

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo } from 'react'
import { getSupabaseBrowser } from '@/lib/supabase'

const UNREAD_COUNT_KEY = ['inbox-unread-count']

/**
 * Lightweight hook that returns total count of unread conversations
 * Subscribes to real-time updates for automatic refresh
 */
export function useUnreadCount() {
  const queryClient = useQueryClient()
  const supabase = useMemo(() => getSupabaseBrowser(), [])

  // Query for unread count
  const query = useQuery({
    queryKey: UNREAD_COUNT_KEY,
    queryFn: async () => {
      if (!supabase) return 0

      // Count conversations with unread_count > 0
      const { count, error } = await supabase
        .from('inbox_conversations')
        .select('*', { count: 'exact', head: true })
        .gt('unread_count', 0)
        .eq('status', 'open')

      if (error) {
        console.error('[useUnreadCount] Error fetching count:', error)
        return 0
      }

      return count ?? 0
    },
    staleTime: 30_000, // 30 seconds
    refetchOnWindowFocus: true,
    enabled: !!supabase,
  })

  // Subscribe to real-time updates
  useEffect(() => {
    if (!supabase) return

    const channel = supabase
      .channel('unread-count-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'inbox_conversations',
        },
        () => {
          // Invalidate on any conversation change
          queryClient.invalidateQueries({ queryKey: UNREAD_COUNT_KEY })
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'inbox_messages',
          filter: 'direction=eq.inbound',
        },
        () => {
          // Invalidate on new inbound messages
          queryClient.invalidateQueries({ queryKey: UNREAD_COUNT_KEY })
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [supabase, queryClient])

  return {
    count: query.data ?? 0,
    isLoading: query.isLoading,
  }
}
