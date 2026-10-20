// Cenário 3 — Passos: ActionPicker + ConfigPanel de cada tipo, canvas e o PATCH
// (árvore + grafo compilado) coerentes.

import type { Page } from '@playwright/test'
import { compileFlow } from '@/lib/builder/flow/compile'
import type { Flow, Step } from '@/lib/builder/flow/types'
import type { GraphEdge, GraphNode } from '@/tests/e2e-builder/fake-backend'
import {
  actionPicker,
  branchPlaceholder,
  canvasNode,
  closePanel,
  configPanel,
  dismissToasts,
  expect,
  fitView,
  insertStep,
  nodeBoxes,
  nodeText,
  openBuilder,
  overlappingPairs,
  pickerItem,
  plusLeafAfter,
  plusRoot,
  saveAction,
  shot,
  test,
  waitSaved,
} from '@/tests/e2e-builder/fixtures'
import { compiled, flow } from '@/tests/e2e-builder/trees'

const WF = 'wf-steps'

type PatchBody = { name: string; tree: Flow; nodes: GraphNode[]; edges: GraphEdge[] }

function seedEmpty(backend: import('@/tests/e2e-builder/fake-backend').FakeBackend) {
  const tree = flow(WF, 'Fluxo passos', { keywords: ['oi'] }, null)
  backend.seedWorkflow({ id: WF, name: 'Fluxo passos', tree, ...compiled(tree) })
}

async function lastSavedBody(page: Page, backend: import('@/tests/e2e-builder/fake-backend').FakeBackend, minCount: number): Promise<PatchBody> {
  await expect.poll(() => backend.patchesFor(WF).length, { timeout: 10_000 }).toBeGreaterThanOrEqual(minCount)
  await waitSaved(page)
  return backend.lastPatch(WF) as unknown as PatchBody
}

function findInTree(step: Step | null, id: string): Step | null {
  if (!step) return null
  if (step.id === id) return step
  for (const b of step.branches ?? []) {
    const hit = findInTree(b.child, id)
    if (hit) return hit
  }
  return findInTree(step.next, id)
}

test.describe('Passos do fluxo', () => {
  test.beforeEach(async ({ backend }) => seedEmpty(backend))

  test('ActionPicker lista os 10 tipos por categoria; "Em breve" (Split, Go To) não insere; busca filtra', async ({ page, backend }) => {
    await openBuilder(page, WF)
    await plusRoot(page).click()
    const picker = actionPicker(page)
    await expect(picker).toBeVisible()
    for (const category of ['Mensagem', 'Lógica', 'Dados', 'CRM']) {
      await expect(picker.getByText(category, { exact: true })).toBeVisible()
    }
    const labels = [
      'WhatsApp',
      'Perguntar',
      'Condição',
      'Split',
      'Aguardar',
      'Ir para (Go To)',
      'Encerrar (End)',
      'Adicionar tag',
      'Remover tag',
      'Mover no pipeline',
    ]
    for (const label of labels) await expect(pickerItem(page, label)).toHaveCount(1)
    await expect(pickerItem(page, 'Split')).toHaveAttribute('aria-disabled', 'true')
    await expect(pickerItem(page, 'Ir para (Go To)')).toHaveAttribute('aria-disabled', 'true')
    await expect(pickerItem(page, 'Split')).toContainText('Em breve')
    await shot(page, '03-action-picker')

    // "Em breve": clique não insere nada nem salva.
    await pickerItem(page, 'Split').click({ force: true }) // aria-disabled: o usuário ainda consegue clicar
    await pickerItem(page, 'Ir para (Go To)').click({ force: true })
    await expect(page.locator('.react-flow__node-step')).toHaveCount(0)
    expect(backend.patchesFor(WF)).toHaveLength(0)

    // Busca ignora acento/maiúscula.
    await picker.getByPlaceholder('Buscar ação...').fill('condicao')
    await expect(picker.getByRole('button')).toHaveCount(1)
    await expect(pickerItem(page, 'Condição')).toBeVisible()
    await picker.getByPlaceholder('Buscar ação...').fill('xyz')
    await expect(picker.getByText('Nenhuma ação encontrada')).toBeVisible()

    // Esc fecha.
    await page.keyboard.press('Escape')
    await expect(picker).toBeHidden()
  })

  test('monta um fluxo com todos os passos v1 via UI; canvas e PATCH (tree + grafo compilado) coerentes', async ({ page, backend }) => {
    test.slow()
    await openBuilder(page, WF)

    // 1) WhatsApp com template aprovado + mensagem com variável.
    const wa = await insertStep(page, plusRoot(page), 'WhatsApp')
    let panel = configPanel(page)
    await expect(panel.getByRole('textbox', { name: 'Nome da ação' })).toHaveValue('WhatsApp')
    const tplSelect = panel.locator('select')
    await expect(tplSelect).toBeEnabled()
    // Só templates APPROVED (o PENDING fica de fora).
    await expect(tplSelect.locator('option')).toHaveText([
      'Nenhum — mensagem livre',
      'boas_vindas (pt_BR) - MARKETING',
      'lembrete_pagamento (pt_BR) - UTILIDADE',
    ])
    await tplSelect.selectOption({ label: 'boas_vindas (pt_BR) - MARKETING' })
    // Template com {{1}}: a mensagem livre some e aparece o campo da variável.
    await expect(panel.getByPlaceholder('Digite a mensagem a ser enviada...')).toHaveCount(0)
    await expect(panel.locator('span', { hasText: '{{1}}' })).toBeVisible()
    await panel.getByRole('textbox', { name: 'Valor de {{1}}' }).fill('{{var.nome}}')
    await saveAction(page)
    await expect(canvasNode(page, wa)).toContainText('boas_vindas')
    await closePanel(page)

    // 2) Aguardar — valor acima do cap (5 min) é ajustado ao salvar.
    const wait = await insertStep(page, plusLeafAfter(page, wa), 'Aguardar')
    panel = configPanel(page)
    const minutes = panel.locator('input[type="number"]')
    await expect(minutes).toHaveValue('2')
    await expect(panel.locator('option[value="hours"]')).toBeDisabled()
    await minutes.fill('9')
    await expect(panel.getByText('Valor ajustado para 1–5 minutos ao salvar.')).toBeVisible()
    await saveAction(page)
    await expect(canvasNode(page, wait)).toContainText('5 minutos')
    await closePanel(page)

    // 3) Adicionar tag — chips, remoção e sugestão das tags existentes.
    await fitView(page)
    const tag = await insertStep(page, plusLeafAfter(page, wait), 'Adicionar tag')
    panel = configPanel(page)
    await expect(panel.locator('datalist#flow-tag-suggestions option')).toHaveCount(3)
    const tagInput = panel.getByPlaceholder('Digite a tag e pressione Enter')
    await tagInput.fill('vip')
    await tagInput.press('Enter')
    await tagInput.fill('novo-lead')
    await tagInput.press('Enter')
    await panel.getByRole('button', { name: 'Remover tag novo-lead' }).click()
    await tagInput.fill('lead-quente')
    await tagInput.press('Enter')
    await saveAction(page)
    await expect(canvasNode(page, tag)).toContainText('vip, lead-quente')
    await closePanel(page)

    // 4) Remover tag.
    await fitView(page)
    const tagRm = await insertStep(page, plusLeafAfter(page, tag), 'Remover tag')
    panel = configPanel(page)
    await expect(panel.getByText('Tags a remover')).toBeVisible()
    await panel.getByPlaceholder('Digite a tag e pressione Enter').fill('frio')
    await panel.getByPlaceholder('Digite a tag e pressione Enter').press('Enter')
    await saveAction(page)
    await expect(canvasNode(page, tagRm)).toContainText('frio')
    await closePanel(page)

    // 5) Mover no pipeline.
    await fitView(page)
    const pipe = await insertStep(page, plusLeafAfter(page, tagRm), 'Mover no pipeline')
    panel = configPanel(page)
    const selects = panel.locator('select')
    await expect(selects.nth(0)).toBeEnabled()
    await expect(selects.nth(1)).toBeDisabled()
    await selects.nth(0).selectOption({ label: 'Vendas' })
    await selects.nth(1).selectOption({ label: 'Proposta enviada' })
    await selects.nth(2).selectOption({ label: 'Ganha' })
    await saveAction(page)
    await expect(canvasNode(page, pipe)).toContainText('Vendas → Proposta enviada')
    await closePanel(page)

    // 6) Perguntar (botões): 1..3, ≤ 20 caracteres.
    await fitView(page)
    const ask = await insertStep(page, plusLeafAfter(page, pipe), 'Perguntar')
    panel = configPanel(page)
    await expect(panel.getByText('Perguntar (aguardar resposta)')).toBeVisible()
    await panel.getByPlaceholder('Texto da pergunta enviada ao contato...').fill('Quer falar com um atendente?')
    const buttons = panel.locator('input[maxlength="20"]')
    await expect(buttons).toHaveCount(1) // branches locked (Not Delivered/Timeout) removidas no v1
    await buttons.nth(0).fill('Sim')
    await panel.getByRole('button', { name: /Adicionar botão/ }).click()
    await buttons.nth(1).fill('Não')
    await panel.getByRole('button', { name: /Adicionar botão/ }).click()
    await expect(buttons).toHaveCount(3)
    // Até 3 opções: botões do WhatsApp (acima disso vira lista, até 10).
    await expect(panel.getByText(/Enviados como botões do WhatsApp \(até 3\)/)).toBeVisible()
    await buttons.nth(2).fill('Um texto com mais de vinte chars')
    await expect(buttons.nth(2)).toHaveValue('Um texto com mais de') // maxLength 20
    await panel.getByRole('button', { name: 'Remover botão' }).nth(2).click()
    await expect(buttons).toHaveCount(2)
    await saveAction(page)
    await expect(canvasNode(page, ask)).toContainText('2 botões interativos')
    await expect(canvasNode(page, `ph-${ask}-0`)).toBeVisible()
    await expect(canvasNode(page, `ph-${ask}-1`)).toBeVisible()
    await closePanel(page)

    // 7) Condição dentro da branch "Sim".
    await fitView(page)
    const cond = await insertStep(page, branchPlaceholder(page, ask, 0), 'Condição')
    panel = configPanel(page)
    await expect(panel.getByText('quando nenhuma')).toBeVisible()
    await panel.getByPlaceholder('Nome da branch').nth(0).fill('Urgente')
    await panel.locator('select').nth(0).selectOption({ label: 'é igual a' })
    await panel.getByPlaceholder('Valor (ex.: Confirmar Presença)').nth(0).fill('urgente')
    await panel.getByRole('button', { name: 'Adicionar branch' }).click()
    await panel.getByPlaceholder('Nome da branch').nth(1).fill('Orçamento')
    await panel.getByPlaceholder('Valor (ex.: Confirmar Presença)').nth(1).fill('orçamento')
    await saveAction(page)
    await expect(canvasNode(page, cond)).toContainText('é igual a "urgente"')
    await closePanel(page)

    // 8) Encerrar na branch "Não".
    await fitView(page)
    const end = await insertStep(page, branchPlaceholder(page, ask, 1), 'Encerrar (End)')
    await expect(canvasNode(page, end)).toHaveClass(/react-flow__node-end/)
    await expect(configPanel(page).getByText('Este passo encerra o fluxo para o contato.')).toBeVisible()
    await closePanel(page)

    await fitView(page)
    await dismissToasts(page)

    // ── Canvas ────────────────────────────────────────────────────────────────
    for (const id of [wa, wait, tag, tagRm, pipe, ask, cond, end]) await expect(canvasNode(page, id)).toBeVisible()
    for (const label of ['Sim', 'Não', 'Urgente', 'Orçamento', 'None']) {
      await expect(page.locator('.react-flow__edgelabel-renderer').getByText(label, { exact: true })).toBeVisible()
    }
    // Branches vazias da condição viram placeholders.
    await expect(canvasNode(page, `ph-${cond}-0`)).toBeVisible()
    await expect(canvasNode(page, `ph-${cond}-2`)).toBeVisible()
    expect(overlappingPairs(await nodeBoxes(page))).toEqual([])
    await shot(page, '03-fluxo-completo-canvas')

    // ── PATCH final ─────────────────────────────────────────────────────────
    const body = await lastSavedBody(page, backend, 8)
    expect(backend.callsTo('PATCH', new RegExp(WF)).at(-1)?.status).toBe(200)

    // Árvore: cadeia wa → wait → tag → tagRm → pipe → ask; branches do ask.
    const t = body.tree
    expect(t.root?.id).toBe(wa)
    expect(findInTree(t.root, wa)?.next?.id).toBe(wait)
    expect(findInTree(t.root, wait)?.next?.id).toBe(tag)
    expect(findInTree(t.root, tag)?.next?.id).toBe(tagRm)
    expect(findInTree(t.root, tagRm)?.next?.id).toBe(pipe)
    expect(findInTree(t.root, pipe)?.next?.id).toBe(ask)
    const askStep = findInTree(t.root, ask)!
    expect(askStep.config).toMatchObject({ message: 'Quer falar com um atendente?' })
    expect(askStep.branches?.map((b) => b.label)).toEqual(['Sim', 'Não'])
    expect(askStep.branches?.[0].child?.id).toBe(cond)
    expect(askStep.branches?.[1].child?.id).toBe(end)
    const condStep = findInTree(t.root, cond)!
    expect(condStep.branches?.map((b) => [b.label, b.operator ?? null, b.value ?? null, !!b.locked])).toEqual([
      ['Urgente', 'equals', 'urgente', false],
      ['Orçamento', 'contains', 'orçamento', false],
      ['None', null, null, true],
    ])
    expect(findInTree(t.root, wa)?.config).toMatchObject({ template: 'boas_vindas', templateLanguage: 'pt_BR', templateBodyParams: ['{{var.nome}}'] })
    expect(findInTree(t.root, wait)?.config).toMatchObject({ mode: 'duration', unit: 'minutes', value: 5 })
    expect(findInTree(t.root, tag)?.config).toMatchObject({ tags: ['vip', 'lead-quente'] })
    expect(findInTree(t.root, tagRm)?.config).toMatchObject({ tags: ['frio'] })
    expect(findInTree(t.root, pipe)?.config).toMatchObject({
      pipelineId: 'pipe-vendas',
      pipelineName: 'Vendas',
      stageId: 'stage-proposta',
      stageName: 'Proposta enviada',
      oppStatus: 'won',
    })

    // Grafo salvo == compileFlow(árvore salva) (nada de grafo velho).
    const expected = compileFlow(t)
    expect(body.nodes).toEqual(expected.nodes)
    expect(body.edges).toEqual(expected.edges)

    // Ações reais do executor.
    const byId = new Map(body.nodes.map((n) => [n.id, n]))
    expect(byId.get(wa)?.data.config).toMatchObject({ actionType: 'whatsapp/send-template', templateName: 'boas_vindas' })
    expect(byId.get(wait)?.data.config).toEqual({ actionType: 'Delay', delayMs: 300_000 })
    expect(byId.get(tag)?.data.config).toMatchObject({ actionType: 'contacts/add-tag', tags: ['vip', 'lead-quente'] })
    expect(byId.get(tagRm)?.data.config).toMatchObject({ actionType: 'contacts/remove-tag', tags: ['frio'] })
    expect(byId.get(pipe)?.data.config).toMatchObject({ actionType: 'crm/move-pipeline', pipelineId: 'pipe-vendas', stageId: 'stage-proposta', oppStatus: 'won' })
    expect(byId.get(ask)?.data.config).toMatchObject({ actionType: 'whatsapp/ask-question', variableKey: `reply_${ask}` })
    for (const id of [`${ask}__var`, `${ask}__cond_0`, `${ask}__cond_1`, `${ask}__cond_else`, `${cond}__cond_0`, `${cond}__cond_1`, `${cond}__cond_none`]) {
      expect(byId.has(id), `nó compilado ${id}`).toBe(true)
    }
    // END não vira nó; a branch "Não" termina sem saída.
    expect(byId.has(end)).toBe(false)
    expect(body.edges.some((e) => e.source === `${ask}__cond_1`)).toBe(false)
    // Arestas principais da cadeia.
    const edgeSet = new Set(body.edges.map((e) => `${e.source}->${e.target}`))
    for (const pair of [`__trigger->${wa}`, `${wa}->${wait}`, `${wait}->${tag}`, `${tag}->${tagRm}`, `${tagRm}->${pipe}`, `${pipe}->${ask}`, `${ask}->${ask}__var`, `${ask}__cond_0->${cond}__cond_0`]) {
      expect(edgeSet.has(pair), `aresta ${pair}`).toBe(true)
    }
    // Toda aresta aponta para nós existentes.
    for (const e of body.edges) {
      expect(byId.has(e.source) && byId.has(e.target), `aresta órfã ${e.id}`).toBe(true)
    }
  })

  // toast-covers-panel: passo novo vazio não dispara mais toast de rascunho — a
  // pendência aparece no header ("N pendências") e no card.
  test('"Salvar ação" fica clicável logo depois de inserir um passo (toast não cobre o rodapé do painel)', async ({ page }) => {
    await openBuilder(page, WF)
    await insertStep(page, plusRoot(page), 'WhatsApp')
    const save = configPanel(page).getByRole('button', { name: 'Salvar ação' })
    await expect(save).toBeVisible()
    await page.waitForTimeout(400)
    await expect(page.locator('header').getByRole('button', { name: /pendência/ })).toBeVisible()
    await shot(page, '03-passo-novo-sem-toast')
    const covered = await save.evaluate((el) => {
      const r = el.getBoundingClientRect()
      const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
      return hit ? !el.contains(hit) : true
    })
    expect(covered, '"Salvar ação" está coberto pelo toast').toBe(false)
  })

  // condition-subtitle-en: o card da Condição usa o mesmo rótulo pt-BR do painel.
  test('subtítulo do card de Condição fica em pt-BR ("Mensagem recebida")', async ({ page }) => {
    await openBuilder(page, WF)
    const cond = await insertStep(page, plusRoot(page), 'Condição')
    await configPanel(page).getByPlaceholder('Valor (ex.: Confirmar Presença)').nth(0).fill('sim')
    await saveAction(page)
    await expect(canvasNode(page, cond)).toContainText('"sim"')
    await shot(page, '03-subtitulo-condicao-pt-br')
    expect(await nodeText(page, cond)).toContain('Mensagem recebida')
  })

  // ask-no-buttons (motor): o nó compilado do Perguntar leva os rótulos dos botões.
  test('Perguntar leva os botões configurados para o nó que vai ao WhatsApp', async ({ page, backend }) => {
    await openBuilder(page, WF)
    const ask = await insertStep(page, plusRoot(page), 'Perguntar')
    const panel = configPanel(page)
    await panel.getByPlaceholder('Texto da pergunta enviada ao contato...').fill('Confirma presença?')
    await panel.locator('input[maxlength="20"]').nth(0).fill('Confirmo')
    await panel.getByRole('button', { name: /Adicionar botão/ }).click()
    await panel.locator('input[maxlength="20"]').nth(1).fill('Não vou')
    await saveAction(page)
    await expect(canvasNode(page, ask)).toContainText('2 botões interativos')
    const body = await lastSavedBody(page, backend, 2)
    const askNode = body.nodes.find((n) => n.id === ask)!
    expect(askNode.data.config).toMatchObject({ actionType: 'whatsapp/ask-question', message: 'Confirma presença?' })
    const sent = JSON.stringify(askNode.data.config)
    expect(sent, 'rótulos dos botões não chegam ao passo que envia a pergunta').toContain('Confirmo')
    expect(sent).toContain('Não vou')
  })

  // template-language: o select guarda nome + idioma e o compile envia o idioma.
  test('template em en_US compila com o idioma do template', async ({ page, backend }) => {
    backend.templates.push({ id: 'tpl-en', name: 'order_update', language: 'en_US', category: 'UTILITY', status: 'APPROVED', content: 'Your order has shipped', preview: 'Your order has shipped', lastUpdated: '2026-10-01T00:00:00.000Z' })
    await openBuilder(page, WF)
    const wa = await insertStep(page, plusRoot(page), 'WhatsApp')
    await configPanel(page).locator('select').selectOption({ label: 'order_update (en_US) - UTILIDADE' })
    await saveAction(page)
    await expect(canvasNode(page, wa)).toContainText('order_update')
    const body = await lastSavedBody(page, backend, 2)
    expect(body.nodes.find((n) => n.id === wa)?.data.config).toMatchObject({ actionType: 'whatsapp/send-template', templateName: 'order_update', language: 'en_US' })
  })

  // template-params: template com {{1}} mostra o campo da variável e o compile
  // manda bodyParams.
  test('template com {{1}} permite preencher o parâmetro e o envia no nó compilado', async ({ page, backend }) => {
    await openBuilder(page, WF)
    const wa = await insertStep(page, plusRoot(page), 'WhatsApp')
    await configPanel(page).locator('select').selectOption({ label: 'boas_vindas (pt_BR) - MARKETING' })
    await shot(page, '03-template-com-parametros')
    // Algum campo para o {{1}} (qualquer rótulo que cite a variável).
    const paramField = configPanel(page).getByRole('textbox', { name: /\{\{1\}\}|parâmetro|variável/i })
    await expect(paramField, 'painel não oferece campo para {{1}}').toHaveCount(1, { timeout: 3000 })
    await paramField.fill('{{var.nome}}')
    await saveAction(page)
    const body = await lastSavedBody(page, backend, 2)
    expect(body.nodes.find((n) => n.id === wa)?.data.config).toHaveProperty('bodyParams')
  })

  // no-continuation-slot: Perguntar no fim do fluxo ganha o "+" da continuação
  // (por onde seguem as respostas fora dos botões) abaixo do bloco de opções.
  test('Perguntar no fim da cadeia tem "+" para a continuação do fluxo', async ({ page, backend }) => {
    await openBuilder(page, WF)
    const ask = await insertStep(page, plusRoot(page), 'Perguntar')
    await closePanel(page)
    await expect(canvasNode(page, `ph-${ask}-0`)).toBeVisible()
    const cont = canvasNode(page, `plus-after-${ask}`)
    await expect(cont).toBeVisible()
    await expect(cont).toContainText('Continuação (outras respostas)')
    await shot(page, '03-perguntar-com-continuacao')
    const tag = await insertStep(page, cont.getByRole('button'), 'Adicionar tag')
    const body = await lastSavedBody(page, backend, 2)
    expect(body.tree.root?.id).toBe(ask)
    expect(body.tree.root?.next?.id).toBe(tag)
  })

  test('terminal (End) só é oferecido em ponta aberta: some do picker no meio da cadeia', async ({ page }) => {
    await openBuilder(page, WF)
    const a = await insertStep(page, plusRoot(page), 'Aguardar')
    await closePanel(page)
    // "+" da raiz agora fica entre o trigger e um passo existente (slot com cauda).
    await page.getByRole('button', { name: 'Inserir ação aqui' }).first().click()
    await expect(actionPicker(page)).toBeVisible()
    await expect(pickerItem(page, 'Encerrar (End)')).toHaveCount(0)
    await expect(pickerItem(page, 'Ir para (Go To)')).toHaveCount(0)
    await page.keyboard.press('Escape')
    // Na folha o End aparece.
    await plusLeafAfter(page, a).click()
    await expect(pickerItem(page, 'Encerrar (End)')).toHaveCount(1)
    await page.keyboard.press('Escape')
  })
})
