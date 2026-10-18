import React from 'react'
import '@testing-library/jest-dom/vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, render, renderHook, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * useWorkflowBuilder: carga do fluxo no store, autosave (debounce 1s em config, flush
 * imediato em estrutural, flush no unmount, estados Salvando/Salvo/Erro) e publish
 * (bloqueia árvore que não compila, grava antes e mostra a versão).
 * A API é mockada no limite (lib/builder/api-client); store, compile e header são reais.
 */

const apiMock = vi.hoisted(() => ({ getById: vi.fn(), update: vi.fn(), publish: vi.fn() }))
vi.mock('@/lib/builder/api-client', () => ({ api: { workflow: apiMock } }))

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }))
vi.mock('@/lib/toast', () => ({ toast: toastMock }))

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

// compileFlow real, mas espionável (HK-12 injeta um erro inesperado).
vi.mock('@/lib/builder/flow/compile', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/builder/flow/compile')>()
  return { ...mod, compileFlow: vi.fn(mod.compileFlow) }
})

import BuilderHeader from '@/components/flow-builder/BuilderHeader'
import { useFlowBuilderStore } from '@/components/flow-builder/store'
import { useWorkflowBuilder } from '@/hooks/useWorkflowBuilder'
import { compileFlow } from '@/lib/builder/flow/compile'
import { findStep } from '@/lib/builder/flow/operations'
import type { Flow, Step } from '@/lib/builder/flow/types'

const store = () => useFlowBuilderStore.getState()
const WF_ID = 'wf-1'

const wa = (id: string, message: string, next: Step | null = null): Step => ({
  id,
  type: 'whatsapp',
  name: `W ${id}`,
  config: { template: '', mediaUrl: '', message },
  next,
})

const validTree = (): Flow => ({
  schemaVersion: 1,
  id: WF_ID,
  name: 'nome da árvore',
  trigger: { type: 'keywords', label: 'Palavras-chave', keywords: ['oi'] },
  root: wa('A', 'Olá!', wa('B', 'Tudo bem?')),
})

type SavedWf = Record<string, unknown> & { id: string; name: string }

function savedWorkflow(over: Record<string, unknown> = {}): SavedWf {
  const tree = (over.tree as Flow | undefined) ?? validTree()
  let graph: { nodes: unknown[]; edges: unknown[] } = { nodes: [], edges: [] }
  try {
    graph = compileFlow(tree)
  } catch {
    /* árvore de rascunho */
  }
  return {
    id: WF_ID,
    name: 'Meu fluxo',
    nodes: graph.nodes,
    edges: graph.edges,
    tree,
    visibility: 'private',
    createdAt: '2026-10-18T00:00:00.000Z',
    updatedAt: '2026-10-18T00:00:00.000Z',
    settings: {},
    lastPublishedVersion: null,
    status: 'draft',
    ...over,
  }
}

function deferred<T = unknown>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function makeClient(opts: { gcTime?: number; staleTime?: number } = {}) {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: opts.gcTime ?? Number.POSITIVE_INFINITY, staleTime: opts.staleTime ?? 0 } },
  })
}

function wrapperFor(client: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
}

/** Monta o hook com o workflow já no cache do React Query (como depois do fetch). */
function mountHook(wf: SavedWf = savedWorkflow(), client = makeClient()) {
  client.setQueryData(['builder-workflow', wf.id], wf)
  const utils = renderHook(({ id }) => useWorkflowBuilder(id), { wrapper: wrapperFor(client), initialProps: { id: wf.id } })
  return { ...utils, client }
}

/** Tela mínima: hook + header real (indicador de save, badge de versão, Publicar). */
function Screen({ onReady }: { onReady: (r: ReturnType<typeof useWorkflowBuilder>) => void }) {
  const builder = useWorkflowBuilder(WF_ID)
  onReady(builder)
  return (
    <BuilderHeader
      saveState={builder.saveState}
      publishedVersion={builder.publishedVersion}
      publishing={builder.publishing}
      onPublish={builder.publish}
      onOpenSettings={() => {}}
    />
  )
}

function mountScreen(wf: SavedWf = savedWorkflow()) {
  const client = makeClient()
  client.setQueryData(['builder-workflow', wf.id], wf)
  const ref: { current: ReturnType<typeof useWorkflowBuilder> | null } = { current: null }
  const utils = render(
    <QueryClientProvider client={client}>
      <Screen onReady={(r) => (ref.current = r)} />
    </QueryClientProvider>
  )
  return { ...utils, ref, client }
}

const lastUpdateBody = () => apiMock.update.mock.calls.at(-1)?.[1] as { name: string; tree: Flow; nodes: unknown[]; edges: unknown[] }

const insertAt = (slot: Parameters<ReturnType<typeof store>['openPicker']>[0], type: Parameters<ReturnType<typeof store>['insertStep']>[0]) => {
  store().openPicker(slot, { x: 0, y: 0 })
  store().insertStep(type)
}

beforeEach(() => {
  vi.clearAllMocks()
  apiMock.getById.mockReset().mockImplementation(async () => savedWorkflow())
  apiMock.update.mockReset().mockResolvedValue({})
  apiMock.publish.mockReset().mockResolvedValue({ success: true, versionId: 'v3', version: 3 })
  vi.spyOn(console, 'error').mockImplementation(() => {})
  store().reset()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

// ─── HK-01 ─────────────────────────────────────────────────────────────────────

describe('HK-01 carga', () => {
  it('tree válida vai para o store com o nome do registro; não salva na carga', () => {
    const { result } = mountHook(savedWorkflow({ lastPublishedVersion: 3, settings: { allowReentry: false } }))
    const tree = validTree()
    expect(store().flow).toEqual({ ...tree, name: 'Meu fluxo' })
    expect(result.current).toMatchObject({ saveState: 'idle', publishedVersion: 3, publishing: false, isLoading: false, settings: { allowReentry: false } })
    expect(store()).toMatchObject({ rev: 0, past: [] })
    expect(apiMock.update).not.toHaveBeenCalled()
  })

  it('tree null → fluxo vazio SEM gatilho com id/nome do registro', () => {
    mountHook(savedWorkflow({ tree: null, nodes: [], edges: [] }))
    expect(store().flow).toMatchObject({ schemaVersion: 1, id: WF_ID, name: 'Meu fluxo', root: null, trigger: { type: 'none', label: '', keywords: [] } })
  })

  it.each([
    ['sem trigger', { schemaVersion: 1, id: WF_ID, name: 'x', root: null }],
    ['schemaVersion 2', { ...validTree(), schemaVersion: 2 }],
    ['string', 'nao-e-arvore'],
  ])('tree inválida (%s) → fluxo vazio', (_, tree) => {
    mountHook(savedWorkflow({ tree, nodes: [], edges: [] }))
    expect(store().flow).toMatchObject({ root: null, trigger: { type: 'none' } })
  })

  it('nome vazio no registro → usa o nome da árvore; settings ausente → {}', () => {
    const { result } = mountHook(savedWorkflow({ name: '', settings: undefined }))
    expect(store().flow?.name).toBe('nome da árvore')
    expect(result.current.settings).toEqual({})
  })

  it('carrega via api.workflow.getById quando não há cache', async () => {
    const client = makeClient()
    const { result } = renderHook(() => useWorkflowBuilder(WF_ID), { wrapper: wrapperFor(client) })
    expect(result.current.isLoading).toBe(true)
    await waitFor(() => expect(store().flow).not.toBeNull())
    expect(apiMock.getById).toHaveBeenCalledWith(WF_ID)
    expect(result.current.isLoading).toBe(false)
  })

  it('erro de carga aparece em loadError', async () => {
    apiMock.getById.mockRejectedValue(new Error('500'))
    const { result } = renderHook(() => useWorkflowBuilder(WF_ID), { wrapper: wrapperFor(makeClient()) })
    // o hook usa retry: 1 → espera a segunda tentativa
    await waitFor(() => expect(result.current.loadError).toBeTruthy(), { timeout: 4000 })
    expect(store().flow).toBeNull()
  })
})

// ─── HK-02 ─────────────────────────────────────────────────────────────────────

describe('HK-02 autosave de config com debounce de 1s', () => {
  beforeEach(() => vi.useFakeTimers())

  it('patchStep: nada aos 999ms, 1 save aos 1000ms com {name, tree, nodes, edges} compilados', () => {
    mountHook()
    act(() => store().patchStep('A', { config: { message: 'Oi, tudo certo?' } }))
    act(() => vi.advanceTimersByTime(999))
    expect(apiMock.update).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(1))
    expect(apiMock.update).toHaveBeenCalledTimes(1)
    const flow = store().flow!
    const compiled = compileFlow(flow)
    expect(apiMock.update).toHaveBeenCalledWith(WF_ID, { name: 'Meu fluxo', tree: flow, nodes: compiled.nodes, edges: compiled.edges })
    expect(findStep(lastUpdateBody().tree, 'A')?.config.message).toBe('Oi, tudo certo?')
  })

  it('rajada de 3 edições em <1s vira 1 save com o último estado (o timer reinicia)', () => {
    mountHook()
    act(() => store().patchStep('A', { config: { message: '1' } }))
    act(() => vi.advanceTimersByTime(600))
    act(() => store().patchStep('A', { config: { message: '2' } }))
    act(() => vi.advanceTimersByTime(600))
    act(() => store().patchStep('B', { config: { message: '3' } }))
    act(() => vi.advanceTimersByTime(999))
    expect(apiMock.update).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(1))
    expect(apiMock.update).toHaveBeenCalledTimes(1)
    expect(findStep(lastUpdateBody().tree, 'A')?.config.message).toBe('2')
    expect(findStep(lastUpdateBody().tree, 'B')?.config.message).toBe('3')
  })

  it('renameFlow e patchTrigger também passam pelo debounce', () => {
    mountHook()
    act(() => store().renameFlow('Boas-vindas'))
    act(() => vi.advanceTimersByTime(500))
    act(() => store().patchTrigger({ keywords: ['oi', 'olá'] }))
    act(() => vi.advanceTimersByTime(999))
    expect(apiMock.update).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(1))
    expect(apiMock.update).toHaveBeenCalledTimes(1)
    expect(lastUpdateBody()).toMatchObject({ name: 'Boas-vindas', tree: { name: 'Boas-vindas', trigger: { keywords: ['oi', 'olá'] } } })
    expect((lastUpdateBody().nodes as Array<{ id: string; data: { config: Record<string, unknown> } }>).find((n) => n.id === '__trigger')?.data.config).toEqual({
      triggerType: 'Keywords',
      keywordList: 'oi\nolá',
    })
  })
})

// ─── HK-03 ─────────────────────────────────────────────────────────────────────

describe('HK-03 autosave estrutural imediato', () => {
  beforeEach(() => vi.useFakeTimers())

  it('insert, remove, undo, addBranch e goto salvam na hora (1 save cada)', () => {
    mountHook()
    act(() => insertAt({ kind: 'after', stepId: 'B' }, 'condition'))
    expect(apiMock.update).toHaveBeenCalledTimes(1)
    const condId = store().selectedStepId!
    act(() => store().addBranchTo(condId))
    expect(apiMock.update).toHaveBeenCalledTimes(2)
    act(() => insertAt({ kind: 'branch', stepId: condId, branchIndex: 0 }, 'goto'))
    expect(apiMock.update).toHaveBeenCalledTimes(3)
    const gotoId = store().selectedStepId!
    act(() => {
      store().startGotoPick(gotoId)
      store().chooseGotoTarget('A')
    })
    expect(apiMock.update).toHaveBeenCalledTimes(4)
    act(() => store().removeStep(condId))
    expect(apiMock.update).toHaveBeenCalledTimes(5)
    act(() => store().undo())
    expect(apiMock.update).toHaveBeenCalledTimes(6)
    expect(findStep(lastUpdateBody().tree, condId)).not.toBeNull()
    act(() => vi.advanceTimersByTime(5000))
    expect(apiMock.update).toHaveBeenCalledTimes(6)
  })

  it('edição de config seguida de estrutural antes de 1s: 1 save imediato com as duas, sem save do timer', () => {
    mountHook()
    act(() => store().patchStep('A', { config: { message: 'editada' } }))
    act(() => vi.advanceTimersByTime(300))
    act(() => insertAt({ kind: 'after', stepId: 'B' }, 'tag'))
    expect(apiMock.update).toHaveBeenCalledTimes(1)
    expect(findStep(lastUpdateBody().tree, 'A')?.config.message).toBe('editada')
    act(() => vi.advanceTimersByTime(2000))
    expect(apiMock.update).toHaveBeenCalledTimes(1)
  })

  it('terminal num slot com cauda (no-op) não salva', () => {
    mountHook()
    act(() => insertAt({ kind: 'after', stepId: 'A' }, 'end'))
    act(() => vi.advanceTimersByTime(2000))
    expect(apiMock.update).not.toHaveBeenCalled()
  })
})

// ─── HK-04 ─────────────────────────────────────────────────────────────────────

describe('HK-04 estados do save e indicador do header', () => {
  it('Salvo (idle) → Salvando… → Salvo', async () => {
    const d = deferred()
    apiMock.update.mockReturnValueOnce(d.promise)
    mountScreen()
    expect(screen.getByText('Salvo')).toBeInTheDocument()
    act(() => insertAt({ kind: 'after', stepId: 'B' }, 'tag'))
    expect(screen.getByText('Salvando…')).toBeInTheDocument()
    await act(async () => d.resolve({}))
    expect(screen.getByText('Salvo')).toBeInTheDocument()
    expect(screen.queryByText('Salvando…')).not.toBeInTheDocument()
  })

  it('falha → "Erro ao salvar" + toast', async () => {
    const d = deferred()
    apiMock.update.mockReturnValueOnce(d.promise)
    const { ref } = mountScreen()
    act(() => insertAt({ kind: 'after', stepId: 'B' }, 'tag'))
    await act(async () => d.reject(new Error('500')))
    expect(screen.getByText('Erro ao salvar')).toBeInTheDocument()
    expect(ref.current?.saveState).toBe('error')
    expect(toastMock.error).toHaveBeenCalledWith('Falha ao salvar o fluxo')
  })

  it('o próximo save bem-sucedido limpa o erro', async () => {
    apiMock.update.mockRejectedValueOnce(new Error('500'))
    mountScreen()
    await act(async () => insertAt({ kind: 'after', stepId: 'B' }, 'tag'))
    expect(screen.getByText('Erro ao salvar')).toBeInTheDocument()
    await act(async () => store().undo())
    expect(screen.getByText('Salvo')).toBeInTheDocument()
  })
})

// ─── HK-05 ─────────────────────────────────────────────────────────────────────

describe('HK-05 árvore que não compila é salva como rascunho', () => {
  beforeEach(() => vi.useFakeTimers())

  it('avisa uma vez, reaproveita o último grafo válido e sempre envia a tree', async () => {
    const wf = savedWorkflow()
    mountHook(wf)
    // 1) passo WhatsApp vazio (estrutural) → compile falha
    await act(async () => insertAt({ kind: 'after', stepId: 'B' }, 'whatsapp'))
    const emptyId = store().selectedStepId!
    expect(toastMock.warning).toHaveBeenCalledTimes(1)
    expect(toastMock.warning).toHaveBeenCalledWith('Fluxo salvo como rascunho', {
      description: expect.stringContaining('está vazio: defina template, mídia ou mensagem'),
    })
    expect(lastUpdateBody().nodes).toEqual(wf.nodes) // grafo da carga
    expect(findStep(lastUpdateBody().tree, emptyId)).not.toBeNull()

    // 2) outra edição com o MESMO erro → sem novo aviso
    act(() => store().patchStep('A', { config: { message: 'mudou' } }))
    await act(async () => vi.advanceTimersByTime(1000))
    expect(apiMock.update).toHaveBeenCalledTimes(2)
    expect(toastMock.warning).toHaveBeenCalledTimes(1)
    expect(lastUpdateBody().nodes).toEqual(wf.nodes)

    // 3) preenche → compila → grafo novo
    act(() => store().patchStep(emptyId, { config: { message: 'agora sim' } }))
    await act(async () => vi.advanceTimersByTime(1000))
    const good = compileFlow(store().flow!)
    expect(lastUpdateBody().nodes).toEqual(good.nodes)

    // 4) esvazia de novo → avisa de novo e usa o último grafo BOM (o do passo 3)
    act(() => store().patchStep(emptyId, { config: { message: '' } }))
    await act(async () => vi.advanceTimersByTime(1000))
    expect(toastMock.warning).toHaveBeenCalledTimes(2)
    expect(lastUpdateBody().nodes).toEqual(good.nodes)
    expect(apiMock.update).toHaveBeenCalledTimes(4)
  })
})

// ─── HK-06 ─────────────────────────────────────────────────────────────────────

describe('HK-06 flush no unmount', () => {
  beforeEach(() => vi.useFakeTimers())

  it('edição pendente no debounce é gravada ao desmontar; o store é resetado', () => {
    const { unmount } = mountHook()
    act(() => store().patchStep('A', { config: { message: 'saindo' } }))
    act(() => vi.advanceTimersByTime(400))
    expect(apiMock.update).not.toHaveBeenCalled()
    unmount()
    expect(apiMock.update).toHaveBeenCalledTimes(1)
    expect(findStep(lastUpdateBody().tree, 'A')?.config.message).toBe('saindo')
    expect(store().flow).toBeNull()
    act(() => vi.advanceTimersByTime(2000))
    expect(apiMock.update).toHaveBeenCalledTimes(1)
  })

  it('sem pendência, desmontar não salva', () => {
    const { unmount } = mountHook()
    act(() => store().patchStep('A', { config: { message: 'x' } }))
    act(() => vi.advanceTimersByTime(1000))
    expect(apiMock.update).toHaveBeenCalledTimes(1)
    unmount()
    expect(apiMock.update).toHaveBeenCalledTimes(1)
  })

  // BUG(save-error-lost): o dirtyRef é zerado ANTES do PATCH (useWorkflowBuilder.ts:315) e
  // não há retry; se o save falha e o usuário sai, a mudança nunca é reenviada.
  it.fails('save que falhou é reenviado ao sair da tela', async () => {
    apiMock.update.mockRejectedValueOnce(new Error('rede'))
    const { unmount } = mountHook()
    act(() => store().patchStep('A', { config: { message: 'importante' } }))
    await act(async () => vi.advanceTimersByTime(1000))
    expect(apiMock.update).toHaveBeenCalledTimes(1)
    unmount()
    expect(apiMock.update).toHaveBeenCalledTimes(2)
  })

  // BUG(no-beforeunload): fechar a aba/recarregar durante o debounce de 1s perde a
  // edição — o hook não registra beforeunload (nem grava, nem avisa).
  it.fails('fechar a aba com edição pendente grava ou pede confirmação', () => {
    mountHook()
    act(() => store().patchStep('A', { config: { message: 'quase' } }))
    const event = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(event)
    expect(apiMock.update.mock.calls.length > 0 || event.defaultPrevented).toBe(true)
  })
})

// ─── HK-07 / HK-08 / HK-09 ─────────────────────────────────────────────────────

describe('HK-07 publish bloqueia árvore inválida', () => {
  it('passo vazio → toast "Corrija o fluxo", sem save nem publish', async () => {
    const tree: Flow = { ...validTree(), root: wa('A', '') }
    const { result } = mountHook(savedWorkflow({ tree, nodes: [], edges: [] }))
    await act(async () => result.current.publish())
    expect(toastMock.error).toHaveBeenCalledWith('Corrija o fluxo antes de publicar', {
      description: expect.stringContaining('Passo WhatsApp "W A" está vazio'),
    })
    expect(apiMock.update).not.toHaveBeenCalled()
    expect(apiMock.publish).not.toHaveBeenCalled()
    expect(result.current.publishing).toBe(false)
  })

  it.each([
    ['split', { id: 'S', type: 'split', name: 'Split', config: {}, next: null, branches: [{ id: 'a', label: 'A', percent: 50, child: null }, { id: 'b', label: 'B', percent: 50, child: null }] }],
    ['goto', { id: 'G', type: 'goto', name: 'Ir', config: { targetId: null }, next: null }],
    ['wait até resposta', { id: 'W', type: 'wait', name: 'Esperar', config: { mode: 'reply' }, next: null }],
  ])('passo não suportado no v1 (%s) bloqueia o publish', async (_, root) => {
    const { result } = mountHook(savedWorkflow({ tree: { ...validTree(), root }, nodes: [], edges: [] }))
    await act(async () => result.current.publish())
    expect(toastMock.error).toHaveBeenCalledWith('Corrija o fluxo antes de publicar', expect.anything())
    expect(apiMock.publish).not.toHaveBeenCalled()
  })

  // BUG(empty-keywords-publish): gatilho "Palavra-chave" sem nenhuma palavra compila e
  // publica sem aviso, mas o webhook ignora fluxos com keywords vazias — o fluxo
  // publicado nunca dispara (validateTree não olha o trigger; compile.ts:724-727).
  it.fails('gatilho de palavra-chave sem palavras não pode ser publicado em silêncio', async () => {
    const tree: Flow = { ...validTree(), trigger: { type: 'keywords', label: 'Palavras-chave', keywords: [] } }
    const { result } = mountHook(savedWorkflow({ tree }))
    await act(async () => result.current.publish())
    expect(apiMock.publish).not.toHaveBeenCalled()
  })
})

describe('HK-08 publish feliz', () => {
  it('cancela o debounce, grava ANTES do publish e mostra "v3 publicada"', async () => {
    vi.useFakeTimers()
    const pub = deferred<{ success: boolean; versionId: string; version: number }>()
    apiMock.publish.mockReturnValueOnce(pub.promise)
    const { ref } = mountScreen()
    act(() => store().patchStep('A', { config: { message: 'antes de publicar' } }))

    let publishing!: Promise<void>
    await act(async () => {
      publishing = ref.current!.publish()
    })
    expect(ref.current?.publishing).toBe(true)
    expect(screen.getByRole('button', { name: /Publicando…/ })).toBeDisabled()
    expect(apiMock.update).toHaveBeenCalledTimes(1)
    expect(findStep(lastUpdateBody().tree, 'A')?.config.message).toBe('antes de publicar')
    expect(apiMock.update.mock.invocationCallOrder[0]).toBeLessThan(apiMock.publish.mock.invocationCallOrder[0])
    expect(apiMock.publish).toHaveBeenCalledWith(WF_ID)

    await act(async () => {
      pub.resolve({ success: true, versionId: 'v3', version: 3 })
      await publishing
    })
    expect(ref.current).toMatchObject({ publishing: false, publishedVersion: 3 })
    expect(toastMock.success).toHaveBeenCalledWith('Fluxo publicado (v3)')
    expect(screen.getByText('v3 publicada')).toBeInTheDocument()
    // o timer do debounce foi cancelado: nenhum save extra
    act(() => vi.advanceTimersByTime(3000))
    expect(apiMock.update).toHaveBeenCalledTimes(1)
  })

  it('o botão Publicar do header chama o publish do hook', async () => {
    mountScreen()
    await act(async () => screen.getByRole('button', { name: /Publicar/ }).click())
    expect(apiMock.publish).toHaveBeenCalledTimes(1)
  })

  it('publish duplicado enquanto publica é ignorado', async () => {
    const pub = deferred<{ success: boolean; versionId: string; version: number }>()
    apiMock.publish.mockReturnValueOnce(pub.promise)
    const { ref } = mountScreen()
    await act(async () => {
      void ref.current!.publish()
    })
    await act(async () => {
      await ref.current!.publish()
    })
    expect(apiMock.publish).toHaveBeenCalledTimes(1)
    await act(async () => pub.resolve({ success: true, versionId: 'v2', version: 2 }))
  })
})

describe('HK-09 publish com falha', () => {
  it('save falhou → não publica e publishing volta a false', async () => {
    apiMock.update.mockRejectedValueOnce(new Error('500'))
    const { result } = mountHook()
    await act(async () => result.current.publish())
    expect(apiMock.publish).not.toHaveBeenCalled()
    expect(result.current.publishing).toBe(false)
    expect(result.current.saveState).toBe('error')
  })

  it('publish falhou → toast e versão inalterada', async () => {
    apiMock.publish.mockRejectedValueOnce(new Error('400'))
    const { result } = mountHook(savedWorkflow({ lastPublishedVersion: 2 }))
    await act(async () => result.current.publish())
    expect(toastMock.error).toHaveBeenCalledWith('Falha ao publicar o fluxo')
    expect(result.current).toMatchObject({ publishing: false, publishedVersion: 2 })
  })
})

// ─── HK-10 ─────────────────────────────────────────────────────────────────────

describe('HK-10 respostas fora de ordem', () => {
  // BUG(autosave-race): cada estrutural dispara um PATCH sem fila nem número de
  // sequência (useWorkflowBuilder.ts:356-362). Se o save MAIS NOVO falha e um mais velho
  // resolve depois, o indicador termina em "Salvo" com a última edição perdida.
  it.fails('o save mais novo falhou → o estado final é "error"', async () => {
    const first = deferred()
    const second = deferred()
    apiMock.update.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const { result } = mountHook()
    act(() => insertAt({ kind: 'after', stepId: 'B' }, 'tag'))
    act(() => insertAt({ kind: 'after', stepId: 'A' }, 'tag_remove'))
    expect(apiMock.update).toHaveBeenCalledTimes(2)
    await act(async () => second.reject(new Error('timeout')))
    await act(async () => first.resolve({}))
    expect(result.current.saveState).toBe('error')
  })

  it('caracterização: hoje termina em "saved"', async () => {
    const first = deferred()
    const second = deferred()
    apiMock.update.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const { result } = mountHook()
    act(() => insertAt({ kind: 'after', stepId: 'B' }, 'tag'))
    act(() => insertAt({ kind: 'after', stepId: 'A' }, 'tag_remove'))
    await act(async () => second.reject(new Error('timeout')))
    await act(async () => first.resolve({}))
    expect(result.current.saveState).toBe('saved')
  })
})

// ─── HK-11 ─────────────────────────────────────────────────────────────────────

describe('HK-11 reabrir o builder com cache do React Query', () => {
  /** "Servidor" falso: o PATCH grava e o GET devolve o que foi gravado. */
  function fakeServer() {
    let current = savedWorkflow()
    apiMock.getById.mockImplementation(async () => structuredClone(current))
    apiMock.update.mockImplementation(async (_id: string, body: Record<string, unknown>) => {
      current = { ...current, ...body }
      return structuredClone(current)
    })
    return { get: () => current }
  }

  // BUG(stale-builder-cache): a query ['builder-workflow', id] tem staleTime Infinity e
  // nada a atualiza depois do autosave (useWorkflowBuilder.ts:273-279). Com o gcTime de
  // 5 min do app (app/providers.tsx), sair e voltar ao builder recarrega a árvore VELHA
  // do cache; o próximo autosave sobrescreve o servidor e apaga o que foi salvo.
  it.fails('voltar ao fluxo mostra a árvore salva, não a do cache', async () => {
    const server = fakeServer()
    const client = makeClient({ gcTime: 5 * 60 * 1000, staleTime: 30_000 })
    const first = renderHook(() => useWorkflowBuilder(WF_ID), { wrapper: wrapperFor(client) })
    await waitFor(() => expect(store().flow).not.toBeNull())
    await act(async () => insertAt({ kind: 'after', stepId: 'B' }, 'tag'))
    const inserted = store().selectedStepId!
    expect(findStep(server.get().tree as Flow, inserted)).not.toBeNull()
    first.unmount()

    renderHook(() => useWorkflowBuilder(WF_ID), { wrapper: wrapperFor(client) })
    await waitFor(() => expect(store().flow).not.toBeNull())
    await act(async () => {})
    expect(findStep(store().flow!, inserted)).not.toBeNull()
  })

  it('caracterização: o remount não refaz o GET e o próximo save apaga o passo salvo', async () => {
    const server = fakeServer()
    const client = makeClient({ gcTime: 5 * 60 * 1000, staleTime: 30_000 })
    const first = renderHook(() => useWorkflowBuilder(WF_ID), { wrapper: wrapperFor(client) })
    await waitFor(() => expect(store().flow).not.toBeNull())
    await act(async () => insertAt({ kind: 'after', stepId: 'B' }, 'tag'))
    const inserted = store().selectedStepId!
    first.unmount()

    renderHook(() => useWorkflowBuilder(WF_ID), { wrapper: wrapperFor(client) })
    await waitFor(() => expect(store().flow).not.toBeNull())
    expect(apiMock.getById).toHaveBeenCalledTimes(1)
    expect(findStep(store().flow!, inserted)).toBeNull()
    await act(async () => store().removeStep('B'))
    expect(findStep(server.get().tree as Flow, inserted)).toBeNull() // perdido no servidor
  })
})

// ─── HK-12 ─────────────────────────────────────────────────────────────────────

describe('HK-12 erro inesperado no compile', () => {
  /** Engole a rejeição não tratada do `void doSave()` só durante o teste. */
  async function withUnhandledRejections(fn: (seen: unknown[]) => Promise<void>) {
    const seen: unknown[] = []
    const previous = process.listeners('unhandledRejection')
    process.removeAllListeners('unhandledRejection')
    const handler = (reason: unknown) => seen.push(reason)
    process.on('unhandledRejection', handler)
    try {
      await fn(seen)
    } finally {
      await new Promise((r) => setTimeout(r, 20))
      process.removeListener('unhandledRejection', handler)
      for (const l of previous) process.on('unhandledRejection', l as (...args: unknown[]) => void)
    }
  }

  // BUG(save-stuck): doSave chama setSaveState('saving') e relança erros que não são
  // FlowCompileError dentro de `void doSave()` (useWorkflowBuilder.ts:326-337): rejeição
  // sem tratamento, nenhum toast, e o indicador fica em "Salvando…" para sempre.
  it.fails('TypeError no compile → estado "error" com toast', async () => {
    await withUnhandledRejections(async () => {
      const { result } = mountHook()
      vi.mocked(compileFlow).mockImplementationOnce(() => {
        throw new TypeError('boom')
      })
      await act(async () => insertAt({ kind: 'after', stepId: 'B' }, 'tag'))
      expect(result.current.saveState).toBe('error')
      expect(toastMock.error).toHaveBeenCalled()
    })
  })

  it('caracterização: fica preso em "saving" e a promise rejeita sem tratamento', async () => {
    await withUnhandledRejections(async (seen) => {
      const { result } = mountHook()
      vi.mocked(compileFlow).mockImplementationOnce(() => {
        throw new TypeError('boom')
      })
      await act(async () => insertAt({ kind: 'after', stepId: 'B' }, 'tag'))
      await new Promise((r) => setTimeout(r, 10))
      expect(result.current.saveState).toBe('saving')
      expect(apiMock.update).not.toHaveBeenCalled()
      expect(seen).toEqual([expect.any(TypeError)])
    })
  })
})
