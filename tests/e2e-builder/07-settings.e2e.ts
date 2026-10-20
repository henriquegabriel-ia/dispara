// Cenário 7 — Configurações do workflow (WorkflowSettingsSheet).

import type { Page } from '@playwright/test'
import { expect, openBuilder, shot, test, toastWith } from '@/tests/e2e-builder/fixtures'
import { compiled, twoMessagesTree } from '@/tests/e2e-builder/trees'

const WF = 'wf-settings'

const sheet = (page: Page) => page.locator('div.absolute.inset-0.z-50').filter({ hasText: 'Configurações do workflow' })
const toggle = (page: Page, label: string) => sheet(page).getByRole('switch', { name: new RegExp(label) })

async function openSheet(page: Page) {
  await page.locator('header').getByTitle('Configurações do workflow').click()
  await expect(sheet(page)).toBeVisible()
}

test.describe('Configurações do workflow', () => {
  test.beforeEach(async ({ backend }) => {
    const tree = twoMessagesTree(WF)
    backend.seedWorkflow({
      id: WF,
      name: 'Fluxo com settings',
      tree,
      ...compiled(tree),
      settings: {
        allowReentry: false,
        stopOnResponse: true,
        timeWindow: { enabled: true, start: '08:00', end: '20:00', days: [1, 2, 3] },
      },
    })
  })

  test('abre com os valores salvos; Cancelar e o fundo fecham sem salvar', async ({ page, backend }) => {
    await openBuilder(page, WF)
    await openSheet(page)
    await expect(toggle(page, 'Permitir reentrada')).toHaveAttribute('aria-checked', 'false')
    await expect(toggle(page, 'Parar ao responder')).toHaveAttribute('aria-checked', 'true')
    await expect(toggle(page, 'Janela de horário')).toHaveAttribute('aria-checked', 'true')
    const times = sheet(page).locator('input[type="time"]')
    await expect(times.nth(0)).toHaveValue('08:00')
    await expect(times.nth(1)).toHaveValue('20:00')
    for (const [day, active] of [['Seg', true], ['Ter', true], ['Qua', true], ['Qui', false], ['Dom', false]] as const) {
      await expect(sheet(page).getByRole('button', { name: day, exact: true })).toHaveClass(active ? /bg-primary-500/ : /border-border/)
    }
    await expect(sheet(page).getByText('Fuso: America/Sao_Paulo')).toBeVisible()
    await shot(page, '07-settings-aberto')

    await toggle(page, 'Permitir reentrada').click()
    await sheet(page).getByRole('button', { name: 'Cancelar' }).click()
    await expect(sheet(page)).toBeHidden()
    await openSheet(page)
    await expect(toggle(page, 'Permitir reentrada')).toHaveAttribute('aria-checked', 'false')
    await page.getByRole('button', { name: 'Fechar configurações' }).click({ position: { x: 10, y: 10 } })
    await expect(sheet(page)).toBeHidden()
    expect(backend.patchesFor(WF)).toHaveLength(0)
  })

  test('janela ativa sem nenhum dia é barrada no cliente', async ({ page, backend }) => {
    await openBuilder(page, WF)
    await openSheet(page)
    for (const day of ['Seg', 'Ter', 'Qua']) await sheet(page).getByRole('button', { name: day, exact: true }).click()
    await sheet(page).getByRole('button', { name: 'Salvar configurações' }).click()
    await expect(toastWith(page, 'Selecione pelo menos um dia da semana para a janela')).toBeVisible()
    await expect(sheet(page)).toBeVisible()
    expect(backend.patchesFor(WF)).toHaveLength(0)
  })

  test('o PATCH de settings leva só { settings } com os valores do formulário', async ({ page, backend }) => {
    await openBuilder(page, WF)
    await openSheet(page)
    await toggle(page, 'Permitir reentrada').click()
    await toggle(page, 'Parar ao responder').click()
    await sheet(page).locator('input[type="time"]').nth(0).fill('09:30')
    await sheet(page).getByRole('button', { name: 'Qui', exact: true }).click()
    await sheet(page).getByRole('button', { name: 'Salvar configurações' }).click()

    await expect.poll(() => backend.patchesFor(WF).length).toBe(1)
    expect(backend.lastPatch(WF)).toEqual({
      settings: {
        allowReentry: true,
        stopOnResponse: false,
        timeWindow: { enabled: true, start: '09:30', end: '20:00', days: [1, 2, 3, 4] },
      },
    })
  })

  // settings-save-400: PATCH só com { settings } é aceito e não toca no grafo.
  test('salvar configurações persiste, fecha a sheet e reabre com os valores novos', async ({ page, backend }) => {
    await openBuilder(page, WF)
    await openSheet(page)
    await toggle(page, 'Permitir reentrada').click()
    await toggle(page, 'Janela de horário').click()
    await sheet(page).getByRole('button', { name: 'Salvar configurações' }).click()

    await expect.poll(() => backend.patchesFor(WF).length).toBe(1)
    await shot(page, '07-salvar-configuracoes')
    expect(backend.callsTo('PATCH', new RegExp(WF)).at(-1)?.status, 'PATCH de settings recusado pelo servidor').toBe(200)
    await expect(toastWith(page, 'Configurações salvas')).toBeVisible({ timeout: 3000 })
    await expect(sheet(page)).toBeHidden()
    expect(backend.workflows.get(WF)?.settings).toMatchObject({ allowReentry: true, timeWindow: { enabled: false } })
    // O grafo não pode ter sido apagado.
    expect(backend.activeVersion(WF).nodes.length).toBeGreaterThan(1)
    await openSheet(page)
    await expect(toggle(page, 'Permitir reentrada')).toHaveAttribute('aria-checked', 'true')
  })
})
