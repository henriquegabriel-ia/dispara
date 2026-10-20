// Cenário 1 — /workflows: lista, cria fluxo novo e abre o builder.

import { expect, shot, test, toastWith, triggerNode } from '@/tests/e2e-builder/fixtures'
import { compiled, flow, twoMessagesTree } from '@/tests/e2e-builder/trees'

function card(page: import('@playwright/test').Page, name: string) {
  return page.locator('div[role="button"]').filter({ hasText: name })
}

test.describe('Lista de workflows (/workflows)', () => {
  test('lista os fluxos com gatilho, status e versão publicada', async ({ page, backend }) => {
    const kw = twoMessagesTree('wf-kw')
    backend.seedWorkflow({ id: 'wf-kw', name: 'Boas-vindas por palavra-chave', tree: kw, ...compiled(kw) })
    const pub = twoMessagesTree('wf-pub')
    backend.seedWorkflow({ id: 'wf-pub', name: 'Fluxo publicado', tree: pub, ...compiled(pub), publishedVersion: 3 })

    await page.goto('/workflows')
    await expect(page.getByRole('heading', { name: 'Fluxos' })).toBeVisible()
    await expect(page.getByText('2 fluxos encontrados')).toBeVisible()

    const kwCard = card(page, 'Boas-vindas por palavra-chave')
    await expect(kwCard).toContainText('Gatilho: Palavra-chave')
    await expect(kwCard).toContainText('Rascunho')
    await expect(kwCard.getByRole('button', { name: 'Publicar' })).toBeVisible()

    const pubCard = card(page, 'Fluxo publicado')
    await expect(pubCard).toContainText('Publicado')
    await expect(pubCard).toContainText('Última publicada: v3')
    // Fluxo publicado não oferece "Publicar" de novo na lista.
    await expect(pubCard.getByRole('button', { name: 'Publicar' })).toHaveCount(0)

    // Busca filtra pelo nome.
    await page.getByPlaceholder('Buscar fluxo...').fill('publicado')
    await expect(card(page, 'Boas-vindas por palavra-chave')).toHaveCount(0)
    await expect(page.getByText('1 fluxos encontrados')).toBeVisible()
    await page.getByPlaceholder('Buscar fluxo...').fill('')

    await shot(page, '01-lista-workflows')

    // Clicar no card abre o builder daquele fluxo.
    await kwCard.click()
    await expect(page).toHaveURL(/\/builder\/wf-kw$/)
    await expect(triggerNode(page)).toBeVisible()
    await expect(page.locator('header').getByText('Boas-vindas por palavra-chave')).toBeVisible()

    // "← Workflows" volta para a lista.
    await page.getByRole('link', { name: 'Workflows' }).click()
    await expect(page).toHaveURL(/\/workflows$/)
    await expect(page.getByRole('heading', { name: 'Fluxos' })).toBeVisible()
  })

  test('"Novo fluxo" cria via POST e abre o builder vazio (sem gatilho)', async ({ page, backend }) => {
    await page.goto('/workflows')
    await expect(page.getByText('Nenhum fluxo criado ainda.')).toBeVisible()

    await page.getByRole('button', { name: 'Novo fluxo' }).click()
    await expect(page).toHaveURL(/\/builder\/wf-e2e-\d+$/)

    const [create] = backend.callsTo('POST', /^\/api\/builder\/workflows\/create$/)
    expect(create, 'POST /api/builder/workflows/create').toBeTruthy()
    const body = create.body as { name: string; nodes: unknown[]; edges: unknown[] }
    expect(body.name).toMatch(/^Fluxo \d{8}_\d{4}$/)
    expect(body.nodes).toEqual([])
    expect(body.edges).toEqual([])

    // Builder abre com o nome criado e o slot "Adicionar novo gatilho".
    await expect(page.locator('header').getByText(body.name)).toBeVisible()
    await expect(triggerNode(page)).toContainText('Adicionar novo gatilho')
    await expect(triggerNode(page)).toContainText('Sem gatilho')
    await expect(page.locator('.react-flow__node[data-id="__plus-root"]')).toBeVisible()
    // Abrir o builder não dispara save sozinho.
    expect(backend.callsTo('PATCH', /./)).toHaveLength(0)
    await shot(page, '01-novo-fluxo-builder')
  })

  test('falha ao criar mostra toast e continua na lista', async ({ page, backend }) => {
    backend.failNext('POST', /^\/api\/builder\/workflows\/create$/, { status: 500 })
    await page.goto('/workflows')
    await expect(page.getByText('Nenhum fluxo criado ainda.')).toBeVisible()
    await page.getByRole('button', { name: 'Novo fluxo' }).click()
    await expect(toastWith(page, 'Falha ao criar fluxo')).toBeVisible()
    await expect(page).toHaveURL(/\/workflows$/)
  })

  // list-trigger-label: rótulos lidos da árvore (Sem gatilho / Palavra-chave /
  // Respondeu ao disparo); o grafo default de um fluxo recém-criado vira "Sem gatilho".
  test('rótulo do gatilho na lista fica em pt-BR e bate com o builder', async ({ page, backend }) => {
    backend.seedWorkflow({ id: 'wf-new', name: 'Fluxo recém-criado' })
    const none = flow('wf-none', 'Fluxo manual', { type: 'none', label: '', keywords: [] }, null)
    backend.seedWorkflow({ id: 'wf-none', name: 'Fluxo manual', tree: none, ...compiled(none) })
    const reply = flow(
      'wf-reply',
      'Resposta ao disparo',
      { type: 'campaign_reply', label: 'Respondeu ao disparo', campaignId: 'camp-black-friday', campaignName: 'Black Friday VIP', replyFilter: '' },
      null
    )
    backend.seedWorkflow({ id: 'wf-reply', name: 'Resposta ao disparo', tree: reply, ...compiled(reply) })

    await page.goto('/workflows')
    await expect(page.getByText('3 fluxos encontrados')).toBeVisible()
    await shot(page, '01-bug-rotulo-gatilho-lista')
    const labels = {
      manual: await card(page, 'Fluxo manual').innerText(),
      reply: await card(page, 'Resposta ao disparo').innerText(),
      fresh: await card(page, 'Fluxo recém-criado').innerText(),
    }
    expect(labels.manual).toContain('Gatilho: Sem gatilho')
    expect(labels.reply).toContain('Gatilho: Respondeu ao disparo')
    // No builder este fluxo abre como "Adicionar novo gatilho / Sem gatilho".
    expect(labels.fresh).not.toContain('Gatilho: Webhook')
  })
})
