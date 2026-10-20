// Cenário 4 — inserir no meio e dentro de branch, renomear, deletar com filhos e desfazer.

import type { Page } from '@playwright/test'
import { compileFlow } from '@/lib/builder/flow/compile'
import type { Flow, Step } from '@/lib/builder/flow/types'
import type { FakeBackend, GraphEdge, GraphNode } from '@/tests/e2e-builder/fake-backend'
import {
  branchPlaceholder,
  canvasNode,
  closePanel,
  configPanel,
  edgePlusBetween,
  expect,
  insertStep,
  openBuilder,
  saveAction,
  shot,
  test,
  waitSaved,
} from '@/tests/e2e-builder/fixtures'
import { askWithChildrenTree, compiled, twoMessagesTree } from '@/tests/e2e-builder/trees'

type PatchBody = { name: string; tree: Flow; nodes: GraphNode[]; edges: GraphEdge[] }

async function patchAfter(page: Page, backend: FakeBackend, id: string, count: number): Promise<PatchBody> {
  await expect.poll(() => backend.patchesFor(id).length, { timeout: 10_000 }).toBeGreaterThan(count)
  await waitSaved(page)
  return backend.lastPatch(id) as unknown as PatchBody
}

function edgePairs(body: PatchBody): Set<string> {
  return new Set(body.edges.map((e) => `${e.source}->${e.target}`))
}

function stepMenu(page: Page, id: string) {
  return canvasNode(page, id).getByRole('button', { name: 'Opções do passo' })
}

const undoButton = (page: Page) => page.getByTitle('Desfazer (Cmd+Z)')

test.describe('Edição estrutural', () => {
  test('inserir no meio (+ da edge entre A e B) religa A → novo → B', async ({ page, backend }) => {
    const tree = twoMessagesTree('wf-mid')
    backend.seedWorkflow({ id: 'wf-mid', name: tree.name, tree, ...compiled(tree) })
    await openBuilder(page, 'wf-mid')

    const plus = await edgePlusBetween(page, 'msgA', 'msgB')
    const wait = await insertStep(page, plus, 'Aguardar')
    await closePanel(page)

    const ys = await Promise.all(['msgA', wait, 'msgB'].map(async (id) => (await canvasNode(page, id).boundingBox())!.y))
    expect(ys[0]).toBeLessThan(ys[1])
    expect(ys[1]).toBeLessThan(ys[2])

    const body = await patchAfter(page, backend, 'wf-mid', 0)
    expect(body.tree.root?.id).toBe('msgA')
    expect(body.tree.root?.next?.id).toBe(wait)
    expect(body.tree.root?.next?.next?.id).toBe('msgB')
    const pairs = edgePairs(body)
    expect(pairs.has(`msgA->${wait}`)).toBe(true)
    expect(pairs.has(`${wait}->msgB`)).toBe(true)
    expect(pairs.has('msgA->msgB')).toBe(false)
    expect(body.nodes).toEqual(compileFlow(body.tree).nodes)
    await shot(page, '04-inserir-no-meio')
  })

  test('inserir dentro de branch: placeholder vazio e topo de branch com filho', async ({ page, backend }) => {
    const tree = askWithChildrenTree('wf-branch')
    backend.seedWorkflow({ id: 'wf-branch', name: tree.name, tree, ...compiled(tree) })
    await openBuilder(page, 'wf-branch')

    // Branch "Suporte" (vazia) → Adicionar tag.
    const tag = await insertStep(page, branchPlaceholder(page, 'ask2', 1), 'Adicionar tag')
    const tagInput = configPanel(page).getByPlaceholder('Digite a tag e pressione Enter')
    await tagInput.fill('suporte')
    await tagInput.press('Enter')
    await saveAction(page)
    await expect(canvasNode(page, tag)).toContainText('suporte')
    await closePanel(page)

    // Topo da branch "Comprar" (já tem filho) → Aguardar entra ANTES do filho.
    const plus = await edgePlusBetween(page, 'ask2', 'buyMsg')
    const wait = await insertStep(page, plus, 'Aguardar')
    await closePanel(page)

    const body = await patchAfter(page, backend, 'wf-branch', 1)
    const ask = body.tree.root as Step
    expect(ask.id).toBe('ask2')
    expect(ask.branches?.[0].child?.id).toBe(wait)
    expect(ask.branches?.[0].child?.next?.id).toBe('buyMsg')
    expect(ask.branches?.[1].child?.id).toBe(tag)
    expect(ask.next?.id).toBe('after')
    // Grafo: botão 0 → wait → buyMsg → after (convergência); botão 1 → tag → after.
    const pairs = edgePairs(body)
    expect(pairs.has(`ask2__cond_0->${wait}`)).toBe(true)
    expect(pairs.has(`${wait}->buyMsg`)).toBe(true)
    expect(pairs.has('buyMsg->after')).toBe(true)
    expect(pairs.has(`ask2__cond_1->${tag}`)).toBe(true)
    expect(pairs.has(`${tag}->after`)).toBe(true)
    expect(pairs.has('ask2__cond_else->after')).toBe(true)
    expect(body.nodes).toEqual(compileFlow(body.tree).nodes)
    await shot(page, '04-inserir-em-branch')
  })

  test('renomear passo pelo menu "…", pelo painel e renomear o fluxo no header', async ({ page, backend }) => {
    const tree = twoMessagesTree('wf-rename')
    backend.seedWorkflow({ id: 'wf-rename', name: tree.name, tree, ...compiled(tree) })
    await openBuilder(page, 'wf-rename')

    // Menu "…" → Renomear (inline no card).
    await stepMenu(page, 'msgA').click()
    await canvasNode(page, 'msgA').getByRole('button', { name: 'Renomear' }).click()
    const inline = canvasNode(page, 'msgA').locator('input')
    await inline.fill('Saudação')
    await inline.press('Enter')
    await expect(canvasNode(page, 'msgA')).toContainText('Saudação')
    let body = await patchAfter(page, backend, 'wf-rename', 0)
    expect(body.tree.root?.name).toBe('Saudação')
    expect(body.nodes.find((n) => n.id === 'msgA')?.data.label).toBe('Saudação')

    // Escape cancela o rename inline.
    await stepMenu(page, 'msgA').click()
    await canvasNode(page, 'msgA').getByRole('button', { name: 'Renomear' }).click()
    await canvasNode(page, 'msgA').locator('input').fill('Não deve ficar')
    await canvasNode(page, 'msgA').locator('input').press('Escape')
    await expect(canvasNode(page, 'msgA')).toContainText('Saudação')

    // Painel: campo "Nome da ação".
    const patches = backend.patchesFor('wf-rename').length
    await canvasNode(page, 'msgB').click()
    await configPanel(page).getByRole('textbox', { name: 'Nome da ação' }).fill('Despedida')
    await saveAction(page)
    await expect(canvasNode(page, 'msgB')).toContainText('Despedida')
    body = await patchAfter(page, backend, 'wf-rename', patches)
    expect(body.tree.root?.next?.name).toBe('Despedida')
    await closePanel(page)

    // Nome do fluxo no header.
    const before = backend.patchesFor('wf-rename').length
    await page.locator('header').getByRole('button', { name: /Duas mensagens/ }).click()
    const nameInput = page.locator('header input')
    await nameInput.fill('Fluxo renomeado')
    await nameInput.press('Enter')
    await expect(page.locator('header').getByText('Fluxo renomeado')).toBeVisible()
    body = await patchAfter(page, backend, 'wf-rename', before)
    expect(body.name).toBe('Fluxo renomeado')
    expect(backend.workflows.get('wf-rename')?.name).toBe('Fluxo renomeado')
    await shot(page, '04-renomear')
  })

  test('deletar passo com sub-árvore pede confirmação; aceitar remove tudo e religa a continuação; desfazer restaura', async ({ page, backend }) => {
    const tree = askWithChildrenTree('wf-del')
    backend.seedWorkflow({ id: 'wf-del', name: tree.name, tree, ...compiled(tree) })
    await openBuilder(page, 'wf-del')
    await expect(undoButton(page)).toBeDisabled()

    // 1ª tentativa: cancelar no confirm mantém tudo.
    const messages: string[] = []
    page.once('dialog', (d) => {
      messages.push(d.message())
      void d.dismiss()
    })
    await stepMenu(page, 'ask2').click()
    await canvasNode(page, 'ask2').getByRole('button', { name: 'Deletar' }).click()
    await expect.poll(() => messages.length).toBe(1)
    expect(messages[0]).toBe('Este passo contém branches com sub-árvores. Excluir tudo?')
    await expect(canvasNode(page, 'ask2')).toBeVisible()
    await expect(canvasNode(page, 'buyMsg')).toBeVisible()
    expect(backend.patchesFor('wf-del')).toHaveLength(0)

    // 2ª: aceitar.
    page.once('dialog', (d) => void d.accept())
    await stepMenu(page, 'ask2').click()
    await canvasNode(page, 'ask2').getByRole('button', { name: 'Deletar' }).click()
    await expect(canvasNode(page, 'ask2')).toHaveCount(0)
    await expect(canvasNode(page, 'buyMsg')).toHaveCount(0)
    await expect(canvasNode(page, 'after')).toBeVisible()
    let body = await patchAfter(page, backend, 'wf-del', 0)
    expect(body.tree.root?.id).toBe('after')
    expect(body.tree.root?.next).toBeNull()
    expect(body.nodes.map((n) => n.id).sort()).toEqual(['__trigger', 'after'])
    expect(edgePairs(body)).toEqual(new Set(['__trigger->after']))
    await shot(page, '04-deletar-com-filhos')

    // Desfazer pelo header.
    await expect(undoButton(page)).toBeEnabled()
    await undoButton(page).click()
    await expect(canvasNode(page, 'ask2')).toBeVisible()
    await expect(canvasNode(page, 'buyMsg')).toBeVisible()
    body = await patchAfter(page, backend, 'wf-del', 1)
    expect(body.tree.root?.id).toBe('ask2')
    expect(body.nodes).toEqual(compileFlow(body.tree).nodes)
    await expect(undoButton(page)).toBeDisabled()
    await shot(page, '04-desfazer')
  })

  test('Excluir pelo painel (passo simples) e Ctrl+Z desfaz', async ({ page, backend }) => {
    const tree = twoMessagesTree('wf-del2')
    backend.seedWorkflow({ id: 'wf-del2', name: tree.name, tree, ...compiled(tree) })
    await openBuilder(page, 'wf-del2')

    await canvasNode(page, 'msgA').click()
    await configPanel(page).getByRole('button', { name: 'Excluir' }).click()
    await expect(canvasNode(page, 'msgA')).toHaveCount(0)
    await expect(configPanel(page)).toHaveCount(0)
    let body = await patchAfter(page, backend, 'wf-del2', 0)
    expect(body.tree.root?.id).toBe('msgB')

    // Atalho de teclado (fora de inputs).
    await page.locator('.react-flow__pane').click({ position: { x: 20, y: 20 } })
    await page.keyboard.press('Control+z')
    await expect(canvasNode(page, 'msgA')).toBeVisible()
    body = await patchAfter(page, backend, 'wf-del2', 1)
    expect(body.tree.root?.id).toBe('msgA')
    expect(body.tree.root?.next?.id).toBe('msgB')
  })

  test('desfazer uma edição de configuração volta o valor anterior', async ({ page, backend }) => {
    const tree = twoMessagesTree('wf-undo-cfg')
    backend.seedWorkflow({ id: 'wf-undo-cfg', name: tree.name, tree, ...compiled(tree) })
    await openBuilder(page, 'wf-undo-cfg')

    await canvasNode(page, 'msgA').click()
    await configPanel(page).getByPlaceholder('Digite a mensagem a ser enviada...').fill('Mensagem nova')
    await saveAction(page)
    await expect(canvasNode(page, 'msgA')).toContainText('Mensagem nova')
    await patchAfter(page, backend, 'wf-undo-cfg', 0)

    await undoButton(page).click()
    await expect(canvasNode(page, 'msgA')).toContainText('Olá! Primeira mensagem.')
    // O painel aberto re-sincroniza com o valor desfeito (não "salva" o obsoleto).
    await expect(configPanel(page).getByPlaceholder('Digite a mensagem a ser enviada...')).toHaveValue('Olá! Primeira mensagem.')
    const body = await patchAfter(page, backend, 'wf-undo-cfg', 1)
    expect(body.tree.root?.config).toMatchObject({ message: 'Olá! Primeira mensagem.' })
  })
})
