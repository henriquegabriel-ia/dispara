// Cenário 5 — Autosave: indicador Salvando/Salvo, debounce, erro de save e rascunho.

import type { Page } from '@playwright/test'
import type { Flow } from '@/lib/builder/flow/types'
import type { FakeBackend, GraphNode } from '@/tests/e2e-builder/fake-backend'
import {
  canvasNode,
  configPanel,
  expect,
  insertStep,
  openBuilder,
  plusLeafAfter,
  saveAction,
  shot,
  test,
  toastWith,
  waitSaved,
} from '@/tests/e2e-builder/fixtures'
import { compiled, twoMessagesTree } from '@/tests/e2e-builder/trees'

const WF = 'wf-auto'
type PatchBody = { name: string; tree: Flow; nodes: GraphNode[] }

const header = (page: Page) => page.locator('header').filter({ hasText: 'Publicar' })

async function editMessage(page: Page, stepId: string, text: string) {
  await canvasNode(page, stepId).click()
  await configPanel(page).getByPlaceholder('Digite a mensagem a ser enviada...').fill(text)
  await saveAction(page)
}

function seed(backend: FakeBackend) {
  const tree = twoMessagesTree(WF)
  backend.seedWorkflow({ id: WF, name: 'Fluxo autosave', tree, ...compiled(tree) })
}

test.describe('Autosave', () => {
  test.beforeEach(async ({ backend }) => seed(backend))

  test('indicador "Salvando…" → "Salvo" e debounce de 1s junta edições de configuração', async ({ page, backend }) => {
    await openBuilder(page, WF)
    await expect(header(page).getByText('Salvo', { exact: true })).toBeVisible()
    backend.delayNext('PATCH', new RegExp(`/${WF}$`), 2500)

    await editMessage(page, 'msgA', 'Primeira edição')
    await configPanel(page).getByPlaceholder('Digite a mensagem a ser enviada...').fill('Segunda edição')
    await saveAction(page)
    // Ainda dentro do debounce: nada enviado.
    expect(backend.patchesFor(WF)).toHaveLength(0)

    await expect(header(page).getByText('Salvando…')).toBeVisible({ timeout: 5000 })
    await shot(page, '05-salvando')
    await waitSaved(page)
    await page.waitForTimeout(1500)
    // Duas edições → um PATCH, com o valor final.
    expect(backend.patchesFor(WF)).toHaveLength(1)
    const body = backend.lastPatch(WF) as unknown as PatchBody
    expect(body.tree.root?.config).toMatchObject({ message: 'Segunda edição' })
    expect(body.nodes.find((n) => n.id === 'msgA')?.data.config).toMatchObject({ message: 'Segunda edição' })
  })

  test('PATCH 500: mostra "Erro ao salvar" + toast, mantém a edição e a próxima edição salva tudo', async ({ page, backend }) => {
    await openBuilder(page, WF)
    backend.failNext('PATCH', new RegExp(`/${WF}$`), { status: 500 })

    await editMessage(page, 'msgA', 'Edição que falhou')
    await expect(header(page).getByText('Erro ao salvar')).toBeVisible({ timeout: 10_000 })
    await expect(toastWith(page, 'Falha ao salvar o fluxo')).toBeVisible()
    await shot(page, '05-erro-ao-salvar')
    // A edição continua na tela (canvas + painel).
    await expect(canvasNode(page, 'msgA')).toContainText('Edição que falhou')
    await expect(configPanel(page).getByPlaceholder('Digite a mensagem a ser enviada...')).toHaveValue('Edição que falhou')
    expect(backend.callsTo('PATCH', new RegExp(WF)).at(-1)?.status).toBe(500)

    // Próxima edição: salva o estado inteiro (inclui a que falhou). O retry
    // automático (5s) também pode gravar no meio — espera o PATCH com as duas.
    await editMessage(page, 'msgB', 'Edição seguinte')
    await expect
      .poll(() => (backend.lastPatch(WF) as unknown as PatchBody | undefined)?.tree.root?.next?.config.message, { timeout: 10_000 })
      .toBe('Edição seguinte')
    await waitSaved(page)
    const body = backend.lastPatch(WF) as unknown as PatchBody
    expect(body.tree.root?.config).toMatchObject({ message: 'Edição que falhou' })
    expect(body.tree.root?.next?.config).toMatchObject({ message: 'Edição seguinte' })
    expect(backend.activeVersion(WF).nodes.find((n) => n.id === 'msgA')?.data.config).toMatchObject({ message: 'Edição que falhou' })
  })

  test('PATCH 400 (validação do servidor) também vira "Erro ao salvar"', async ({ page, backend }) => {
    await openBuilder(page, WF)
    backend.failNext('PATCH', new RegExp(`/${WF}$`), { status: 400, body: { error: 'Invalid workflow' } })
    await editMessage(page, 'msgA', 'Recusada pelo servidor')
    await expect(header(page).getByText('Erro ao salvar')).toBeVisible({ timeout: 10_000 })
    await expect(toastWith(page, 'Falha ao salvar o fluxo')).toBeVisible()
  })

  test('sair do builder antes do debounce flusha o save pendente', async ({ page, backend }) => {
    await openBuilder(page, WF)
    await editMessage(page, 'msgA', 'Salva ao sair')
    // < 1s: ainda no debounce.
    await page.getByRole('link', { name: 'Workflows' }).click()
    await expect(page).toHaveURL(/\/workflows$/)
    await expect.poll(() => backend.patchesFor(WF).length).toBe(1)
    const body = backend.lastPatch(WF) as unknown as PatchBody
    expect(body.tree.root?.config).toMatchObject({ message: 'Salva ao sair' })
  })

  // save-error-no-retry: o save que falhou continua pendente — re-tenta sozinho
  // (5s) e no unmount; sair e voltar mostra a edição.
  test('com "Erro ao salvar", sair e voltar não perde a edição (re-tenta ou avisa)', async ({ page, backend }) => {
    await openBuilder(page, WF)
    backend.failNext('PATCH', new RegExp(`/${WF}$`), { status: 500 })
    await editMessage(page, 'msgA', 'Edição que não pode sumir')
    await expect(header(page).getByText('Erro ao salvar')).toBeVisible({ timeout: 10_000 })

    let warned = false
    page.on('dialog', (d) => {
      warned = true
      void d.dismiss()
    })
    await page.getByRole('link', { name: 'Workflows' }).click()
    await page.waitForTimeout(1500)
    if (!warned) {
      await page.goto(`/builder/${WF}`)
      await expect(canvasNode(page, 'msgA')).toBeVisible()
      await expect(canvasNode(page, 'msgA')).toContainText('Edição que não pode sumir', { timeout: 3000 })
    }
  })

  // stale-builder-cache: a query do builder não sobrevive à saída e a carga espera o
  // save do unmount — voltar pela lista mostra o que foi salvo.
  test('voltar ao fluxo pela lista (navegação client-side) mostra o que foi salvo e não sobrescreve com versão antiga', async ({ page, backend }) => {
    await page.goto('/workflows')
    await page.locator('div[role="button"]').filter({ hasText: 'Fluxo autosave' }).click()
    await expect(canvasNode(page, 'msgA')).toBeVisible()

    await editMessage(page, 'msgA', 'Editado e salvo')
    await expect.poll(() => backend.patchesFor(WF).length).toBe(1)
    await waitSaved(page)
    expect(backend.activeVersion(WF).nodes.find((n) => n.id === 'msgA')?.data.config).toMatchObject({ message: 'Editado e salvo' })

    // Sai e volta sem recarregar a página.
    await page.getByRole('link', { name: 'Workflows' }).click()
    await expect(page.getByRole('heading', { name: 'Fluxos' })).toBeVisible()
    await page.locator('div[role="button"]').filter({ hasText: 'Fluxo autosave' }).click()
    await expect(canvasNode(page, 'msgA')).toBeVisible()
    await shot(page, '05-voltar-mostra-o-salvo')

    // Uma edição qualquer em outro passo dispara o autosave da árvore em memória.
    await editMessage(page, 'msgB', 'Outra edição')
    await expect.poll(() => backend.patchesFor(WF).length).toBe(2)
    const serverMsgA = backend.activeVersion(WF).nodes.find((n) => n.id === 'msgA')?.data.config
    expect(serverMsgA, 'servidor perdeu a edição de msgA').toMatchObject({ message: 'Editado e salvo' })
    await expect(canvasNode(page, 'msgA')).toContainText('Editado e salvo', { timeout: 2000 })
  })

  test('passo vazio: salva como rascunho (tree nova + grafo anterior) com pendência na tela; ao preencher, o grafo é recompilado', async ({ page, backend }) => {
    await openBuilder(page, WF)
    const graphBefore = backend.activeVersion(WF).nodes.map((n) => n.id)

    const empty = await insertStep(page, plusLeafAfter(page, 'msgB'), 'WhatsApp')
    // Sem toast (cobria o painel): a pendência fica no header e no card.
    await expect(toastWith(page, 'Fluxo salvo como rascunho')).toHaveCount(0)
    const issues = page.locator('header').getByRole('button', { name: '1 pendência para publicar' })
    await expect(issues).toBeVisible()
    await issues.click()
    await expect(page.getByRole('dialog', { name: 'Pendências do fluxo' })).toContainText('Passo WhatsApp "WhatsApp" está vazio')
    await page.keyboard.press('Escape')
    await expect(canvasNode(page, empty).getByRole('img', { name: /Pendência/ })).toBeVisible()
    await expect.poll(() => backend.patchesFor(WF).length).toBe(1)
    let body = backend.lastPatch(WF) as unknown as PatchBody
    expect(body.tree.root?.next?.next?.id).toBe(empty)
    // Grafo NÃO inclui o passo vazio: mantém o último que compilou.
    expect(body.nodes.map((n) => n.id)).toEqual(graphBefore)
    expect(backend.callsTo('PATCH', new RegExp(WF)).at(-1)?.status).toBe(200)

    await configPanel(page).getByPlaceholder('Digite a mensagem a ser enviada...').fill('Agora tem texto')
    await saveAction(page)
    await expect.poll(() => backend.patchesFor(WF).length).toBe(2)
    await waitSaved(page)
    body = backend.lastPatch(WF) as unknown as PatchBody
    expect(body.nodes.map((n) => n.id)).toContain(empty)
    expect(body.nodes.find((n) => n.id === empty)?.data.config).toMatchObject({ actionType: 'whatsapp/send-message', message: 'Agora tem texto' })
  })
})
