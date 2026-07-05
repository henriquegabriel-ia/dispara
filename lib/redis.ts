/**
 * Redis client (Upstash)
 *
 * Mantemos esse arquivo como ponto único de acesso ao Redis.
 * - Em produção (serverless), usamos Upstash Redis via REST.
 * - Se não estiver configurado, exportamos `redis = null` (fallback seguro).
 */

import { Redis } from '@upstash/redis'

export const isRedisConfigured = (): boolean => {
	return !!(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN)
}

export const redis: Redis | null = isRedisConfigured()
	? new Redis({
			url: process.env.UPSTASH_REDIS_REST_URL as string,
			token: process.env.UPSTASH_REDIS_REST_TOKEN as string,
		})
	: null
