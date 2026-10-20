/**
 * Harness compartilhado dos testes do builder de workflows (gatilhos, passos e
 * automações: webhook → execute/resume, inscrição manual, waits drenados pelo cron).
 *
 * Tudo roda em memória: Supabase = tests/helpers/in-memory-supabase.ts (esquema do
 * Dispara), Graph API = tests/helpers/meta-send-mock.ts. Nada vai à rede.
 *
 * Cabeçalho típico de um teste que usa as ROTAS reais:
 * ```ts
 * // @vitest-environment node
 * import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
 *
 * vi.mock('server-only', () => ({}))
 * vi.mock('@/lib/supabase', async () =>
 *   (await import('@/tests/helpers/in-memory-supabase')).supabaseModuleMock())
 * vi.mock('@/lib/self-invoke', async () =>
 *   (await import('@/tests/helpers/workflow-harness')).selfInvokeModuleMock())
 * // (webhook) o inbox é best-effort e puxa o agente de IA — neutralize:
 * vi.mock('@/lib/inbox/inbox-webhook', () => ({
 *   handleInboundMessage: vi.fn(async () => ({ conversationId: null, messageId: null, triggeredAI: false })),
 *   handleDeliveryStatus: vi.fn(async () => {}),
 * }))
 *
 * import { setupWorkflowTest, teardownWorkflowTest, makeFlow, steps, triggers,
 *   publishFlow, routes, metaInbound, metaWebhookBody, flushSelfInvokes } from '@/tests/helpers/workflow-harness'
 *
 * let h: ReturnType<typeof setupWorkflowTest>
 * beforeEach(() => { h = setupWorkflowTest() })
 * afterEach(() => teardownWorkflowTest())
 * ```
 *
 * IMPORTANTE: este módulo NÃO pode importar (estaticamente) nada que importe
 * '@/lib/supabase' ou '@/lib/self-invoke' — ele é carregado dentro do vi.mock de
 * '@/lib/self-invoke'. As rotas são importadas sob demanda (import dinâmico).
 */

import { createHmac } from 'node:crypto'
import { vi } from 'vitest'
import { NextRequest } from 'next/server'
import { compileFlow, TRIGGER_NODE_ID, type CompiledWorkflow } from '@/lib/builder/flow/compile'
import type { Branch, Flow, FlowTrigger, Step } from '@/lib/builder/flow/types'
import { createNewVersion, createWorkflowRecord, fetchEditorRecord } from '@/lib/builder/workflow-db'
import { parseWorkflowSettings, type WorkflowSettings } from '@/lib/builder/workflow-settings'
import type { WorkflowEdge, WorkflowNode } from '@/lib/builder/graph-types'
import {
  createInMemorySupabase,
  DISPARA_SCHEMA,
  getActiveSupabase,
  setActiveSupabase,
  type InMemorySupabase,
  type InMemorySupabaseOptions,
  type Row,
} from '@/tests/helpers/in-memory-supabase'
import { createMetaSendMock, type MetaSendMock, type MetaSendMockOptions } from '@/tests/helpers/meta-send-mock'

// ─── Constantes de teste (todas FALSAS) ────────────────────────────────────────

export const TEST_COMPANY_ID = 'company-test'
export const TEST_CRON_SECRET = 'test-cron-secret'
export const TEST_ADMIN_KEY = 'test-admin-key'
export const TEST_API_KEY = 'test-api-key'

/** Credenciais WhatsApp FALSAS (gravadas em settings, como o onboarding faz). */
export const FAKE_WHATSAPP = {
  phoneNumberId: '100000000000001',
  businessAccountId: '200000000000002',
  accessToken: 'EAAG-test-token-NAO-E-REAL',
  displayPhoneNumber: '15550001111',
} as const

/** Telefones E.164 dos contatos semeados (celular BR com 9). */
export const TEST_PHONES = {
  ana: '+5511999990001',
  bruno: '+5511999990002',
  carla: '+5521988880003',
} as const

/** Ids semeados por defaultSeed(). */
export const SEED_IDS = {
  contacts: { ana: 'ct_ana', bruno: 'ct_bruno' },
  pipeline: 'pl_vendas',
  stages: { novo: 'pls_novo', proposta: 'pls_proposta' },
  campaign: 'c_promo',
} as const

// ─── Banco ─────────────────────────────────────────────────────────────────────

/** settings (credenciais falsas + company_id), contatos, pipeline/etapas e 1 campanha. */
export function defaultSeed(): Record<string, Row[]> {
  return {
    settings: [
      { key: 'company_id', value: TEST_COMPANY_ID },
      { key: 'phoneNumberId', value: FAKE_WHATSAPP.phoneNumberId },
      { key: 'businessAccountId', value: FAKE_WHATSAPP.businessAccountId },
      { key: 'accessToken', value: FAKE_WHATSAPP.accessToken },
      { key: 'isConnected', value: 'true' },
    ],
    contacts: [
      { id: SEED_IDS.contacts.ana, name: 'Ana', phone: TEST_PHONES.ana, tags: ['lead'] },
      { id: SEED_IDS.contacts.bruno, name: 'Bruno', phone: TEST_PHONES.bruno, tags: [] },
    ],
    pipelines: [{ id: SEED_IDS.pipeline, name: 'Vendas', position: 0 }],
    pipeline_stages: [
      { id: SEED_IDS.stages.novo, pipeline_id: SEED_IDS.pipeline, name: 'Novo lead', position: 0 },
      { id: SEED_IDS.stages.proposta, pipeline_id: SEED_IDS.pipeline, name: 'Proposta', position: 1 },
    ],
    campaigns: [{ id: SEED_IDS.campaign, name: 'Promo de outubro', status: 'Concluída' }],
  }
}

const SEED_KEY: Record<string, string> = { settings: 'key', processed_inbound_messages: 'message_id' }

/** Junta seeds: linhas do `override` com a mesma PK substituem as do `base`. */
export function mergeSeeds(base: Record<string, Row[]>, override: Record<string, Row[]>): Record<string, Row[]> {
  const out: Record<string, Row[]> = {}
  for (const table of new Set([...Object.keys(base), ...Object.keys(override)])) {
    const key = SEED_KEY[table] ?? 'id'
    const extra = override[table] ?? []
    const replaced = new Set<unknown>(extra.map((r) => r[key]).filter((v) => v !== undefined))
    out[table] = [...(base[table] ?? []).filter((r) => !replaced.has(r[key])), ...extra]
  }
  return out
}

export interface WorkflowDbOptions extends InMemorySupabaseOptions {
  /** inclui defaultSeed() (padrão true) */
  withDefaults?: boolean
  /** setActiveSupabase(db) — o que supabaseModuleMock() expõe (padrão true) */
  activate?: boolean
}

/** Banco em memória com DISPARA_SCHEMA (+ defaultSeed) e já ativo no mock do módulo. */
export function createWorkflowDb(seed: Record<string, Row[]> = {}, options: WorkflowDbOptions = {}): InMemorySupabase {
  const { withDefaults = true, activate = true, schema, ...rest } = options
  const db = createInMemorySupabase(
    withDefaults ? mergeSeeds(defaultSeed(), seed) : seed,
    {},
    { ...rest, schema: { ...DISPARA_SCHEMA, ...(schema ?? {}) } }
  )
  if (activate) setActiveSupabase(db)
  return db
}

// ─── Fábricas de árvore (lib/builder/flow/types.ts) ────────────────────────────

let autoId = 0
const nextId = (prefix: string) => {
  autoId += 1
  return `${prefix}${autoId}`
}

export const triggers = {
  /** "Sem gatilho": só inscrição manual (/enroll). */
  none: (): FlowTrigger => ({ type: 'none', label: '', keywords: [] }),
  keywords: (keywords: string[], label = 'Palavras-chave'): FlowTrigger => ({ type: 'keywords', label, keywords }),
  /** Árvore antiga, sem `type` (deve ser tratada como keywords). */
  legacyKeywords: (keywords: string[]): FlowTrigger => ({ label: 'Palavras-chave', keywords }),
  /** "Respondeu ao disparo" — campanha específica (campaignId) ou qualquer uma (null). */
  campaignReply: (opts: { campaignId?: string | null; campaignName?: string | null; replyFilter?: string } = {}): FlowTrigger => ({
    type: 'campaign_reply',
    label: 'Respondeu ao disparo',
    keywords: [],
    campaignId: opts.campaignId ?? null,
    campaignName: opts.campaignName ?? null,
    replyFilter: opts.replyFilter ?? '',
  }),
}

interface StepBase {
  id?: string
  name?: string
  next?: Step | null
}

type BranchInput = { label: string; id?: string; child?: Step | null }

export const steps = {
  /** Mensagem livre (message), template aprovado (template) ou mídia (mediaUrl). */
  whatsapp(o: StepBase & { message?: string; template?: string; mediaUrl?: string; mediaType?: string } = {}): Step {
    return {
      id: o.id ?? nextId('wa'),
      type: 'whatsapp',
      name: o.name ?? 'WhatsApp',
      config: {
        template: o.template ?? '',
        mediaUrl: o.mediaUrl ?? '',
        message: o.message ?? '',
        ...(o.mediaType ? { mediaType: o.mediaType } : {}),
      },
      next: o.next ?? null,
    }
  },

  /** Perguntar: 1 branch por botão + "Not Delivered"/"Timeout" travadas (como a UI cria). */
  interactive(
    o: StepBase & { message: string; buttons: Array<string | BranchInput>; lockedBranches?: boolean }
  ): Step {
    const id = o.id ?? nextId('ask')
    const branches: Branch[] = o.buttons.map((b, i) => {
      const input = typeof b === 'string' ? { label: b } : b
      return { id: input.id ?? `${id}-b${i}`, label: input.label, child: input.child ?? null }
    })
    if (o.lockedBranches !== false) {
      branches.push({ id: `${id}-nd`, label: 'Not Delivered', child: null, locked: true })
      branches.push({ id: `${id}-to`, label: 'Timeout', child: null, locked: true })
    }
    return { id, type: 'interactive', name: o.name ?? 'Perguntar', config: { message: o.message }, next: o.next ?? null, branches }
  },

  /** Aguardar N minutos/horas/dias (mode 'reply' não compila no v1). */
  wait(o: StepBase & { value?: number; unit?: 'minutes' | 'hours' | 'days'; mode?: 'duration' | 'reply' } = {}): Step {
    return {
      id: o.id ?? nextId('wait'),
      type: 'wait',
      name: o.name ?? 'Aguardar',
      config: { mode: o.mode ?? 'duration', value: o.value ?? 2, unit: o.unit ?? 'minutes', timeoutValue: 1, timeoutUnit: 'hours' },
      next: o.next ?? null,
    }
  },

  /** Condição sobre a resposta (contains/not_contains/equals) + branch "None" travada. */
  condition(
    o: StepBase & {
      branches: Array<BranchInput & { value: string; operator?: 'contains' | 'not_contains' | 'equals'; field?: string }>
      /** child da branch "None" */
      none?: Step | null
      /** emite a branch "None" travada (padrão true, como a UI) */
      noneBranch?: boolean
    }
  ): Step {
    const id = o.id ?? nextId('cond')
    const branches: Branch[] = o.branches.map((b, i) => ({
      id: b.id ?? `${id}-b${i}`,
      label: b.label,
      child: b.child ?? null,
      field: b.field ?? 'Replied message',
      operator: b.operator ?? 'contains',
      value: b.value,
    }))
    if (o.noneBranch !== false) branches.push({ id: `${id}-none`, label: 'None', child: o.none ?? null, locked: true })
    return { id, type: 'condition', name: o.name ?? 'Condição', config: {}, next: o.next ?? null, branches }
  },

  /** Split A/B (ainda não suportado pelo compile v1). */
  split(o: StepBase & { paths: Array<BranchInput & { percent: number }> }): Step {
    const id = o.id ?? nextId('split')
    return {
      id,
      type: 'split',
      name: o.name ?? 'Split',
      config: {},
      next: o.next ?? null,
      branches: o.paths.map((p, i) => ({ id: p.id ?? `${id}-p${i}`, label: p.label, percent: p.percent, child: p.child ?? null })),
    }
  },

  tag(o: StepBase & { tags: string[] }): Step {
    return { id: o.id ?? nextId('tag'), type: 'tag', name: o.name ?? 'Adicionar tag', config: { tags: o.tags }, next: o.next ?? null }
  },

  tagRemove(o: StepBase & { tags: string[] }): Step {
    return {
      id: o.id ?? nextId('untag'),
      type: 'tag_remove',
      name: o.name ?? 'Remover tag',
      config: { tags: o.tags },
      next: o.next ?? null,
    }
  },

  pipeline(
    o: StepBase & {
      pipelineId?: string
      stageId?: string
      pipelineName?: string
      stageName?: string
      oppStatus?: 'open' | 'won' | 'lost' | 'abandoned'
      oppName?: string
    } = {}
  ): Step {
    return {
      id: o.id ?? nextId('pipe'),
      type: 'pipeline',
      name: o.name ?? 'Mover no pipeline',
      config: {
        pipelineId: o.pipelineId ?? SEED_IDS.pipeline,
        pipelineName: o.pipelineName ?? 'Vendas',
        stageId: o.stageId ?? SEED_IDS.stages.novo,
        stageName: o.stageName ?? 'Novo lead',
        oppStatus: o.oppStatus ?? 'open',
        ...(o.oppName !== undefined ? { oppName: o.oppName } : {}),
      },
      next: o.next ?? null,
    }
  },

  /** Go To (ainda não suportado pelo compile v1). Terminal: não tem next. */
  goto(o: { id?: string; name?: string; targetId: string | null }): Step {
    return { id: o.id ?? nextId('goto'), type: 'goto', name: o.name ?? 'Ir para', config: { targetId: o.targetId }, next: null }
  },

  /** END: terminal, não emite node. */
  end(o: { id?: string; name?: string } = {}): Step {
    return { id: o.id ?? nextId('end'), type: 'end', name: o.name ?? 'END', config: {}, next: null }
  },
}

/** Encadeia passos (next) e devolve o primeiro. Cada item pode já ter uma cauda. */
export function chain(...items: Step[]): Step | null {
  if (items.length === 0) return null
  for (let i = 0; i < items.length - 1; i += 1) {
    let tail = items[i]
    while (tail.next) tail = tail.next
    if (tail.type === 'end' || tail.type === 'goto') {
      throw new Error(`[workflow-harness] chain: "${tail.id}" é terminal e não pode ter continuação`)
    }
    tail.next = items[i + 1]
  }
  return items[0]
}

/** Flow (schemaVersion 1). Padrão: gatilho por palavra-chave "oi". */
export function makeFlow(o: { id?: string; name?: string; trigger?: FlowTrigger; root?: Step | null } = {}): Flow {
  return {
    schemaVersion: 1,
    id: o.id ?? 'wf-test',
    name: o.name ?? 'Fluxo de teste',
    trigger: o.trigger ?? triggers.keywords(['oi']),
    root: o.root ?? null,
  }
}

/** compileFlow real (lança FlowCompileError como a UI). */
export function compile(flow: Flow): CompiledWorkflow {
  return compileFlow(flow)
}

/** Nós ligados direto ao __trigger (raízes que o /enroll usa). */
export function headsAfterTrigger(graph: { edges: Array<{ source: string; target: string }> }): string[] {
  return graph.edges.filter((e) => e.source === TRIGGER_NODE_ID).map((e) => e.target)
}

export { TRIGGER_NODE_ID }

// ─── Publicação ────────────────────────────────────────────────────────────────

export interface PublishedFlow {
  workflowId: string
  /** versão ativa (a publicada) */
  versionId: string
  version: number
  /** versão de rascunho criada antes (vira 'archived' ao publicar) */
  draftVersionId: string | null
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
  tree: Flow
}

/**
 * Publica SEM passar pelas rotas (não precisa de mock de módulo): compileFlow real +
 * createWorkflowRecord/createNewVersion reais (lib/builder/workflow-db) com db.client,
 * e as mesmas escritas de app/api/builder/workflows/[workflowId]/publish/route.ts
 * (workflows.active_version_id/status e a versão anterior → 'archived').
 * Resultado: v1 'archived' (rascunho) + v2 'published' ativa — igual ao fluxo da UI.
 */
export async function seedPublishedFlow(
  db: InMemorySupabase,
  flow: Flow,
  opts: { workflowId?: string; name?: string; settings?: WorkflowSettings; publish?: boolean; ownerCompanyId?: string | null } = {}
): Promise<PublishedFlow> {
  const workflowId = opts.workflowId ?? flow.id
  const compiled = compileFlow(flow)
  const nodes = compiled.nodes as unknown as WorkflowNode[]
  const edges = compiled.edges as unknown as WorkflowEdge[]
  const client = db.client as never
  const record = await createWorkflowRecord(
    client,
    { id: workflowId, name: opts.name ?? flow.name, nodes, edges, tree: flow },
    opts.ownerCompanyId === undefined ? TEST_COMPANY_ID : opts.ownerCompanyId
  )
  if (opts.settings) {
    db.update('workflows', { id: workflowId }, { settings: parseWorkflowSettings(opts.settings) })
  }
  const draftVersionId = record.workflow.active_version_id ?? null
  if (opts.publish === false) {
    return { workflowId, versionId: draftVersionId ?? '', version: 1, draftVersionId, nodes, edges, tree: flow }
  }
  const published = await createNewVersion(client, workflowId, { nodes, edges, tree: flow, status: 'published' })
  const now = new Date().toISOString()
  db.update('workflows', { id: workflowId }, { active_version_id: published.id, status: 'published', updated_at: now })
  if (draftVersionId) db.update('workflow_versions', { id: draftVersionId }, { status: 'archived', updated_at: now })
  return { workflowId, versionId: published.id, version: published.version, draftVersionId, nodes, edges, tree: flow }
}

/**
 * Caminho REAL da UI (useWorkflowBuilder.publish): compileFlow → PATCH
 * /api/builder/workflows/[id] com { name, tree, nodes, edges } → POST .../publish.
 * Exige o mock de '@/lib/supabase' (supabaseModuleMock) apontando para `db`.
 * Lança se compileFlow falhar (a UI bloqueia) ou se alguma rota responder ≠ 2xx.
 */
export async function publishFlow(
  db: InMemorySupabase,
  flow: Flow,
  opts: { workflowId?: string; settings?: WorkflowSettings } = {}
): Promise<PublishedFlow & { patch: RouteResult; publish: RouteResult }> {
  assertActive(db)
  const workflowId = opts.workflowId ?? flow.id
  const compiled = compileFlow(flow)
  const patch = await routes.patchWorkflow(workflowId, {
    name: flow.name,
    tree: flow,
    nodes: compiled.nodes,
    edges: compiled.edges,
    ...(opts.settings ? { settings: opts.settings } : {}),
  })
  if (patch.status >= 300) throw new Error(`[workflow-harness] PATCH falhou (${patch.status}): ${JSON.stringify(patch.body)}`)
  // versão que o editor acabou de salvar (rascunho mais novo; a ativa se nunca publicou)
  const editor = await fetchEditorRecord(db.client as never, workflowId)
  const draftVersionId = editor?.version.id ?? null
  const publish = await routes.publish(workflowId)
  if (publish.status >= 300) throw new Error(`[workflow-harness] publish falhou (${publish.status}): ${JSON.stringify(publish.body)}`)
  const body = publish.body as { versionId: string; version: number }
  const version = db.row('workflow_versions', { id: body.versionId })
  return {
    workflowId,
    versionId: body.versionId,
    version: body.version,
    draftVersionId,
    nodes: (version?.nodes ?? []) as WorkflowNode[],
    edges: (version?.edges ?? []) as WorkflowEdge[],
    tree: flow,
    patch,
    publish,
  }
}

function assertActive(db: InMemorySupabase): void {
  if (getActiveSupabase() !== db) {
    throw new Error(
      '[workflow-harness] o banco não está ativo: use createWorkflowDb() (activate padrão) ou setActiveSupabase(db), ' +
        "e mocke '@/lib/supabase' com supabaseModuleMock()."
    )
  }
}

// ─── Requisições e rotas ───────────────────────────────────────────────────────

export interface RouteResult<T = unknown> {
  status: number
  body: T
  response: Response
}

export function routeParams(workflowId: string): { params: Promise<{ workflowId: string }> } {
  return { params: Promise.resolve({ workflowId }) }
}

export function jsonRequest(
  url: string,
  body?: unknown,
  init: { method?: string; headers?: Record<string, string> } = {}
): NextRequest {
  const method = init.method ?? (body === undefined ? 'GET' : 'POST')
  return new NextRequest(new URL(url, 'http://localhost:3000'), {
    method,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
    ...(body === undefined || method === 'GET' ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
  })
}

/** Headers de chamada interna (Bearer CRON_SECRET), como reinvokeSelf/pg_cron. */
export function cronHeaders(): Record<string, string> {
  return { authorization: `Bearer ${process.env.CRON_SECRET || TEST_CRON_SECRET}` }
}

export async function readRoute<T = unknown>(response: Response): Promise<RouteResult<T>> {
  const text = await response.clone().text()
  let body: unknown = text
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = text
  }
  return { status: response.status, body: body as T, response }
}

type Handler = (request: NextRequest, ctx: { params: Promise<{ workflowId: string }> }) => Promise<Response>

/** Rotas reais, importadas sob demanda. Exigem os vi.mock do cabeçalho deste arquivo. */
export const routes = {
  async getWorkflow(workflowId: string) {
    const mod = await import('@/app/api/builder/workflows/[workflowId]/route')
    return readRoute(await (mod.GET as unknown as Handler)(jsonRequest(`/api/builder/workflows/${workflowId}`), routeParams(workflowId)))
  },
  /** Save do builder (o body é o que useWorkflowBuilder manda: { name, tree, nodes, edges }). */
  async patchWorkflow(workflowId: string, body: unknown) {
    const mod = await import('@/app/api/builder/workflows/[workflowId]/route')
    return readRoute(
      await (mod.PATCH as unknown as Handler)(
        jsonRequest(`/api/builder/workflows/${workflowId}`, body, { method: 'PATCH' }),
        routeParams(workflowId)
      )
    )
  },
  async deleteWorkflow(workflowId: string) {
    const mod = await import('@/app/api/builder/workflows/[workflowId]/route')
    return readRoute(
      await (mod.DELETE as unknown as Handler)(
        jsonRequest(`/api/builder/workflows/${workflowId}`, undefined, { method: 'DELETE' }),
        routeParams(workflowId)
      )
    )
  },
  async publish(workflowId: string) {
    const mod = await import('@/app/api/builder/workflows/[workflowId]/publish/route')
    return readRoute(
      await (mod.POST as unknown as Handler)(jsonRequest(`/api/builder/workflows/${workflowId}/publish`, {}), routeParams(workflowId))
    )
  },
  /** Inscrição manual/bulk: { contactIds?, phones? }. */
  async enroll(workflowId: string, body: { contactIds?: string[]; phones?: string[] }) {
    const mod = await import('@/app/api/builder/workflows/[workflowId]/enroll/route')
    return readRoute(
      await (mod.POST as unknown as Handler)(jsonRequest(`/api/builder/workflows/${workflowId}/enroll`, body), routeParams(workflowId))
    )
  },
  /** Disparo do fluxo (o que o webhook manda via reinvokeSelf). auth=false omite o Bearer. */
  async execute(workflowId: string, body: unknown, opts: { auth?: boolean } = {}) {
    const mod = await import('@/app/api/builder/workflow/[workflowId]/execute/route')
    return readRoute(
      await (mod.POST as unknown as Handler)(
        jsonRequest(`/api/builder/workflow/${workflowId}/execute`, body, { headers: opts.auth === false ? {} : cronHeaders() }),
        routeParams(workflowId)
      )
    )
  },
  /** Retomada do Perguntar: { conversationId, input: { from, to, message } }. */
  async resume(workflowId: string, body: unknown, opts: { auth?: boolean } = {}) {
    const mod = await import('@/app/api/builder/workflow/[workflowId]/resume/route')
    return readRoute(
      await (mod.POST as unknown as Handler)(
        jsonRequest(`/api/builder/workflow/${workflowId}/resume`, body, { headers: opts.auth === false ? {} : cronHeaders() }),
        routeParams(workflowId)
      )
    )
  },
  /** POST /api/webhook com payload da Meta. `secret` assina (X-Hub-Signature-256). */
  async webhook(body: unknown, opts: { secret?: string; signature?: string } = {}) {
    const mod = await import('@/app/api/webhook/route')
    const raw = typeof body === 'string' ? body : JSON.stringify(body)
    const headers: Record<string, string> = {}
    if (opts.signature) headers['x-hub-signature-256'] = opts.signature
    else if (opts.secret) headers['x-hub-signature-256'] = signMetaBody(raw, opts.secret)
    return readRoute(await mod.POST(jsonRequest('https://dispara.test/api/webhook', raw, { headers })))
  },
  /** Um tick do drain de waits (lib/cron/workflow-enrollments). */
  async drain() {
    const mod = await import('@/lib/cron/workflow-enrollments')
    return mod.drainWorkflowEnrollments()
  },
}

// ─── reinvokeSelf capturado ────────────────────────────────────────────────────

export interface SelfInvokeCall {
  path: string
  body: Record<string, unknown>
}

/** Chamadas de reinvokeSelf, em ordem (preenchido pelo selfInvokeModuleMock). */
export const selfInvokeCalls: SelfInvokeCall[] = []

/**
 * Forma do módulo '@/lib/self-invoke' que só REGISTRA as reinvocações (sem after()
 * nem fetch). Use flushSelfInvokes() para executá-las in-process.
 */
export function selfInvokeModuleMock() {
  return {
    reinvokeSelf: vi.fn((path: string, body: Record<string, unknown> = {}) => {
      selfInvokeCalls.push({ path, body: { ...JSON.parse(JSON.stringify(body)), source: 'self-reinvoke' } })
    }),
    resolveBaseUrl: vi.fn(() => 'http://localhost:3000'),
    internalAuthHeaders: vi.fn(() => ({ Authorization: `Bearer ${process.env.CRON_SECRET || TEST_CRON_SECRET}` })),
  }
}

export interface FlushedInvoke extends SelfInvokeCall {
  /** null = caminho sem rota no harness (ex.: IA do inbox) — só registrado */
  result: RouteResult | null
}

/**
 * Executa as reinvocações pendentes para /api/builder/workflow/:id/(execute|resume)
 * chamando as rotas reais com auth de cron. Repete até esvaziar (maxRounds).
 */
export async function flushSelfInvokes(opts: { maxRounds?: number } = {}): Promise<FlushedInvoke[]> {
  const out: FlushedInvoke[] = []
  for (let round = 0; round < (opts.maxRounds ?? 5) && selfInvokeCalls.length > 0; round += 1) {
    const batch = selfInvokeCalls.splice(0)
    for (const call of batch) {
      const match = /^\/api\/builder\/workflow\/([^/]+)\/(execute|resume)$/.exec(call.path)
      if (!match) {
        out.push({ ...call, result: null })
        continue
      }
      const result = match[2] === 'execute' ? await routes.execute(match[1], call.body) : await routes.resume(match[1], call.body)
      out.push({ ...call, result })
    }
  }
  return out
}

// ─── Payloads REAIS do webhook da Meta ─────────────────────────────────────────

let inboundCounter = 0
const nextInboundId = () => {
  inboundCounter += 1
  return `wamid.IN${String(inboundCounter).padStart(8, '0')}`
}
const unixNow = () => String(Math.floor(Date.now() / 1000))
/** A Meta manda `from`/`wa_id` só com dígitos. */
export const waId = (phone: string) => String(phone).replace(/\D/g, '')

export type MetaInboundMessage = Record<string, unknown> & { from: string; id: string; type: string }

interface InboundBase {
  /** telefone do contato (com ou sem "+") */
  from: string
  id?: string
  timestamp?: string | number
  /** context.id: mensagem nossa que está sendo respondida */
  replyTo?: string
}

function inboundBase(o: InboundBase, type: string): MetaInboundMessage {
  return {
    ...(o.replyTo ? { context: { from: FAKE_WHATSAPP.displayPhoneNumber, id: o.replyTo } } : {}),
    from: waId(o.from),
    id: o.id ?? nextInboundId(),
    timestamp: String(o.timestamp ?? unixNow()),
    type,
  }
}

export const metaInbound = {
  /** Texto livre. */
  text: (o: InboundBase & { body: string }): MetaInboundMessage => ({ ...inboundBase(o, 'text'), text: { body: o.body } }),
  /** Quick reply de TEMPLATE (botão de campanha): type 'button'. */
  button: (o: InboundBase & { text: string; payload?: string }): MetaInboundMessage => ({
    ...inboundBase(o, 'button'),
    button: { text: o.text, payload: o.payload ?? o.text },
  }),
  /** Botão de mensagem interativa (Perguntar): interactive.button_reply. */
  interactiveButton: (o: InboundBase & { title: string; replyId?: string }): MetaInboundMessage => ({
    ...inboundBase(o, 'interactive'),
    interactive: { type: 'button_reply', button_reply: { id: o.replyId ?? `btn-${o.title}`, title: o.title } },
  }),
  /** Item de lista: interactive.list_reply. */
  listReply: (o: InboundBase & { title: string; replyId?: string; description?: string }): MetaInboundMessage => ({
    ...inboundBase(o, 'interactive'),
    interactive: {
      type: 'list_reply',
      list_reply: { id: o.replyId ?? `row-${o.title}`, title: o.title, ...(o.description ? { description: o.description } : {}) },
    },
  }),
  /** Mídia sem legenda (não dispara fluxo: não tem texto). */
  image: (o: InboundBase & { caption?: string; mediaId?: string }): MetaInboundMessage => ({
    ...inboundBase(o, 'image'),
    image: { id: o.mediaId ?? 'media-test-1', mime_type: 'image/jpeg', sha256: 'test', ...(o.caption ? { caption: o.caption } : {}) },
  }),
}

export interface MetaStatusInput {
  /** wamid da mensagem enviada */
  messageId: string
  status: 'sent' | 'delivered' | 'read' | 'failed'
  recipient: string
  timestamp?: string | number
  errors?: Array<{ code: number; title?: string; message?: string; details?: string }>
}

/** Status de entrega (statuses[]), inclusive falha com errors[]. */
export function metaStatus(o: MetaStatusInput): Record<string, unknown> {
  return {
    id: o.messageId,
    status: o.status,
    timestamp: String(o.timestamp ?? unixNow()),
    recipient_id: waId(o.recipient),
    ...(o.status === 'failed'
      ? {
          errors: (o.errors ?? [{ code: 131026, title: 'Message undeliverable' }]).map((e) => ({
            code: e.code,
            title: e.title ?? 'Error',
            message: e.message ?? e.title ?? 'Error',
            error_data: { details: e.details ?? e.title ?? 'Error' },
            href: 'https://developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes/',
          })),
        }
      : {
          conversation: { id: 'conv-test', origin: { type: 'marketing' } },
          pricing: { billable: true, pricing_model: 'PMP', category: 'marketing' },
        }),
  }
}

/**
 * Envelope `whatsapp_business_account` (entry[].changes[].value) com metadata das
 * credenciais falsas — mesmo formato que a Meta entrega em /api/webhook.
 */
export function metaWebhookBody(
  o: {
    messages?: MetaInboundMessage[]
    statuses?: Array<Record<string, unknown>>
    /** nome do perfil em contacts[] (padrão "Contato Teste") */
    contactName?: string
    phoneNumberId?: string
    wabaId?: string
  } = {}
): Record<string, unknown> {
  const value: Record<string, unknown> = {
    messaging_product: 'whatsapp',
    metadata: {
      display_phone_number: FAKE_WHATSAPP.displayPhoneNumber,
      phone_number_id: o.phoneNumberId ?? FAKE_WHATSAPP.phoneNumberId,
    },
  }
  if (o.messages && o.messages.length > 0) {
    value.contacts = Array.from(new Set(o.messages.map((m) => m.from))).map((wa) => ({
      profile: { name: o.contactName ?? 'Contato Teste' },
      wa_id: wa,
    }))
    value.messages = o.messages
  }
  if (o.statuses && o.statuses.length > 0) value.statuses = o.statuses
  return {
    object: 'whatsapp_business_account',
    entry: [{ id: o.wabaId ?? FAKE_WHATSAPP.businessAccountId, changes: [{ value, field: 'messages' }] }],
  }
}

/** X-Hub-Signature-256 do corpo cru (HMAC-SHA256 com o App Secret). */
export function signMetaBody(rawBody: string, secret: string): string {
  return `sha256=${createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex')}`
}

// ─── Tempo, concorrência e ambiente ────────────────────────────────────────────

/** Congela SÓ o Date (setTimeout continua real — o executor e o webhook usam). */
export function freezeTime(iso = '2026-10-18T12:00:00.000Z'): void {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(iso))
}

/** Avança o relógio congelado (ex.: vencer o resume_at de um Aguardar). */
export function advanceTime(ms: number): void {
  vi.setSystemTime(new Date(Date.now() + ms))
}

/**
 * Barreira para forçar corridas determinísticas: as `parties` primeiras chamadas de
 * wait() só seguem quando todas chegaram. Ex.: dois drains lendo antes de qualquer CAS:
 * `db.onBefore(() => barrier.wait(), { table: 'workflow_enrollments', op: 'update' })`.
 */
export function createBarrier(parties: number, timeoutMs = 2000) {
  let arrived = 0
  let release: () => void = () => {}
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  return {
    get arrived() {
      return arrived
    },
    async wait(): Promise<void> {
      arrived += 1
      if (arrived > parties) return
      if (arrived === parties) release()
      let timer: ReturnType<typeof setTimeout> | undefined
      await Promise.race([
        gate,
        new Promise<void>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`[workflow-harness] barreira: só ${arrived}/${parties} chegaram em ${timeoutMs}ms`)),
            timeoutMs
          )
        }),
      ]).finally(() => clearTimeout(timer))
    },
  }
}

/**
 * Env de teste: segredos internos FALSOS e Supabase apontando para host inválido
 * (se algum caminho escapar do mock, falha em vez de tocar a produção).
 */
export function stubWorkflowEnv(extra: Record<string, string> = {}): void {
  const env: Record<string, string> = {
    CRON_SECRET: TEST_CRON_SECRET,
    DISPARA_ADMIN_KEY: TEST_ADMIN_KEY,
    DISPARA_API_KEY: TEST_API_KEY,
    WORKFLOW_BUILDER_DEFAULT_ID: '',
    WORKFLOW_BUILDER_WEBHOOK_SECRET: '',
    META_APP_SECRET: '',
    META_WEBHOOK_REQUIRE_SIGNATURE: '',
    WEBHOOK_VERIFY_TOKEN: '',
    NEXT_PUBLIC_SUPABASE_URL: 'http://supabase.invalid',
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'test-invalid-key',
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY: 'test-invalid-key',
    SUPABASE_SECRET_KEY: 'test-invalid-key',
    SUPABASE_SERVICE_ROLE_KEY: 'test-invalid-key',
    NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
    ...extra,
  }
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v)
}

/** Zera caches de módulo que vazariam entre testes (config de execução, assinatura Meta). */
export async function resetWorkflowCaches(): Promise<void> {
  const [settingsMod, signatureMod, originMod] = await Promise.all([
    import('@/lib/builder/workflow-execution-settings'),
    import('@/lib/meta-webhook-signature'),
    import('@/lib/meta-webhook-origin'),
  ])
  settingsMod.clearWorkflowExecutionConfigCache()
  signatureMod.resetMetaSignatureState()
  originMod.resetWebhookOriginState()
}

/** Silencia console.log/info/debug/warn (o executor é verboso). `errors: true` silencia console.error também. */
export function silenceConsole(opts: { errors?: boolean } = {}): void {
  for (const method of ['log', 'info', 'debug', 'warn'] as const) vi.spyOn(console, method).mockImplementation(() => {})
  if (opts.errors) vi.spyOn(console, 'error').mockImplementation(() => {})
}

export interface WorkflowTestContext {
  db: InMemorySupabase
  meta: MetaSendMock
}

/**
 * beforeEach padrão: env falso, banco com DISPARA_SCHEMA + defaultSeed (ativo no mock
 * do módulo), mock da Graph instalado, reinvocações zeradas e console silenciado.
 */
export function setupWorkflowTest(
  opts: { seed?: Record<string, Row[]>; db?: WorkflowDbOptions; meta?: MetaSendMockOptions; quiet?: boolean } = {}
): WorkflowTestContext {
  stubWorkflowEnv()
  const db = createWorkflowDb(opts.seed ?? {}, opts.db ?? {})
  const meta = createMetaSendMock(opts.meta).install()
  selfInvokeCalls.splice(0)
  if (opts.quiet !== false) silenceConsole()
  return { db, meta }
}

/** afterEach padrão (desfaz setupWorkflowTest). */
export function teardownWorkflowTest(): void {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.useRealTimers()
  vi.restoreAllMocks()
  setActiveSupabase(null)
  selfInvokeCalls.splice(0)
}
