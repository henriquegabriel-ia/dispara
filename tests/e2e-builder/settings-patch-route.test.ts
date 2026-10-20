// @vitest-environment node
//
// Prova do BUG(settings-save-400) visto no E2E (07-settings.e2e.ts) direto na
// rota REAL, com Supabase em memória: o PATCH que a WorkflowSettingsSheet manda
// ({ settings } sem nodes) é recusado, enquanto o mesmo PATCH com o grafo passa.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { InMemorySupabase } from '@/tests/helpers/in-memory-supabase'

const h = vi.hoisted(() => ({ db: null as InMemorySupabase | null }))

vi.mock('@/lib/supabase', () => ({
  getSupabaseAdmin: () => h.db?.client ?? null,
  getSupabaseBrowser: () => null,
  supabase: {},
}))

const NOW = '2026-10-18T00:00:00.000Z'
const NODES = [
  {
    id: '__trigger',
    type: 'trigger',
    position: { x: 0, y: 0 },
    data: { label: 'Palavras-chave', type: 'trigger', config: { triggerType: 'Keywords', keywordList: 'oi' } },
  },
  {
    id: 'msg',
    type: 'action',
    position: { x: 0, y: 120 },
    data: { label: 'Mensagem', type: 'action', config: { actionType: 'whatsapp/send-message', toSource: 'inbound', message: 'Olá' } },
  },
]
const EDGES = [{ id: 'e-__trigger-msg', source: '__trigger', target: 'msg' }]
const SETTINGS = {
  allowReentry: false,
  stopOnResponse: true,
  timeWindow: { enabled: true, start: '09:00', end: '18:00', days: [1, 2, 3, 4, 5] },
}

async function patch(body: unknown): Promise<Response> {
  const { PATCH } = await import('@/app/api/builder/workflows/[workflowId]/route')
  const request = new Request('http://localhost/api/builder/workflows/wf1', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return PATCH(request, { params: Promise.resolve({ workflowId: 'wf1' }) })
}

describe('PATCH /api/builder/workflows/[id] — settings da WorkflowSettingsSheet', () => {
  beforeEach(async () => {
    const { createInMemorySupabase } = await import('@/tests/helpers/in-memory-supabase')
    h.db = createInMemorySupabase({
      settings: [],
      workflows: [
        { id: 'wf1', name: 'Fluxo', description: null, status: 'draft', settings: {}, active_version_id: 'v1', created_at: NOW, updated_at: NOW },
      ],
      workflow_versions: [
        { id: 'v1', workflow_id: 'wf1', version: 1, status: 'draft', nodes: NODES, edges: EDGES, tree: null, created_at: NOW, updated_at: NOW },
      ],
    })
  })

  it('controle: PATCH com o grafo + settings é aceito e grava as settings', async () => {
    const res = await patch({ nodes: NODES, edges: EDGES, settings: SETTINGS })
    expect(res.status).toBe(200)
    expect(h.db!.rows('workflows')[0].settings).toMatchObject({ allowReentry: false, stopOnResponse: true })
  })

  // Corrigido BUG(settings-save-400): PATCH parcial (só settings/nome) não valida nem toca o grafo.
  it('PATCH só com { settings } (o que a sheet envia) é aceito e não apaga o grafo', async () => {
    const res = await patch({ settings: SETTINGS })
    expect(res.status).toBe(200)
    expect(h.db!.rows('workflows')[0].settings).toMatchObject({ allowReentry: false, stopOnResponse: true })
    expect(h.db!.rows('workflow_versions')[0].nodes).toHaveLength(2)
  })
})
