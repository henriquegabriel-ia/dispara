// Fixtures do E2E do builder: sessão de teste, backend falso (/api/**), Realtime
// simulado, bloqueio de rede externa e coleta de erros do console.

import { appendFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { expect, test as base, type Locator, type Page } from '@playwright/test'
import {
  ARTIFACTS_DIR,
  BASE_URL,
  SCREENSHOTS_DIR,
  SESSION_COOKIE_NAME,
  SESSION_TOKEN,
} from '@/tests/e2e-builder/env'
import { FakeBackend } from '@/tests/e2e-builder/fake-backend'

export type ThemeName = 'dark' | 'light'

export interface ConsoleEntry {
  type: string
  text: string
  url: string
}

interface BuilderFixtures {
  backend: FakeBackend
  /** console.error + pageerror da página (deve terminar vazio). */
  consoleErrors: ConsoleEntry[]
  /** requisições que tentaram sair de localhost (bloqueadas). */
  externalRequests: string[]
  /** tema gravado no localStorage ANTES de carregar a página. */
  theme: ThemeName
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

function isLocal(url: URL): boolean {
  return LOCAL_HOSTS.has(url.hostname) || url.protocol === 'data:' || url.protocol === 'blob:'
}

export const test = base.extend<BuilderFixtures>({
  theme: ['dark', { option: true }],

  backend: async ({}, use) => {
    await use(new FakeBackend())
  },

  externalRequests: async ({}, use) => {
    await use([])
  },

  consoleErrors: async ({}, use) => {
    await use([])
  },

  page: async ({ page, context, backend, externalRequests, consoleErrors, theme }, use, testInfo) => {
    await context.addCookies([
      {
        name: SESSION_COOKIE_NAME,
        value: SESSION_TOKEN,
        url: BASE_URL,
        httpOnly: true,
        sameSite: 'Lax',
      },
    ])

    // Nada sai de localhost (Supabase real, graph.facebook.com, telemetria...).
    await context.route(
      (url) => !isLocal(url),
      (route) => {
        externalRequests.push(`${route.request().method()} ${route.request().url()}`)
        return route.abort('blockedbyclient')
      }
    )

    // Realtime (Phoenix) simulado: responde join/heartbeat com ok e não emite eventos.
    await page.routeWebSocket(/\/realtime\/v1\/websocket/, (ws) => {
      ws.onMessage((message) => {
        const text = typeof message === 'string' ? message : message.toString('utf8')
        let parsed: unknown
        try {
          parsed = JSON.parse(text)
        } catch {
          return
        }
        if (Array.isArray(parsed)) {
          const [joinRef, ref, topic] = parsed as [string | null, string | null, string, string]
          ws.send(JSON.stringify([joinRef, ref, topic, 'phx_reply', { status: 'ok', response: {} }]))
        } else if (parsed && typeof parsed === 'object') {
          const msg = parsed as { topic?: string; ref?: string; join_ref?: string }
          ws.send(
            JSON.stringify({
              topic: msg.topic,
              event: 'phx_reply',
              payload: { status: 'ok', response: {} },
              ref: msg.ref,
              join_ref: msg.join_ref,
            })
          )
        }
      })
    })

    await backend.attach(page)

    await page.addInitScript((themeName: string) => {
      try {
        window.localStorage.setItem('empreende-ia-theme', themeName)
        window.localStorage.setItem('dispara_onboarding_dismissed', '1')
      } catch {
        // storage indisponível: segue com o padrão do app
      }
    }, theme)

    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push({ type: 'console.error', text: msg.text(), url: msg.location()?.url ?? '' })
      }
    })
    page.on('pageerror', (error) => {
      consoleErrors.push({ type: 'pageerror', text: `${error.name}: ${error.message}`, url: page.url() })
    })

    await use(page)

    // Registro por teste (o teste dedicado de console é que reprova).
    const report = {
      test: testInfo.titlePath.slice(1).join(' › '),
      consoleErrors,
      externalRequests,
      unhandledApi: backend.unhandled,
    }
    if (consoleErrors.length || externalRequests.length || backend.unhandled.length) {
      mkdirSync(ARTIFACTS_DIR, { recursive: true })
      appendFileSync(path.join(ARTIFACTS_DIR, 'browser-issues.jsonl'), `${JSON.stringify(report)}\n`)
    }
    await testInfo.attach('browser-issues', { body: JSON.stringify(report, null, 2), contentType: 'application/json' })
  },
})

export { expect }

// ─── Helpers ─────────────────────────────────────────────────────────────────

export async function shot(page: Page, name: string, opts: { fullPage?: boolean } = {}): Promise<string> {
  mkdirSync(SCREENSHOTS_DIR, { recursive: true })
  const file = path.join(SCREENSHOTS_DIR, `${name}.png`)
  await page.screenshot({ path: file, fullPage: opts.fullPage ?? false, animations: 'disabled' })
  return file
}

export function canvasNode(page: Page, id: string): Locator {
  return page.locator(`.react-flow__node[data-id="${id}"]`)
}

export function triggerNode(page: Page): Locator {
  return canvasNode(page, '__trigger')
}

/** Abre o builder e espera o canvas com o nó do gatilho. */
export async function openBuilder(page: Page, workflowId: string): Promise<void> {
  await page.goto(`/builder/${encodeURIComponent(workflowId)}`)
  await expect(triggerNode(page)).toBeVisible({ timeout: 120_000 })
  // React Flow mede os nós depois do primeiro paint; espera a viewport estabilizar.
  await expect(page.locator('.react-flow__viewport')).toBeVisible()
}

/** Painel lateral de configuração (ConfigPanel) — só a instância aberta. */
export function configPanel(page: Page): Locator {
  return page.locator('div.absolute.top-0.right-0.z-30.translate-x-0')
}

/** Popover do ActionPicker (o único div.fixed.z-50 com a busca de ações). */
export function actionPicker(page: Page): Locator {
  return page.locator('div.fixed.z-50').filter({ has: page.getByPlaceholder('Buscar ação...') })
}

export function pickerItem(page: Page, label: string): Locator {
  return actionPicker(page).getByRole('button', { name: new RegExp(`^${escapeRegExp(label)}`) })
}

/**
 * Abre o ActionPicker num "+" (folha, edge ou placeholder de branch), escolhe a
 * ação e devolve o id do passo criado (o builder seleciona o passo novo).
 */
export async function insertStep(page: Page, plus: Locator, label: string): Promise<string> {
  const before = new Set(await page.locator('.react-flow__node-step, .react-flow__node-end').evaluateAll((els) => els.map((e) => e.getAttribute('data-id'))))
  await plus.click()
  await expect(actionPicker(page)).toBeVisible()
  await pickerItem(page, label).click()
  await expect(actionPicker(page)).toBeHidden()
  const handle = page.locator('.react-flow__node-step, .react-flow__node-end')
  await expect
    .poll(async () => (await handle.evaluateAll((els) => els.map((e) => e.getAttribute('data-id')))).filter((id) => !before.has(id)).length)
    .toBe(1)
  const ids = await handle.evaluateAll((els) => els.map((e) => e.getAttribute('data-id') ?? ''))
  return ids.find((id) => !before.has(id))!
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Botão "fit view" dos controles do React Flow. */
export async function fitView(page: Page): Promise<void> {
  await page.locator('.react-flow__controls-fitview').click()
  // fitView anima ~0ms aqui, mas os nós podem estar em transição de re-layout.
  await page.waitForTimeout(400)
}

export async function closePanel(page: Page): Promise<void> {
  await configPanel(page).getByRole('button', { name: 'Fechar painel' }).click()
  await expect(configPanel(page)).toHaveCount(0)
}

/** Placeholder "+ Adicionar ação" de uma branch vazia. */
export function branchPlaceholder(page: Page, stepId: string, branchIndex: number): Locator {
  return canvasNode(page, `ph-${stepId}-${branchIndex}`).getByRole('button', { name: 'Adicionar ação' })
}

/**
 * "+" da edge entre dois nós (inserir no meio). Os botões vivem no
 * EdgeLabelRenderer (sem id): escolhe o que fica entre a base de `sourceId` e o
 * topo de `targetId`, alinhado com a coluna da origem.
 */
export async function edgePlusBetween(page: Page, sourceId: string, targetId: string): Promise<Locator> {
  const src = await canvasNode(page, sourceId).boundingBox()
  const tgt = await canvasNode(page, targetId).boundingBox()
  if (!src || !tgt) throw new Error(`nós ${sourceId}/${targetId} não visíveis`)
  const buttons = page.getByRole('button', { name: 'Inserir ação aqui' })
  const count = await buttons.count()
  for (let i = 0; i < count; i += 1) {
    const box = await buttons.nth(i).boundingBox()
    if (!box) continue
    const cx = box.x + box.width / 2
    const cy = box.y + box.height / 2
    const withinX = cx >= Math.min(src.x, tgt.x) && cx <= Math.max(src.x + src.width, tgt.x + tgt.width)
    if (withinX && cy >= src.y + src.height - 2 && cy <= tgt.y + 2) return buttons.nth(i)
  }
  throw new Error(`"+" entre ${sourceId} e ${targetId} não encontrado`)
}

/** Lê o texto (título + subtítulo) de um nó do canvas. */
export async function nodeText(page: Page, id: string): Promise<string> {
  return (await canvasNode(page, id).innerText()).replace(/\s+/g, ' ').trim()
}

/** "+" folha de um passo (fim de cadeia aberta). */
export function plusLeafAfter(page: Page, stepId: string): Locator {
  return canvasNode(page, `plus-${stepId}`).getByRole('button', { name: 'Adicionar ação' })
}

export function plusRoot(page: Page): Locator {
  return canvasNode(page, '__plus-root').getByRole('button', { name: 'Adicionar ação' })
}

/** Espera o indicador do header voltar a "Salvo". */
export async function waitSaved(page: Page): Promise<void> {
  await expect(page.locator('header').getByText('Salvo', { exact: true })).toBeVisible({ timeout: 20_000 })
}

/** Caixas (em px de tela) de todos os nós visíveis do canvas. */
export async function nodeBoxes(page: Page): Promise<Array<{ id: string; x: number; y: number; w: number; h: number }>> {
  return page.locator('.react-flow__node').evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect()
      return { id: el.getAttribute('data-id') ?? '', x: r.x, y: r.y, w: r.width, h: r.height }
    })
  )
}

export function overlappingPairs(
  boxes: Array<{ id: string; x: number; y: number; w: number; h: number }>
): string[] {
  const pairs: string[] = []
  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      const a = boxes[i]
      const b = boxes[j]
      const overlapX = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
      const overlapY = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
      if (overlapX > 1 && overlapY > 1) pairs.push(`${a.id} x ${b.id}`)
    }
  }
  return pairs
}

/** Toast do DS (região "Notificações"). */
export function toastWith(page: Page, text: string | RegExp): Locator {
  return page.getByRole('region', { name: 'Notificações' }).getByText(text)
}

/** Fecha os toasts abertos (eles cobrem o rodapé do ConfigPanel — ver BUG toast-covers-panel). */
export async function dismissToasts(page: Page): Promise<void> {
  const closes = page.getByRole('region', { name: 'Notificações' }).getByRole('button', { name: 'Fechar notificação' })
  for (let i = 0; i < 6; i += 1) {
    if ((await closes.count()) === 0) return
    await closes.first().click({ timeout: 2000 }).catch(() => undefined)
  }
}

/** Clica em "Salvar ação" do ConfigPanel (fecha toasts antes — eles cobrem o botão). */
export async function saveAction(page: Page): Promise<void> {
  await dismissToasts(page)
  await configPanel(page).getByRole('button', { name: 'Salvar ação' }).click()
}
