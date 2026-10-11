import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase-db', () => ({
  settingsDb: { get: vi.fn(), set: vi.fn() },
}))

vi.mock('@/lib/supabase', () => ({
  getSupabaseAdmin: vi.fn(),
}))

import { getStoredMetaAppSecret } from '@/lib/meta-app-credentials'
import { getSupabaseAdmin } from '@/lib/supabase'

const mockedGetSupabaseAdmin = vi.mocked(getSupabaseAdmin)

function makeClient(result: { data: unknown; error: { message: string } | null }) {
  const maybeSingle = vi.fn().mockResolvedValue(result)
  const eq = vi.fn(() => ({ maybeSingle }))
  const select = vi.fn(() => ({ eq }))
  const from = vi.fn(() => ({ select }))
  return { client: { from }, from, eq }
}

describe('getStoredMetaAppSecret', () => {
  beforeEach(() => {
    mockedGetSupabaseAdmin.mockReset()
  })

  it('lê settings.metaAppSecret (trim)', async () => {
    const { client, from, eq } = makeClient({ data: { value: '  s3cr3t  ' }, error: null })
    mockedGetSupabaseAdmin.mockReturnValue(client as never)

    await expect(getStoredMetaAppSecret()).resolves.toBe('s3cr3t')
    expect(from).toHaveBeenCalledWith('settings')
    expect(eq).toHaveBeenCalledWith('key', 'metaAppSecret')
  })

  it('null quando não há linha ou o valor está vazio', async () => {
    mockedGetSupabaseAdmin.mockReturnValue(makeClient({ data: null, error: null }).client as never)
    await expect(getStoredMetaAppSecret()).resolves.toBeNull()

    mockedGetSupabaseAdmin.mockReturnValue(makeClient({ data: { value: '   ' }, error: null }).client as never)
    await expect(getStoredMetaAppSecret()).resolves.toBeNull()
  })

  it('null quando o Supabase não está configurado', async () => {
    mockedGetSupabaseAdmin.mockReturnValue(null)
    await expect(getStoredMetaAppSecret()).resolves.toBeNull()
  })

  it('lança em erro de leitura (não confunde falha de banco com "não configurado")', async () => {
    mockedGetSupabaseAdmin.mockReturnValue(
      makeClient({ data: null, error: { message: 'connection refused' } }).client as never
    )
    await expect(getStoredMetaAppSecret()).rejects.toThrow('connection refused')
  })
})
