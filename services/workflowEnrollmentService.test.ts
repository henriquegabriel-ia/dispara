import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Cliente da inscrição manual (modal "Adicionar ao workflow" da lista de contatos):
 * services/workflowEnrollmentService.ts. fetch mockado; nada vai à rede.
 */

import { workflowEnrollmentService } from '@/services/workflowEnrollmentService'

const fetchMock = vi.fn()

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('SV-01: listWorkflows', () => {
  it('GET /api/builder/workflows sem cache e devolve a lista (o consumidor filtra os publicados)', async () => {
    const list = [
      { id: 'wf-1', name: 'Boas-vindas', status: 'published', lastPublishedVersion: 2 },
      { id: 'wf-2', name: 'Rascunho', status: 'draft', lastPublishedVersion: null },
    ]
    fetchMock.mockResolvedValueOnce(jsonResponse(list))

    await expect(workflowEnrollmentService.listWorkflows()).resolves.toEqual(list)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith('/api/builder/workflows', { cache: 'no-store' })
  })

  it.each([401, 500, 503])('HTTP %i → Error "Falha ao buscar workflows"', async (status) => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'qualquer' }, status))
    await expect(workflowEnrollmentService.listWorkflows()).rejects.toThrow('Falha ao buscar workflows')
  })

  it('erro de rede propaga', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await expect(workflowEnrollmentService.listWorkflows()).rejects.toThrow('Failed to fetch')
  })
})

describe('SV-02: enroll', () => {
  it('POST /api/builder/workflows/{id}/enroll com JSON { contactIds } e devolve os contadores', async () => {
    const result = { success: true, requested: 2, enrolled: 1, alreadyActive: 1, blockedByReentry: 0 }
    fetchMock.mockResolvedValueOnce(jsonResponse(result))

    await expect(workflowEnrollmentService.enroll('wf-1', ['ct_ana', 'ct_bruno'])).resolves.toEqual(result)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/builder/workflows/wf-1/enroll')
    expect(init.method).toBe('POST')
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' })
    expect(JSON.parse(String(init.body))).toEqual({ contactIds: ['ct_ana', 'ct_bruno'] })
  })

  it('409 do servidor → lança a mensagem do servidor (ex.: workflow não publicado)', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'Publique o workflow antes de adicionar contatos' }, 409))
    await expect(workflowEnrollmentService.enroll('wf-1', ['ct_ana'])).rejects.toThrow(
      'Publique o workflow antes de adicionar contatos'
    )
  })

  it('400 do servidor → lança a mensagem do servidor', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'Nenhum telefone válido nos contatos informados' }, 400))
    await expect(workflowEnrollmentService.enroll('wf-1', ['ct_sem_fone'])).rejects.toThrow(
      'Nenhum telefone válido nos contatos informados'
    )
  })

  it('500 sem JSON → mensagem padrão "Falha ao adicionar contatos ao workflow"', async () => {
    fetchMock.mockResolvedValueOnce(new Response('<html>Internal Server Error</html>', { status: 500 }))
    await expect(workflowEnrollmentService.enroll('wf-1', ['ct_ana'])).rejects.toThrow('Falha ao adicionar contatos ao workflow')
  })

  it('erro JSON sem campo error → mensagem padrão', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: 'outra coisa' }, 502))
    await expect(workflowEnrollmentService.enroll('wf-1', ['ct_ana'])).rejects.toThrow('Falha ao adicionar contatos ao workflow')
  })

  it('id do workflow vai cru no caminho (ids do builder são nanoid seguros para URL)', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ success: true, requested: 0, enrolled: 0, alreadyActive: 0, blockedByReentry: 0 }))
    await workflowEnrollmentService.enroll('AbC_-123', [])
    expect(fetchMock.mock.calls[0][0]).toBe('/api/builder/workflows/AbC_-123/enroll')
  })
})

describe('contrato service ↔ rota real', () => {
  it('o body do service é aceito pela rota /enroll (mesmo formato { contactIds })', async () => {
    // Garante que o service não manda um campo que a rota ignora (ex.: "ids" ou "contacts").
    fetchMock.mockResolvedValueOnce(jsonResponse({ success: true, requested: 1, enrolled: 1, alreadyActive: 0, blockedByReentry: 0 }))
    await workflowEnrollmentService.enroll('wf-1', ['ct_ana'])
    const body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body)) as Record<string, unknown>
    expect(Object.keys(body)).toEqual(['contactIds'])
    expect(Array.isArray(body.contactIds)).toBe(true)
  })
})
