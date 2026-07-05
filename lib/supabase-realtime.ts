/**
 * Supabase Realtime Utilities
 * 
 * Provides utilities for subscribing to Postgres changes via Supabase Realtime.
 * Follows constitution: API-first, Type Safety, Simplicity.
 */

import { RealtimeChannel, RealtimePostgresChangesPayload } from '@supabase/supabase-js'
import { getSupabaseBrowser } from './supabase'
import type { RealtimeTable, RealtimeEventType, RealtimePayload, ChannelStatus } from '@/types'

// ============================================================================
// CONFIGURATION
// ============================================================================

const REALTIME_CONFIG = {
    /** Max retries before giving up */
    maxRetries: 3,
    /** Base delay for exponential backoff (ms) */
    baseDelayMs: 1000,
    /** Timeout for connection (ms) */
    timeoutMs: 10000,
    /** Whether to log debug info */
    debug: process.env.NODE_ENV === 'development',
}

// Track connection state globally to avoid spamming logs
let connectionFailureLogged = false
let lastConnectionAttempt = 0

// ============================================================================
// CHANNEL MANAGER
// ============================================================================

/**
 * Creates a Realtime channel for subscribing to Postgres changes
 * 
 * @param channelName - Unique name for this channel
 * @returns RealtimeChannel instance
 */
export function createRealtimeChannel(channelName: string): RealtimeChannel | null {
    const supabase = getSupabaseBrowser()
    if (!supabase) {
        if (!connectionFailureLogged) {
            console.warn('[Realtime] Supabase not configured - realtime features disabled')
            connectionFailureLogged = true
        }
        return null
    }
    return supabase.channel(channelName)
}

/**
 * Subscribes to Postgres changes on a table
 * 
 * @param channel - The channel to add subscription to
 * @param table - Table name to listen to
 * @param event - Event type (INSERT, UPDATE, DELETE, *)
 * @param callback - Handler for received events
 * @param filter - Optional PostgREST filter (e.g., 'id=eq.123')
 * @returns The channel with subscription added
 */
export function subscribeToTable<T extends Record<string, unknown> = Record<string, unknown>>(
    channel: RealtimeChannel,
    table: RealtimeTable,
    event: RealtimeEventType,
    callback: (payload: RealtimePayload<T>) => void,
    filter?: string
): RealtimeChannel {
    // Use type assertion for config since Supabase types are strict
    const config = {
        event,
        schema: 'public' as const,
        table,
        ...(filter && { filter }),
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return channel.on('postgres_changes' as any, config as any, (payload: any) => {
        callback(payload as RealtimePayload<T>)
    })
}

/**
 * Activates channel subscription with retry logic
 * 
 * @param channel - The channel to activate
 * @param onStatusChange - Optional callback for status changes
 * @param options - Optional configuration for retries
 * @returns Promise that resolves when subscribed
 */
export async function activateChannel(
    channel: RealtimeChannel,
    onStatusChange?: (status: ChannelStatus) => void,
    options?: { maxRetries?: number; silent?: boolean }
): Promise<void> {
    const { maxRetries = REALTIME_CONFIG.maxRetries, silent = false } = options || {}
    
    // Throttle connection attempts to avoid spam
    const now = Date.now()
    if (now - lastConnectionAttempt < 2000) {
        await new Promise(resolve => setTimeout(resolve, 2000 - (now - lastConnectionAttempt)))
    }
    lastConnectionAttempt = Date.now()

    return new Promise((resolve, reject) => {
        let retryCount = 0
        let resolved = false

        const attemptSubscribe = () => {
            channel.subscribe((status) => {
                onStatusChange?.(status as ChannelStatus)

                if (resolved) return

                if (status === 'SUBSCRIBED') {
                    resolved = true
                    connectionFailureLogged = false // Reset on success
                    resolve()
                } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
                    if (retryCount < maxRetries) {
                        retryCount++
                        const delay = REALTIME_CONFIG.baseDelayMs * Math.pow(2, retryCount - 1)
                        if (REALTIME_CONFIG.debug && !silent) {
                            console.warn(`[Realtime] Connection failed, retry ${retryCount}/${maxRetries} in ${delay}ms`)
                        }
                        setTimeout(attemptSubscribe, delay)
                    } else {
                        resolved = true
                        if (!connectionFailureLogged && !silent) {
                            console.warn('[Realtime] Connection failed after retries. Check: 1) Supabase Dashboard > Database > Replication (tables enabled), 2) WebSocket not blocked by firewall/proxy, 3) Supabase service status')
                            connectionFailureLogged = true
                        }
                        reject(new Error(`Channel subscription failed: ${status}`))
                    }
                }
            })
        }

        attemptSubscribe()
    })
}

/**
 * Removes a channel and all its subscriptions
 * 
 * @param channel - The channel to remove
 */
export function removeChannel(channel: RealtimeChannel): void {
    const supabase = getSupabaseBrowser()
    if (!supabase) return
    supabase.removeChannel(channel)
}

// ============================================================================
// BROADCAST (EPHEMERAL EVENTS)
// ============================================================================

export interface BroadcastMessage<TPayload = unknown> {
    type: 'broadcast'
    event: string
    payload: TPayload
}

/**
 * Subscribes to Broadcast events on a channel.
 * Useful for ephemeral "live progress" without DB writes.
 */
export function subscribeToBroadcast<TPayload = unknown>(
    channel: RealtimeChannel,
    event: string,
    callback: (message: BroadcastMessage<TPayload>) => void
): RealtimeChannel {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return channel.on('broadcast' as any, { event } as any, (msg: any) => {
        callback(msg as BroadcastMessage<TPayload>)
    })
}

// ============================================================================
// CONVENIENCE FUNCTIONS
// ============================================================================

/**
 * Creates a subscription to a single table with automatic cleanup
 * Convenience function for simple use cases
 * 
 * @param table - Table name
 * @param event - Event type
 * @param callback - Handler function
 * @param filter - Optional filter
 * @returns Cleanup function to remove subscription
 */
export function createTableSubscription<T extends Record<string, unknown> = Record<string, unknown>>(
    table: RealtimeTable,
    event: RealtimeEventType,
    callback: (payload: RealtimePayload<T>) => void,
    filter?: string
): () => void {
    const channelName = `${table}-${Date.now()}`
    const channel = createRealtimeChannel(channelName)

    // Return no-op cleanup if Supabase not configured
    if (!channel) {
        console.warn('[Realtime] Supabase not configured, skipping subscription')
        return () => { }
    }

    subscribeToTable<T>(channel, table, event, callback, filter)

    // Activate without waiting
    activateChannel(channel).catch((err) => {
        console.error(`[Realtime] Failed to subscribe to ${table}:`, err)
    })

    // Return cleanup function
    return () => removeChannel(channel)
}

