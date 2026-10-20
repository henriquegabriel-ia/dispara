// Cenário 6 — Publicar (bloqueio por árvore inválida, flush do save, versão) e "Testar workflow".

import type { Page } from '@playwright/test'
import {
  canvasNode,
  configPanel,
  expect,
  openBuilder,
  saveAction,
  shot,
  test,
  toastWith,
  waitSaved,
} from '@/tests/e2e-builder/fixtures'
import { compiled, flow, invalidTree, twoMessagesTree } from '@/tests/e2e-builder/trees'

const publishButton = (page: Page) => page.locator('header').getByRole('button', { name: /^(Publicar|Publicando…)$/ })
const publishCalls = (backend: import('@/tests/e2e-builder/fake-backend').FakeBackend, id: string) =>
  backend.callsTo('POST', new RegExp(`^/api/builder/workflows/${id}/publish$`))

test.describe('Publicar', () => {
  test('árvore inválida bloqueia a publicação com a mensagem do passo', async ({ page, backend }) => {
    const tree = invalidTree('wf-invalid')
    // Grafo salvo = último que compilou (só o gatilho).
    backend.seedWorkflow({ id: 'wf-invalid', name: tree.name, tree, ...compiled({ ...tree, root: null }) })
    await openBuilder(page, 'wf-invalid')

    await publishButton(page).click()
    await expect(toastWith(page, 'Corrija o fluxo antes de publicar')).toBeVisible()
    await expect(toastWith(page, /Passo WhatsApp "Mensagem vazia" está vazio/)).toBeVisible()
    await shot(page, '06-publicar-bloqueado')
    expect(publishCalls(backend, 'wf-invalid')).toHaveLength(0)
    expect(backend.patchesFor('wf-invalid')).toHaveLength(0)
    await expect(page.locator('header').getByText(/publicada$/)).toHaveCount(0)
  })

  test('árvore válida: flusha o save pendente, publica e mostra a versão', async ({ page, backend }) => {
    const tree = twoMessagesTree('wf-pub')
    backend.seedWorkflow({ id: 'wf-pub', name: tree.name, tree, ...compiled(tree) })
    await openBuilder(page, 'wf-pub')
    backend.delayNext('POST', /\/publish$/, 1500)

    // Edição ainda no debounce + Publicar logo em seguida.
    await canvasNode(page, 'msgA').click()
    await configPanel(page).getByPlaceholder('Digite a mensagem a ser enviada...').fill('Versão publicada')
    await saveAction(page)
    await publishButton(page).click()

    await expect(publishButton(page)).toHaveText('Publicando…')
    await expect(publishButton(page)).toBeDisabled()
    await expect(toastWith(page, 'Fluxo publicado (v2)')).toBeVisible()
    await expect(page.locator('header').getByText('v2 publicada')).toBeVisible()
    await expect(publishButton(page)).toHaveText('Publicar')
    await shot(page, '06-publicado-v2')

    // Ordem: PATCH (flush) antes do POST publish; publish recebeu o estado novo.
    const order = backend.calls.filter((c) => /wf-pub(\/publish)?$/.test(c.path) && c.method !== 'GET').map((c) => `${c.method} ${c.path}`)
    expect(order).toEqual(['PATCH /api/builder/workflows/wf-pub', 'POST /api/builder/workflows/wf-pub/publish'])
    const wf = backend.workflows.get('wf-pub')!
    expect(wf.status).toBe('published')
    const published = wf.versions.find((v) => v.status === 'published')!
    expect(published.version).toBe(2)
    expect(published.nodes.find((n) => n.id === 'msgA')?.data.config).toMatchObject({ message: 'Versão publicada' })

    // Publicar de novo → v3.
    await publishButton(page).click()
    await expect(page.locator('header').getByText('v3 publicada')).toBeVisible()

    // A lista reflete.
    await page.goto('/workflows')
    const card = page.locator('div[role="button"]').filter({ hasText: 'Duas mensagens' })
    await expect(card).toContainText('Publicado')
    await expect(card).toContainText('Última publicada: v3')
  })

  test('fluxo "Sem gatilho" válido publica (entrada manual)', async ({ page, backend }) => {
    const tree = flow('wf-none-pub', 'Manual', { type: 'none', label: '', keywords: [] }, twoMessagesTree().root)
    backend.seedWorkflow({ id: 'wf-none-pub', name: 'Manual', tree, ...compiled(tree) })
    await openBuilder(page, 'wf-none-pub')
    await publishButton(page).click()
    await expect(page.locator('header').getByText('v2 publicada')).toBeVisible()
    const published = backend.workflows.get('wf-none-pub')!.versions.find((v) => v.status === 'published')!
    expect(published.nodes.find((n) => n.id === '__trigger')?.data.config).toEqual({ triggerType: 'None' })
  })

  test('versão publicada aparece ao abrir; erro no publish mostra toast e mantém a versão', async ({ page, backend }) => {
    const tree = twoMessagesTree('wf-pub-err')
    backend.seedWorkflow({ id: 'wf-pub-err', name: tree.name, tree, ...compiled(tree), publishedVersion: 3 })
    await openBuilder(page, 'wf-pub-err')
    await expect(page.locator('header').getByText('v3 publicada')).toBeVisible()

    backend.failNext('POST', /\/publish$/, { status: 400, body: { error: 'Grafo inválido' } })
    await publishButton(page).click()
    await expect(toastWith(page, 'Falha ao publicar o fluxo')).toBeVisible()
    await expect(page.locator('header').getByText('v3 publicada')).toBeVisible()
    await expect(publishButton(page)).toBeEnabled()
  })

  test('save falhando durante o publish não chama a rota de publicar', async ({ page, backend }) => {
    const tree = twoMessagesTree('wf-pub-save')
    backend.seedWorkflow({ id: 'wf-pub-save', name: tree.name, tree, ...compiled(tree) })
    await openBuilder(page, 'wf-pub-save')
    backend.failNext('PATCH', /wf-pub-save$/, { status: 500 })
    await publishButton(page).click()
    await expect(toastWith(page, 'Falha ao salvar o fluxo')).toBeVisible()
    await expect(page.locator('header').getByText('Erro ao salvar')).toBeVisible()
    expect(publishCalls(backend, 'wf-pub-save')).toHaveLength(0)
  })

  test('"Testar workflow" está desabilitado ("Em breve") e não dispara nenhuma requisição', async ({ page, backend }) => {
    const tree = twoMessagesTree('wf-test')
    backend.seedWorkflow({ id: 'wf-test', name: tree.name, tree, ...compiled(tree) })
    await openBuilder(page, 'wf-test')
    await waitSaved(page)

    const testButton = page.locator('header').getByRole('button', { name: 'Testar workflow' })
    await expect(testButton).toBeDisabled()
    await expect(page.locator('header span[title="Em breve"]')).toBeVisible()
    const before = backend.calls.length
    await testButton.click({ force: true })
    await page.waitForTimeout(800)
    const after = backend.calls.slice(before).map((c) => `${c.method} ${c.path}`)
    expect(after.filter((c) => /\/(run|execute|enroll|webhook)$/.test(c))).toEqual([])
    expect(after.filter((c) => !c.startsWith('GET '))).toEqual([])
    await shot(page, '06-testar-workflow-em-breve')
  })
})
