// Cenário 9 — Jornada completa sem erros no console, sem rota de API desconhecida
// e sem nenhuma requisição saindo de localhost.

import {
  branchPlaceholder,
  closePanel,
  configPanel,
  expect,
  insertStep,
  plusLeafAfter,
  plusRoot,
  saveAction,
  shot,
  test,
  toastWith,
  triggerNode,
  waitSaved,
} from '@/tests/e2e-builder/fixtures'

test('jornada lista → novo fluxo → gatilho → passos → publicar sem erros no console', async ({
  page,
  backend,
  consoleErrors,
  externalRequests,
}) => {
  test.slow()
  await page.goto('/workflows')
  await page.getByRole('button', { name: 'Novo fluxo' }).click()
  await expect(page).toHaveURL(/\/builder\//)
  await expect(triggerNode(page)).toBeVisible()
  const id = decodeURIComponent(new URL(page.url()).pathname.split('/').pop()!)

  // Gatilho por palavra-chave.
  await triggerNode(page).click()
  await configPanel(page).getByRole('button', { name: /^Palavra-chave/ }).click()
  await configPanel(page).locator('textarea').fill('quero\nmenu')
  await configPanel(page).getByRole('button', { name: 'Salvar gatilho' }).click()
  await expect(triggerNode(page)).toContainText('2 palavras-chave')
  await closePanel(page)

  // Mensagem + pergunta com 2 botões + condição + fim.
  const wa = await insertStep(page, plusRoot(page), 'WhatsApp')
  await configPanel(page).getByPlaceholder('Digite a mensagem a ser enviada...').fill('Oi! Bem-vindo.')
  await saveAction(page)
  await closePanel(page)
  const ask = await insertStep(page, plusLeafAfter(page, wa), 'Perguntar')
  await configPanel(page).getByPlaceholder('Texto da pergunta enviada ao contato...').fill('Como posso ajudar?')
  await configPanel(page).locator('input[maxlength="20"]').nth(0).fill('Comprar')
  await configPanel(page).getByRole('button', { name: /Adicionar botão/ }).click()
  await configPanel(page).locator('input[maxlength="20"]').nth(1).fill('Suporte')
  await saveAction(page)
  await closePanel(page)
  await page.locator('.react-flow__controls-fitview').click()
  await insertStep(page, branchPlaceholder(page, ask, 0), 'Adicionar tag')
  await configPanel(page).getByPlaceholder('Digite a tag e pressione Enter').fill('comprador')
  await configPanel(page).getByPlaceholder('Digite a tag e pressione Enter').press('Enter')
  await saveAction(page)
  await closePanel(page)
  await page.locator('.react-flow__controls-fitview').click()
  await insertStep(page, branchPlaceholder(page, ask, 1), 'Encerrar (End)')
  await closePanel(page)
  await waitSaved(page)

  await page.locator('header').getByRole('button', { name: 'Publicar' }).click()
  await expect(toastWith(page, 'Fluxo publicado (v2)')).toBeVisible()
  await shot(page, '09-jornada-publicada')

  await page.getByRole('link', { name: 'Workflows' }).click()
  await expect(page.locator('div[role="button"]').filter({ hasText: 'Publicado' })).toBeVisible()
  expect(backend.workflows.get(id)?.status).toBe('published')

  expect(consoleErrors, JSON.stringify(consoleErrors, null, 2)).toEqual([])
  expect(backend.unhandled, 'rotas /api sem resposta no backend falso').toEqual([])
  expect(externalRequests, 'requisições para fora de localhost').toEqual([])
  // Todo PATCH da jornada foi aceito pelas validações reais do servidor.
  expect(backend.callsTo('PATCH', /./).map((c) => c.status)).not.toContain(400)
})
