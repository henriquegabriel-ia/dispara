// Cenário 2 — Gatilho do fluxo: Sem gatilho / Palavra-chave / Respondeu ao disparo.

import type { Page } from '@playwright/test'
import {
  configPanel,
  expect,
  openBuilder,
  shot,
  test,
  triggerNode,
  waitSaved,
} from '@/tests/e2e-builder/fixtures'
import type { FakeBackend, GraphNode } from '@/tests/e2e-builder/fake-backend'

const WF = 'wf-trigger'

async function openTriggerPanel(page: Page) {
  await triggerNode(page).click()
  await expect(configPanel(page).getByText('Gatilho do fluxo')).toBeVisible()
  return configPanel(page)
}

function triggerOption(page: Page, label: string) {
  return configPanel(page).getByRole('button', { name: new RegExp(`^${label}`) })
}

/** Espera um PATCH novo (debounce de 1s do autosave) e devolve o corpo. */
async function nextPatch(backend: FakeBackend, id: string, previousCount: number) {
  await expect.poll(() => backend.patchesFor(id).length, { timeout: 10_000 }).toBeGreaterThan(previousCount)
  const body = backend.lastPatch(id)!
  return body as {
    name: string
    tree: { trigger: Record<string, unknown>; root: unknown }
    nodes: GraphNode[]
    edges: unknown[]
  }
}

test.describe('Gatilho do fluxo', () => {
  test.beforeEach(async ({ backend }) => {
    // Fluxo novo como o "Novo fluxo" cria: grafo default do servidor, sem tree.
    backend.seedWorkflow({ id: WF, name: 'Fluxo gatilhos' })
  })

  test('Palavra-chave: nó só muda ao "Salvar gatilho"; salvar atualiza o canvas e grava tree + nó compilado', async ({ page, backend }) => {
    await openBuilder(page, WF)
    await expect(triggerNode(page)).toContainText('Adicionar novo gatilho')

    const panel = await openTriggerPanel(page)
    await expect(triggerOption(page, 'Sem gatilho')).toHaveClass(/border-primary-500/)
    await expect(panel.getByText('O fluxo não dispara sozinho.')).toBeVisible()

    await triggerOption(page, 'Palavra-chave').click()
    await expect(triggerOption(page, 'Palavra-chave')).toHaveClass(/border-primary-500/)
    // Uma por linha; espaços nas bordas e linhas vazias são descartados no save.
    await panel.locator('textarea').fill('quero\n  Inscrever  \n\noi')

    // Estado do print do usuário: painel em "Palavra-chave", nó ainda "Adicionar novo gatilho"
    // — o painel é um rascunho local; nada foi salvo ainda.
    await expect(triggerNode(page)).toContainText('Adicionar novo gatilho')
    expect(backend.patchesFor(WF)).toHaveLength(0)
    await shot(page, '02-gatilho-rascunho-antes-de-salvar')

    await panel.getByRole('button', { name: 'Salvar gatilho' }).click()
    await expect(triggerNode(page)).toContainText('Palavras-chave')
    await expect(triggerNode(page)).toContainText('3 palavras-chave')

    const body = await nextPatch(backend, WF, 0)
    await waitSaved(page)
    expect(body.name).toBe('Fluxo gatilhos')
    expect(body.tree.trigger).toEqual({
      type: 'keywords',
      label: 'Palavras-chave',
      keywords: ['quero', 'Inscrever', 'oi'],
      campaignId: null,
      campaignName: '',
      replyFilter: '',
    })
    expect(body.tree.root).toBeNull()
    expect(body.nodes).toHaveLength(1)
    expect(body.nodes[0]).toMatchObject({
      id: '__trigger',
      type: 'trigger',
      data: {
        type: 'trigger',
        label: 'Palavras-chave',
        config: { triggerType: 'Keywords', keywordList: 'quero\nInscrever\noi' },
      },
    })
    expect(body.edges).toEqual([])
    // O backend (validações reais do PATCH) aceitou.
    expect(backend.callsTo('PATCH', new RegExp(WF)).at(-1)?.status).toBe(200)
    await shot(page, '02-gatilho-palavra-chave-salvo')

    // Recarregar mostra o gatilho persistido.
    await page.reload()
    await expect(triggerNode(page)).toContainText('3 palavras-chave')
  })

  test('"Cancelar" descarta o rascunho e não salva nada', async ({ page, backend }) => {
    await openBuilder(page, WF)
    const panel = await openTriggerPanel(page)
    await triggerOption(page, 'Palavra-chave').click()
    await panel.locator('textarea').fill('promo')
    await panel.getByRole('button', { name: 'Salvar gatilho' }).click()
    await nextPatch(backend, WF, 0)
    await waitSaved(page)

    // Edita para "Respondeu ao disparo" e cancela.
    await triggerOption(page, 'Respondeu ao disparo').click()
    await expect(panel.getByText('A resposta contém (opcional)')).toBeVisible()
    await panel.getByPlaceholder('ex.: quero').fill('cancelado')
    await panel.getByRole('button', { name: 'Cancelar' }).click()

    await expect(triggerOption(page, 'Palavra-chave')).toHaveClass(/border-primary-500/)
    await expect(panel.locator('textarea')).toHaveValue('promo')
    await expect(triggerNode(page)).toContainText('1 palavra-chave')
    await page.waitForTimeout(1500) // > debounce do autosave
    expect(backend.patchesFor(WF)).toHaveLength(1)

    // Cancelar no gatilho também desfaz troca de texto não salva.
    await panel.locator('textarea').fill('promo\noutra')
    await panel.getByRole('button', { name: 'Cancelar' }).click()
    await expect(panel.locator('textarea')).toHaveValue('promo')
  })

  test('Respondeu ao disparo: campanha específica + frase; depois "Qualquer disparo"', async ({ page, backend }) => {
    await openBuilder(page, WF)
    const panel = await openTriggerPanel(page)
    await triggerOption(page, 'Respondeu ao disparo').click()

    const select = panel.locator('select')
    await expect(select).toBeEnabled()
    await expect(select.locator('option')).toHaveText(['Qualquer disparo', 'Black Friday VIP', 'Reativação Outubro'])
    expect(backend.callsTo('GET', /^\/api\/campaigns$/).length).toBeGreaterThan(0)

    await select.selectOption({ label: 'Black Friday VIP' })
    await panel.getByPlaceholder('ex.: quero').fill('  Quero o cupom  ')
    await panel.getByRole('button', { name: 'Salvar gatilho' }).click()

    await expect(triggerNode(page)).toContainText('Respondeu ao disparo')
    await expect(triggerNode(page)).toContainText('Campanha: Black Friday VIP')
    await expect(triggerNode(page)).toContainText('contém "Quero o cupom"')

    let body = await nextPatch(backend, WF, 0)
    expect(body.tree.trigger).toMatchObject({
      type: 'campaign_reply',
      label: 'Respondeu ao disparo',
      campaignId: 'camp-black-friday',
      campaignName: 'Black Friday VIP',
      replyFilter: 'Quero o cupom',
    })
    expect(body.nodes[0].data.config).toEqual({
      triggerType: 'CampaignReply',
      campaignId: 'camp-black-friday',
      campaignName: 'Black Friday VIP',
      replyFilter: 'Quero o cupom',
    })
    await waitSaved(page)
    await shot(page, '02-gatilho-respondeu-campanha')

    // Qualquer disparo, sem frase.
    await select.selectOption({ label: 'Qualquer disparo' })
    await panel.getByPlaceholder('ex.: quero').fill('')
    await panel.getByRole('button', { name: 'Salvar gatilho' }).click()
    await expect(triggerNode(page)).toContainText('Resposta a qualquer disparo')
    await expect(triggerNode(page)).not.toContainText('contém')
    body = await nextPatch(backend, WF, 1)
    expect(body.tree.trigger).toMatchObject({ type: 'campaign_reply', campaignId: null, campaignName: '', replyFilter: '' })
    expect(body.nodes[0].data.config).toEqual({ triggerType: 'CampaignReply', campaignId: '', campaignName: '', replyFilter: '' })
  })

  test('voltar para "Sem gatilho" restaura o slot vazio e compila triggerType None', async ({ page, backend }) => {
    await openBuilder(page, WF)
    const panel = await openTriggerPanel(page)
    await triggerOption(page, 'Palavra-chave').click()
    await panel.locator('textarea').fill('oi')
    await panel.getByRole('button', { name: 'Salvar gatilho' }).click()
    await nextPatch(backend, WF, 0)

    await triggerOption(page, 'Sem gatilho').click()
    await panel.getByRole('button', { name: 'Salvar gatilho' }).click()
    await expect(triggerNode(page)).toContainText('Adicionar novo gatilho')
    const body = await nextPatch(backend, WF, 1)
    expect(body.tree.trigger).toMatchObject({ type: 'none', label: '' })
    expect(body.nodes[0]).toMatchObject({
      id: '__trigger',
      data: { label: 'Sem gatilho (entrada manual)', config: { triggerType: 'None' } },
    })
  })

  // trigger-draft-discard: fechar o painel (X, clicar no canvas ou em outro nó) com
  // alterações não salvas pergunta antes de descartar (store.panelDirty).
  test('fechar o painel com rascunho não salvo não perde a configuração em silêncio', async ({ page, backend }) => {
    await openBuilder(page, WF)
    const panel = await openTriggerPanel(page)
    await triggerOption(page, 'Palavra-chave').click()
    await panel.locator('textarea').fill('quero\ninscrever\noi')

    let asked = false
    page.once('dialog', (dialog) => {
      asked = true
      void dialog.dismiss()
    })
    await panel.getByRole('button', { name: 'Fechar painel' }).click()
    await page.waitForTimeout(1500)

    // Correto: OU perguntou antes de descartar, OU aplicou o gatilho.
    const applied = (await triggerNode(page).innerText()).includes('palavras-chave')
    await shot(page, '02-bug-rascunho-descartado-ao-fechar')
    expect(asked || applied, 'rascunho do gatilho sumiu sem aviso').toBe(true)
    expect(backend.patchesFor(WF).length > 0 || asked).toBe(true)
  })
})
