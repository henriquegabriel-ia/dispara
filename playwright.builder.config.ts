import path from 'node:path'
import { defineConfig, devices } from '@playwright/test'
import {
  ARTIFACTS_DIR,
  BASE_URL,
  FAKE_SUPABASE_PORT,
  NEXT_PORT,
  fakeSupabaseEnv,
  nextDevEnv,
} from '@/tests/e2e-builder/env'

/**
 * E2E da TELA do builder de workflows (/workflows e /builder/[id]) num chromium
 * de verdade, SEM banco: `npm run test:e2e:builder`.
 *
 * Diferente do playwright.config.ts (que carrega .env.local / senha mestra):
 *   - sobe um Supabase FALSO local (tests/e2e-builder/fake-supabase.mjs) só para
 *     o proxy.ts validar a sessão de teste;
 *   - sobe `next dev` na porta 3100 com env de TESTE (segredos gerados a cada
 *     execução em tests/e2e-builder/env.ts — nada vai para arquivo versionado);
 *   - TODAS as chamadas do browser para /api/** são respondidas por um backend
 *     falso com estado (tests/e2e-builder/fake-backend.ts) via page.route, e o
 *     websocket do Realtime é simulado com page.routeWebSocket. Nenhuma requisição
 *     sai para o Supabase real nem para graph.facebook.com.
 *
 * Artefatos (screenshots, logs, relatório): E2E_BUILDER_ARTIFACTS_DIR
 * (padrão: <tmp>/dispara-builder-e2e).
 */
export default defineConfig({
  testDir: './tests/e2e-builder',
  // Sufixo .e2e.ts (e não .spec.ts): o include padrão do Vitest pega
  // **/*.spec.ts e o exclude dele só cobre **/e2e/** — com .spec.ts o `npm test`
  // tentaria rodar estes arquivos do Playwright.
  testMatch: /.*\.e2e\.ts$/,
  outputDir: path.join(ARTIFACTS_DIR, 'test-results'),
  globalSetup: './tests/e2e-builder/global-setup.ts',

  // Um next dev só: execução serial e determinística.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,

  // A primeira compilação do Turbopack é lenta no Windows.
  timeout: 180_000,
  expect: { timeout: 15_000 },

  reporter: [
    ['list'],
    ['json', { outputFile: path.join(ARTIFACTS_DIR, 'report.json') }],
  ],

  use: {
    baseURL: BASE_URL,
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    // page.route não intercepta o que passa por service worker.
    serviceWorkers: 'block',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    actionTimeout: 15_000,
    navigationTimeout: 120_000,
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
  ],

  webServer: [
    {
      command: 'node tests/e2e-builder/fake-supabase.mjs',
      url: `http://127.0.0.1:${FAKE_SUPABASE_PORT}/__health`,
      env: fakeSupabaseEnv(),
      reuseExistingServer: false,
      timeout: 30_000,
      stdout: 'pipe',
    },
    {
      // Os segredos mudam a cada execução, então um next dev já de pé na 3100 só
      // serve se tiver subido com os MESMOS E2E_BUILDER_* (exporte-os e use
      // E2E_BUILDER_REUSE_SERVER=1). O global-setup falha cedo se o servidor
      // encontrado não aceitar a sessão de teste. Nunca reaproveite o next dev do
      // dia a dia: ele aponta para o Supabase real.
      command: `npx next dev --turbopack -p ${NEXT_PORT}`,
      port: NEXT_PORT,
      env: nextDevEnv(),
      reuseExistingServer: process.env.E2E_BUILDER_REUSE_SERVER === '1',
      timeout: 240_000,
      stdout: 'pipe',
    },
  ],
})
