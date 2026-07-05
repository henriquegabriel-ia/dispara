/**
 * Upstash Redis Client
 *
 * Cliente Redis para operações que precisam de estado distribuído:
 * - Debounce de mensagens do inbox (workflow AI)
 * - Dedupe de webhooks
 * - Cache distribuído
 *
 * Usa REST API do Upstash (funciona em serverless sem conexão persistente).
 */

import { Redis } from '@upstash/redis'

// Singleton instance
let redisInstance: Redis | null = null

/**
 * Retorna cliente Redis configurado.
 * Retorna null se as variáveis de ambiente não estiverem configuradas.
 */
export function getRedis(): Redis | null {
  if (redisInstance) return redisInstance

  const url = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN

  if (!url || !token) {
    console.warn('[Redis] UPSTASH_REDIS_REST_URL ou UPSTASH_REDIS_REST_TOKEN não configurados')
    return null
  }

  redisInstance = new Redis({ url, token })
  return redisInstance
}

/**
 * Retorna cliente Redis ou lança erro se não configurado.
 * Use quando Redis é obrigatório para a operação.
 */
export function getRedisOrThrow(): Redis {
  const redis = getRedis()
  if (!redis) {
    throw new Error('Redis não configurado. Configure UPSTASH_REDIS_REST_URL e UPSTASH_REDIS_REST_TOKEN.')
  }
  return redis
}

// Keys para o inbox AI workflow
export const REDIS_KEYS = {
  /** Timestamp da última mensagem recebida na conversa */
  inboxLastMessage: (conversationId: string) => `inbox:last-msg:${conversationId}`,
  /** Flag indicando que existe workflow pendente para a conversa */
  inboxWorkflowPending: (conversationId: string) => `inbox:workflow-pending:${conversationId}`,
} as const
