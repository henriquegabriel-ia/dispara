// Cenário 8 — Canvas: zoom, sobreposição, temas escuro/claro, larguras 1440/390
// e a sidebar "cortada" do print do usuário.

import type { Page } from '@playwright/test'
import {
  configPanel,
  expect,
  fitView,
  nodeBoxes,
  openBuilder,
  overlappingPairs,
  shot,
  test,
  triggerNode,
} from '@/tests/e2e-builder/fixtures'
import { branchedTree, compiled } from '@/tests/e2e-builder/trees'

const WF = 'wf-canvas'
const LONG_NAME = 'Fluxo ramificado de boas-vindas com nome comprido'

function seed(backend: import('@/tests/e2e-builder/fake-backend').FakeBackend) {
  const tree = branchedTree(WF)
  backend.seedWorkflow({ id: WF, name: LONG_NAME, tree, ...compiled(tree) })
}

async function zoomPercent(page: Page): Promise<number> {
  const text = await page.locator('.react-flow__panel').filter({ hasText: /^\d+%$/ }).innerText()
  return Number(text.replace('%', ''))
}

/** Luminância relativa (0..1) de uma cor rgb()/rgba() computada. */
function luminance(rgb: string): number {
  const [r, g, b] = (rgb.match(/[\d.]+/g) ?? ['0', '0', '0']).slice(0, 3).map(Number).map((c) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

test.describe('Canvas', () => {
  test.beforeEach(async ({ backend }) => seed(backend))

  test('zoom +/−/fit e indicador de %', async ({ page }) => {
    await openBuilder(page, WF)
    const onLoad = await zoomPercent(page)
    expect(onLoad).toBeGreaterThan(20)
    expect(onLoad).toBeLessThanOrEqual(90) // fitView maxZoom 0.9
    // O fit do mount roda enquanto a sidebar ainda está deslizando (BUG
    // sidebar-load-slide) — a referência é o fit com o layout já estável.
    await fitView(page)
    const initial = await zoomPercent(page)

    await page.locator('.react-flow__controls-zoomin').click()
    await expect.poll(() => zoomPercent(page)).toBeGreaterThan(initial)
    const zoomedIn = await zoomPercent(page)
    await page.locator('.react-flow__controls-zoomout').click()
    await page.locator('.react-flow__controls-zoomout').click()
    await expect.poll(() => zoomPercent(page)).toBeLessThan(zoomedIn)
    await expect.poll(() => zoomPercent(page)).toBeLessThan(initial)

    await fitView(page)
    await expect.poll(() => zoomPercent(page)).toBe(initial)
    // Scroll do mouse também dá zoom.
    await page.mouse.move(800, 500)
    await page.mouse.wheel(0, -400)
    await expect.poll(() => zoomPercent(page)).toBeGreaterThan(initial)
    await shot(page, '08-zoom')
  })

  test('nós, pills de branch e botões "+" não se sobrepõem (fit view)', async ({ page }) => {
    await openBuilder(page, WF)
    await fitView(page)
    const nodes = await nodeBoxes(page)
    expect(nodes.length).toBeGreaterThanOrEqual(12)
    expect(overlappingPairs(nodes)).toEqual([])

    // Pills/“+” das edges (EdgeLabelRenderer) não podem cair em cima de nós.
    const labels = await page.locator('.react-flow__edgelabel-renderer > div').evaluateAll((els) =>
      els.map((el, i) => {
        const r = el.getBoundingClientRect()
        return { id: `label${i}:${(el.textContent || '+').trim()}`, x: r.x, y: r.y, w: r.width, h: r.height }
      })
    )
    const clashes: string[] = []
    for (const label of labels) {
      for (const pair of overlappingPairs([label, ...nodes])) if (pair.startsWith(label.id)) clashes.push(pair)
    }
    expect(clashes).toEqual([])
    await shot(page, '08-sem-sobreposicao')
  })

  for (const theme of ['dark', 'light'] as const) {
    for (const width of [1440, 390] as const) {
      test.describe(`tema ${theme} @ ${width}px`, () => {
        test.use({ theme, viewport: { width, height: width === 390 ? 844 : 900 } })

        test(`renderiza o builder (${theme}, ${width})`, async ({ page }) => {
          await openBuilder(page, WF)
          await expect(page.locator('html')).toHaveAttribute('data-eia-theme', theme)
          await expect(page.locator('.react-flow')).toHaveClass(new RegExp(`\\b${theme}\\b`))
          const bg = await page.locator('.dispara-canvas').evaluate((el) => getComputedStyle(el).backgroundColor)
          if (theme === 'dark') expect(luminance(bg)).toBeLessThan(0.1)
          else expect(luminance(bg)).toBeGreaterThan(0.7)
          // Texto do card legível contra o fundo do card.
          const contrast = await page.locator('.react-flow__node[data-id="welcome"] .step-card').evaluate((el) => {
            const title = el.querySelector('.truncate') as HTMLElement
            return { bg: getComputedStyle(el).backgroundColor, fg: getComputedStyle(title).color }
          })
          const [l1, l2] = [luminance(contrast.bg), luminance(contrast.fg)].sort((a, b) => b - a)
          expect((l1 + 0.05) / (l2 + 0.05)).toBeGreaterThan(4.5)

          expect(overlappingPairs(await nodeBoxes(page))).toEqual([])
          await shot(page, `08-${theme}-${width}-canvas`)

          await triggerNode(page).click()
          await expect(configPanel(page).getByText('Gatilho do fluxo')).toBeVisible()
          await page.waitForTimeout(400) // transição do painel
          await shot(page, `08-${theme}-${width}-painel-gatilho`)

          if (width === 1440) {
            const panel = (await configPanel(page).boundingBox())!
            expect(panel.x + panel.width).toBeLessThanOrEqual(width + 1)
            const publish = (await page.locator('header').getByRole('button', { name: 'Publicar' }).boundingBox())!
            expect(publish.x + publish.width).toBeLessThanOrEqual(width)
          }
        })
      })
    }
  }

  test.describe('390px (mobile)', () => {
    test.use({ viewport: { width: 390, height: 844 } })

    // mobile-builder: em 390px os textos secundários do header viram ícones, o nome
    // encolhe sem sumir, "Publicar" cabe e o painel ocupa a largura da tela.
    test('header com nome e "Publicar" visíveis e painel dentro da tela', async ({ page }) => {
      await openBuilder(page, WF)
      await shot(page, '08-mobile-header')
      const publish = (await page.locator('header').getByRole('button', { name: 'Publicar' }).boundingBox())!
      expect(publish.x + publish.width, '"Publicar" fora da tela').toBeLessThanOrEqual(390)
      const name = (await page.locator('header').getByText(LONG_NAME).boundingBox())!
      expect(name.width, 'nome do fluxo invisível').toBeGreaterThan(40)
      await triggerNode(page).click({ force: true })
      await page.waitForTimeout(400)
      const panel = (await configPanel(page).boundingBox())!
      expect(panel.x, 'painel sai pela esquerda').toBeGreaterThanOrEqual(0)
    })
  })
})

test.describe('Sidebar do dashboard no builder (print do usuário)', () => {
  test.use({ viewport: { width: 1591, height: 855 } })
  test.beforeEach(async ({ backend }) => seed(backend))

  test('depois de carregar, a sidebar fica inteira (x=0) e não há scroll horizontal — com o painel do gatilho aberto e digitando', async ({ page }) => {
    await openBuilder(page, WF)
    await page.waitForTimeout(800)
    await triggerNode(page).click()
    const textarea = configPanel(page).locator('textarea')
    await textarea.click()
    await textarea.pressSequentially('\nnova')
    await page.waitForTimeout(400)
    const layout = await page.evaluate(() => {
      const aside = document.querySelector('aside[aria-label="Menu de navegação expandido"]')!.getBoundingClientRect()
      const header = document.querySelector('header')!.getBoundingClientRect()
      const scrolled = [...document.querySelectorAll('*')].filter((el) => el.scrollLeft > 0).map((el) => el.tagName)
      return {
        asideX: aside.x,
        asideW: aside.width,
        headerX: header.x,
        overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        scrolled,
      }
    })
    await shot(page, '08-sidebar-estavel-1591x855')
    expect(layout).toEqual({ asideX: 0, asideW: 224, headerX: 224, overflowX: 0, scrolled: [] })
  })

  // sidebar-load-slide: expandida é o padrão do SSR, a preferência salva é lida antes
  // da pintura e as transições só ligam depois — nada desliza na carga.
  test('a sidebar não desliza nem empurra o conteúdo ao carregar a página', async ({ page }) => {
    await page.addInitScript(() => {
      const samples: Array<{ t: number; asideX: number | null; visible: boolean; headerX: number | null }> = []
      ;(window as unknown as { __samples: typeof samples }).__samples = samples
      const t0 = performance.now()
      const tick = () => {
        const aside = document.querySelector('aside[aria-label="Menu de navegação expandido"]')
        const header = document.querySelector('header')
        samples.push({
          t: Math.round(performance.now() - t0),
          asideX: aside ? Math.round(aside.getBoundingClientRect().x) : null,
          visible: aside ? getComputedStyle(aside).visibility === 'visible' : false,
          headerX: header ? Math.round(header.getBoundingClientRect().x) : null,
        })
        if (performance.now() - t0 < 6000) requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    })
    await openBuilder(page, WF)
    await page.waitForTimeout(2500)
    const samples = await page.evaluate(
      () => (window as unknown as { __samples: Array<{ t: number; asideX: number | null; visible: boolean; headerX: number | null }> }).__samples
    )
    const midSlide = samples.filter((s) => s.visible && s.asideX !== null && s.asideX < 0 && s.asideX > -224)
    const headerPositions = [...new Set(samples.filter((s) => s.headerX !== null && s.headerX > 0).map((s) => s.headerX))]
    await test.info().attach('sidebar-samples', { body: JSON.stringify(samples), contentType: 'application/json' })
    expect(midSlide, `quadros com a sidebar cortada: ${JSON.stringify(midSlide.slice(0, 5))}`).toEqual([])
    expect(headerPositions, 'o header mudou de posição durante o carregamento').toHaveLength(1)
  })
})
