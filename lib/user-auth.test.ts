// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createHmac, randomUUID } from 'crypto'

// ---------------------------------------------------------------------------
// Mocks: Supabase (tabela settings em memória) e next/headers (cookie jar)
// ---------------------------------------------------------------------------

type Row = { key: string; value: string; updated_at: string }

const db = vi.hoisted(() => ({
  configured: true,
  rows: [] as Array<{ key: string; value: string; updated_at: string }>,
  readError: null as null | { message: string },
  sessionReads: 0,
  writes: [] as Array<{ key: string; value: string }>,
}))

const cookieJar = vi.hoisted(() => new Map<string, string>())

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (cookieJar.has(name) ? { name, value: cookieJar.get(name)! } : undefined),
    set: (name: string, value: string) => {
      cookieJar.set(name, value)
    },
    delete: (name: string) => {
      cookieJar.delete(name)
    },
  }),
}))

vi.mock('@/lib/supabase', () => {
  const from = (_table: string) => ({
    select: (_cols: string) => ({
      in: async (_col: string, keys: string[]) => {
        if (keys.includes('session_tokens')) db.sessionReads++
        if (db.readError) return { data: null, error: db.readError }
        return { data: db.rows.filter((r) => keys.includes(r.key)), error: null }
      },
      eq: (_col: string, key: string) => ({
        single: async () => {
          const row = db.rows.find((r) => r.key === key)
          return row ? { data: row, error: null } : { data: null, error: { message: 'not found', code: 'PGRST116' } }
        },
      }),
    }),
    upsert: async (row: Row) => {
      db.writes.push({ key: row.key, value: row.value })
      db.rows = [...db.rows.filter((r) => r.key !== row.key), row]
      return { error: null }
    },
    delete: () => ({
      eq: async (_col: string, key: string) => {
        db.rows = db.rows.filter((r) => r.key !== key)
        return { error: null }
      },
    }),
  })
  const client = { from }
  return {
    getSupabaseAdmin: () => (db.configured ? client : null),
    supabase: {
      from: (table: string) => {
        if (!db.configured) throw new Error('Supabase not configured')
        return from(table)
      },
    },
  }
})

import {
  isValidSessionToken,
  invalidateSessionCache,
  validateSession,
  loginUser,
  logoutUser,
  SESSION_COOKIE_NAME,
} from './user-auth'

const MASTER = 'senha-mestra-de-teste'
const DAY_MS = 24 * 60 * 60 * 1000

function signedToken(id = randomUUID(), secret = MASTER): string {
  const sig = createHmac('sha256', secret).update(`dispara-session:s1.${id}`).digest('base64url')
  return `s1.${id}.${sig}`
}

function setSessions(sessions: Array<{ token: string; createdAt: string }>) {
  db.rows = db.rows.filter((r) => r.key !== 'session_tokens')
  db.rows.push({ key: 'session_tokens', value: JSON.stringify(sessions), updated_at: new Date().toISOString() })
}

function storedSessions(): Array<{ token: string; createdAt: string }> {
  const row = db.rows.find((r) => r.key === 'session_tokens')
  return row ? JSON.parse(row.value) : []
}

describe('user-auth — sessões', () => {
  let savedMaster: string | undefined

  beforeEach(() => {
    savedMaster = process.env.MASTER_PASSWORD
    process.env.MASTER_PASSWORD = MASTER
    db.configured = true
    db.rows = []
    db.readError = null
    db.sessionReads = 0
    db.writes = []
    cookieJar.clear()
    invalidateSessionCache()
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    if (savedMaster === undefined) delete process.env.MASTER_PASSWORD
    else process.env.MASTER_PASSWORD = savedMaster
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  // ==========================================================================
  // isValidSessionToken
  // ==========================================================================
  describe('isValidSessionToken', () => {
    it('token malformado (cookie forjado qualquer) → invalid sem consultar o banco', async () => {
      expect(await isValidSessionToken('x')).toBe('invalid')
      expect(await isValidSessionToken('')).toBe('invalid')
      expect(await isValidSessionToken('a'.repeat(300))).toBe('invalid')
      expect(db.sessionReads).toBe(0)
    })

    it('token com formato assinado mas assinatura errada → invalid sem consultar o banco', async () => {
      const forged = signedToken(randomUUID(), 'outra-senha')
      expect(await isValidSessionToken(forged)).toBe('invalid')
      expect(await isValidSessionToken(`s1.${randomUUID()}.`)).toBe('invalid')
      expect(db.sessionReads).toBe(0)
    })

    it('token legado (UUID) presente na lista → valid; ausente → invalid', async () => {
      const token = randomUUID()
      setSessions([{ token, createdAt: new Date().toISOString() }])
      expect(await isValidSessionToken(token)).toBe('valid')
      expect(await isValidSessionToken(randomUUID())).toBe('invalid')
    })

    it('sessão expirada (> 7 dias) → invalid', async () => {
      const token = randomUUID()
      setSessions([{ token, createdAt: new Date(Date.now() - 8 * DAY_MS).toISOString() }])
      expect(await isValidSessionToken(token)).toBe('invalid')
    })

    it('Supabase não configurado → unavailable (distinto de invalid)', async () => {
      db.configured = false
      expect(await isValidSessionToken(randomUUID())).toBe('unavailable')
    })

    it('erro de banco → unavailable; token inexistente com banco ok → invalid', async () => {
      db.readError = { message: 'connection refused' }
      expect(await isValidSessionToken(randomUUID())).toBe('unavailable')

      db.readError = null
      invalidateSessionCache()
      setSessions([])
      expect(await isValidSessionToken(randomUUID())).toBe('invalid')
    })

    it('cacheia a LISTA por ~15s: flood de cookies forjados custa 1 query', async () => {
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(new Date('2026-10-11T12:00:00Z'))
      setSessions([{ token: randomUUID(), createdAt: new Date().toISOString() }])

      for (let i = 0; i < 50; i++) {
        expect(await isValidSessionToken(randomUUID())).toBe('invalid')
      }
      expect(db.sessionReads).toBe(1)

      vi.setSystemTime(new Date('2026-10-11T12:00:14Z'))
      await isValidSessionToken(randomUUID())
      expect(db.sessionReads).toBe(1)

      vi.setSystemTime(new Date('2026-10-11T12:00:16Z'))
      await isValidSessionToken(randomUUID())
      expect(db.sessionReads).toBe(2)
    })

    it('requests concorrentes compartilham a mesma leitura', async () => {
      setSessions([])
      await Promise.all(Array.from({ length: 20 }, () => isValidSessionToken(randomUUID())))
      expect(db.sessionReads).toBe(1)
    })

    it('NÃO escreve nada por request (nem poda sessões expiradas)', async () => {
      const valid = randomUUID()
      setSessions([
        { token: randomUUID(), createdAt: new Date(Date.now() - 30 * DAY_MS).toISOString() },
        { token: valid, createdAt: new Date().toISOString() },
      ])
      expect(await isValidSessionToken(valid)).toBe('valid')
      expect(await isValidSessionToken(randomUUID())).toBe('invalid')
      expect(db.writes).toHaveLength(0)
      expect(storedSessions()).toHaveLength(2)
    })

    it('legado de token único (sem session_tokens): valida e respeita a expiração', async () => {
      const token = randomUUID()
      db.rows.push({ key: 'session_token', value: token, updated_at: new Date().toISOString() })
      expect(await isValidSessionToken(token)).toBe('valid')

      invalidateSessionCache()
      db.rows = [{ key: 'session_token', value: token, updated_at: new Date(Date.now() - 8 * DAY_MS).toISOString() }]
      expect(await isValidSessionToken(token)).toBe('invalid')
      expect(db.writes).toHaveLength(0)
    })

    it('token assinado criado por OUTRA instância depois do cache → relê a lista uma vez', async () => {
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(new Date('2026-10-11T12:00:00Z'))
      setSessions([])
      expect(await isValidSessionToken(randomUUID())).toBe('invalid') // aquece o cache
      expect(db.sessionReads).toBe(1)

      // login em outra instância grava um token novo no banco
      const fresh = signedToken()
      setSessions([{ token: fresh, createdAt: new Date().toISOString() }])

      expect(await isValidSessionToken(fresh)).toBe('valid')
      expect(db.sessionReads).toBe(2)
      // a releitura atualizou o cache: próxima validação não consulta
      expect(await isValidSessionToken(fresh)).toBe('valid')
      expect(db.sessionReads).toBe(2)
    })

    it('token assinado revogado força no máximo UMA releitura por janela de cache', async () => {
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(new Date('2026-10-11T12:00:00Z'))
      setSessions([])
      const revoked = signedToken()

      expect(await isValidSessionToken(revoked)).toBe('invalid')
      expect(db.sessionReads).toBe(2) // leitura normal + releitura forçada
      for (let i = 0; i < 10; i++) expect(await isValidSessionToken(revoked)).toBe('invalid')
      expect(db.sessionReads).toBe(2)
    })

    it('trocar a MASTER_PASSWORD invalida tokens assinados', async () => {
      const token = signedToken()
      setSessions([{ token, createdAt: new Date().toISOString() }])
      expect(await isValidSessionToken(token)).toBe('valid')

      process.env.MASTER_PASSWORD = 'senha-nova'
      expect(await isValidSessionToken(token)).toBe('invalid')
    })
  })

  // ==========================================================================
  // validateSession
  // ==========================================================================
  describe('validateSession', () => {
    it('true só para valid', async () => {
      const token = randomUUID()
      setSessions([{ token, createdAt: new Date().toISOString() }])

      expect(await validateSession()).toBe(false) // sem cookie

      cookieJar.set(SESSION_COOKIE_NAME, token)
      expect(await validateSession()).toBe(true)

      cookieJar.set(SESSION_COOKIE_NAME, 'forjado')
      expect(await validateSession()).toBe(false)

      cookieJar.set(SESSION_COOKIE_NAME, randomUUID())
      db.readError = { message: 'down' }
      invalidateSessionCache()
      expect(await validateSession()).toBe(false)
    })
  })

  // ==========================================================================
  // createSession (via loginUser) / logoutUser
  // ==========================================================================
  describe('login/logout', () => {
    it('login cria token assinado, poda expiradas e invalida o cache local', async () => {
      const expired = randomUUID()
      const active = randomUUID()
      setSessions([
        { token: expired, createdAt: new Date(Date.now() - 9 * DAY_MS).toISOString() },
        { token: active, createdAt: new Date().toISOString() },
      ])
      // aquece o cache SEM o token novo
      expect(await isValidSessionToken(active)).toBe('valid')
      const readsBefore = db.sessionReads

      const result = await loginUser(MASTER)
      expect(result.success).toBe(true)

      const token = cookieJar.get(SESSION_COOKIE_NAME)!
      expect(token).toMatch(/^s1\.[0-9a-f-]{36}\.[A-Za-z0-9_-]+$/)

      const tokens = storedSessions().map((s) => s.token)
      expect(tokens).toContain(active)
      expect(tokens).toContain(token)
      expect(tokens).not.toContain(expired)

      expect(await isValidSessionToken(token)).toBe('valid')
      expect(db.sessionReads).toBeGreaterThan(readsBefore)
    })

    it('senha errada não cria sessão', async () => {
      const result = await loginUser('errada')
      expect(result.success).toBe(false)
      expect(cookieJar.has(SESSION_COOKIE_NAME)).toBe(false)
    })

    it('erro ao ler as sessões no login NÃO apaga as outras sessões', async () => {
      const active = randomUUID()
      setSessions([{ token: active, createdAt: new Date().toISOString() }])
      db.readError = { message: 'timeout' }

      const result = await loginUser(MASTER)
      expect(result.success).toBe(false)
      expect(cookieJar.has(SESSION_COOKIE_NAME)).toBe(false)
      expect(storedSessions().map((s) => s.token)).toEqual([active])
    })

    it('logout remove o token atual, poda expiradas e invalida o cache', async () => {
      const current = randomUUID()
      const other = randomUUID()
      const expired = randomUUID()
      setSessions([
        { token: current, createdAt: new Date().toISOString() },
        { token: other, createdAt: new Date().toISOString() },
        { token: expired, createdAt: new Date(Date.now() - 10 * DAY_MS).toISOString() },
      ])
      expect(await isValidSessionToken(current)).toBe('valid')

      cookieJar.set(SESSION_COOKIE_NAME, current)
      await logoutUser()

      expect(cookieJar.has(SESSION_COOKIE_NAME)).toBe(false)
      expect(storedSessions().map((s) => s.token)).toEqual([other])
      expect(await isValidSessionToken(current)).toBe('invalid')
      expect(await isValidSessionToken(other)).toBe('valid')
    })
  })
})
