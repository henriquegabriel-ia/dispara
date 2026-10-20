// Backend FALSO com estado para o E2E do builder: responde, via page.route,
// TODAS as chamadas do browser para /api/** no formato que a página espera
// (lib/builder/api-client.ts, services/*, hooks do shell).
//
// Fidelidade: o PATCH/create/publish de workflow passam pelas MESMAS validações
// do servidor real (validateWorkflowSchema, findWorkflowGraphIssues,
// validateTree, parseWorkflowSettings) e o modelo de versões imita
// lib/builder/workflow-db.ts (rascunho v1 ativo; publicar cria vN+1 e a torna
// ativa). Assim um grafo que o servidor real recusaria também é recusado aqui.
//
// Tudo que passa é gravado (calls) para as asserções; rota desconhecida vira
// `unhandled` (o teste de console/rede verifica que não sobrou nenhuma).

import type { Page, Route } from '@playwright/test'
import { findWorkflowGraphIssues, workflowGraphIssuesBody } from '@/lib/builder/workflow-graph-guard'
import { parseWorkflowSettings } from '@/lib/builder/workflow-settings'
import { validateTree } from '@/lib/builder/flow/tree-validate'
import type { Flow } from '@/lib/builder/flow/types'
import { validateWorkflowSchema } from '@/lib/shared/workflow-schema'

export interface ApiCall {
  method: string
  path: string
  search: string
  body: unknown
  status: number
}

export interface GraphNode {
  id: string
  type: string
  position: { x: number; y: number }
  data: { label: string; type: string; config?: Record<string, unknown>; description?: string }
}

export interface GraphEdge {
  id: string
  source: string
  target: string
  type?: string
}

interface VersionRow {
  id: string
  version: number
  status: 'draft' | 'published' | 'archived'
  nodes: GraphNode[]
  edges: GraphEdge[]
  tree: unknown
  created_at: string
  published_at: string | null
}

export interface WorkflowRow {
  id: string
  name: string
  description?: string
  status: 'draft' | 'published' | 'archived'
  settings: Record<string, unknown>
  createdAt: string
  updatedAt: string
  versions: VersionRow[]
  activeVersionId: string
}

export interface SeedWorkflow {
  id?: string
  name: string
  tree?: Flow
  nodes?: GraphNode[]
  edges?: GraphEdge[]
  settings?: Record<string, unknown>
  status?: WorkflowRow['status']
  publishedVersion?: number
}

interface Override {
  method: string
  path: RegExp
  status: number
  body: unknown
  times: number
  delayMs: number
}

export const FAKE_CAMPAIGNS = [
  { id: 'camp-black-friday', name: 'Black Friday VIP', status: 'Concluído', recipients: 120, sent: 120, delivered: 118, read: 90, failed: 2, createdAt: '2026-10-01T12:00:00.000Z', templateName: 'promo_bf' },
  { id: 'camp-reativacao', name: 'Reativação Outubro', status: 'Concluído', recipients: 80, sent: 80, delivered: 79, read: 40, failed: 1, createdAt: '2026-10-05T12:00:00.000Z', templateName: 'reativacao' },
] as const

export const FAKE_TEMPLATES = [
  { id: 'tpl-1', name: 'boas_vindas', language: 'pt_BR', category: 'MARKETING', status: 'APPROVED', content: 'Olá {{1}}, bem-vindo!', preview: 'Olá {{1}}, bem-vindo!', lastUpdated: '2026-10-01T00:00:00.000Z' },
  { id: 'tpl-2', name: 'lembrete_pagamento', language: 'pt_BR', category: 'UTILITY', status: 'APPROVED', content: 'Seu boleto vence amanhã.', preview: 'Seu boleto vence amanhã.', lastUpdated: '2026-10-01T00:00:00.000Z' },
  { id: 'tpl-3', name: 'rascunho_pendente', language: 'pt_BR', category: 'MARKETING', status: 'PENDING', content: 'Pendente', preview: 'Pendente', lastUpdated: '2026-10-01T00:00:00.000Z' },
] as const

export const FAKE_TAGS = ['vip', 'lead-quente', 'cliente'] as const

export const FAKE_PIPELINES = [
  {
    id: 'pipe-vendas',
    name: 'Vendas',
    stages: [
      { id: 'stage-novo', name: 'Novo lead' },
      { id: 'stage-proposta', name: 'Proposta enviada' },
      { id: 'stage-ganho', name: 'Fechado' },
    ],
  },
  { id: 'pipe-suporte', name: 'Suporte', stages: [{ id: 'stage-aberto', name: 'Aberto' }] },
] as const

const nowIso = () => new Date().toISOString()

/** Mesmo default de buildDefaultGraph (lib/builder/workflow-db.ts). */
function defaultGraph(seq: number): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const triggerId = `default-trigger-${seq}`
  const actionId = `default-action-${seq}`
  return {
    nodes: [
      { id: triggerId, type: 'trigger', position: { x: 80, y: 120 }, data: { label: 'Mensagem recebida', description: 'Inicia quando uma mensagem chega', type: 'trigger', config: { triggerType: 'Webhook' } } },
      { id: actionId, type: 'action', position: { x: 420, y: 120 }, data: { label: 'Enviar mensagem', description: 'Responder ao usuario', type: 'action', config: { actionType: 'Send Message' } } },
    ],
    edges: [{ id: `default-edge-${seq}`, source: triggerId, target: actionId, type: 'animated' }],
  }
}

function json(route: Route, status: number, body: unknown): Promise<void> {
  return route.fulfill({
    status,
    contentType: 'application/json; charset=utf-8',
    headers: { 'cache-control': 'no-store' },
    body: JSON.stringify(body),
  })
}

export class FakeBackend {
  readonly calls: ApiCall[] = []
  readonly unhandled: string[] = []
  readonly workflows = new Map<string, WorkflowRow>()
  defaultWorkflowId = ''
  campaigns: unknown[] = [...FAKE_CAMPAIGNS]
  templates: unknown[] = [...FAKE_TEMPLATES]
  tags: string[] = [...FAKE_TAGS]
  pipelines: unknown[] = FAKE_PIPELINES.map((p) => ({ ...p, stages: [...p.stages] }))
  private overrides: Override[] = []
  private seq = 0

  // ── Seeds ─────────────────────────────────────────────────────────────────
  seedWorkflow(seed: SeedWorkflow): WorkflowRow {
    this.seq += 1
    const id = seed.id ?? `wf-e2e-${this.seq}`
    const graph = seed.nodes ? { nodes: seed.nodes, edges: seed.edges ?? [] } : defaultGraph(this.seq)
    const created = nowIso()
    const versions: VersionRow[] = [
      {
        id: `${id}-v1`,
        version: 1,
        status: 'draft',
        nodes: graph.nodes,
        edges: graph.edges,
        tree: seed.tree ?? null,
        created_at: created,
        published_at: null,
      },
    ]
    let activeVersionId = versions[0].id
    if (seed.publishedVersion) {
      versions[0].status = 'archived'
      versions.push({
        ...versions[0],
        id: `${id}-v${seed.publishedVersion}`,
        version: seed.publishedVersion,
        status: 'published',
        published_at: created,
      })
      activeVersionId = versions[versions.length - 1].id
    }
    const row: WorkflowRow = {
      id,
      name: seed.name,
      status: seed.status ?? (seed.publishedVersion ? 'published' : 'draft'),
      settings: seed.settings ?? {},
      createdAt: created,
      updatedAt: created,
      versions,
      activeVersionId,
    }
    this.workflows.set(id, row)
    return row
  }

  // ── Controle de falhas/latência ─────────────────────────────────────────
  /** Próxima(s) chamada(s) `method path` respondem com este status/corpo. */
  failNext(method: string, path: RegExp, opts: { status?: number; body?: unknown; times?: number; delayMs?: number } = {}): void {
    this.overrides.push({
      method: method.toUpperCase(),
      path,
      status: opts.status ?? 500,
      body: opts.body ?? { error: 'Falha simulada pelo teste' },
      times: opts.times ?? 1,
      delayMs: opts.delayMs ?? 0,
    })
  }

  /** Atrasa a(s) próxima(s) chamada(s) (resposta normal) — para ver "Salvando…". */
  delayNext(method: string, path: RegExp, delayMs: number, times = 1): void {
    this.overrides.push({ method: method.toUpperCase(), path, status: 0, body: null, times, delayMs })
  }

  // ── Consultas para asserções ─────────────────────────────────────────────
  callsTo(method: string, path: RegExp): ApiCall[] {
    return this.calls.filter((c) => c.method === method.toUpperCase() && path.test(c.path))
  }

  patchesFor(id: string): Array<Record<string, unknown>> {
    return this.callsTo('PATCH', new RegExp(`^/api/builder/workflows/${id}$`)).map(
      (c) => (c.body ?? {}) as Record<string, unknown>
    )
  }

  lastPatch(id: string): Record<string, unknown> | undefined {
    const all = this.patchesFor(id)
    return all[all.length - 1]
  }

  activeVersion(id: string): VersionRow {
    const wf = this.workflows.get(id)
    if (!wf) throw new Error(`workflow ${id} não existe no backend falso`)
    const v = wf.versions.find((x) => x.id === wf.activeVersionId)
    if (!v) throw new Error(`versão ativa de ${id} não encontrada`)
    return v
  }

  // ── Wiring ────────────────────────────────────────────────────────────────
  async attach(page: Page): Promise<void> {
    await page.route('**/api/**', (route) => this.handle(route))
  }

  private savedWorkflow(wf: WorkflowRow) {
    const active = wf.versions.find((v) => v.id === wf.activeVersionId)!
    const published = wf.versions.filter((v) => v.status === 'published').map((v) => v.version)
    return {
      id: wf.id,
      name: wf.name,
      description: wf.description,
      nodes: active.nodes,
      edges: active.edges,
      tree: active.tree ?? undefined,
      visibility: 'private',
      settings: parseWorkflowSettings(wf.settings),
      createdAt: wf.createdAt,
      updatedAt: wf.updatedAt,
      isOwner: true,
      status: wf.status,
      lastPublishedVersion: published.length ? Math.max(...published) : null,
    }
  }

  private ensureWorkflow(id: string): WorkflowRow {
    // A rota real (ensureWorkflowRecord) cria o registro se não existir.
    return this.workflows.get(id) ?? this.seedWorkflow({ id, name: 'Novo fluxo' })
  }

  private async handle(route: Route): Promise<void> {
    const request = route.request()
    const url = new URL(request.url())
    if (!url.pathname.startsWith('/api/')) return route.fallback()

    const method = request.method().toUpperCase()
    let body: unknown = null
    const raw = request.postData()
    if (raw) {
      try {
        body = JSON.parse(raw)
      } catch {
        body = raw
      }
    }
    const call: ApiCall = { method, path: url.pathname, search: url.search, body, status: 0 }
    this.calls.push(call)

    const override = this.overrides.find((o) => o.method === method && o.path.test(url.pathname) && o.times > 0)
    if (override) {
      override.times -= 1
      if (override.delayMs) await new Promise((resolve) => setTimeout(resolve, override.delayMs))
      if (override.status) {
        call.status = override.status
        return json(route, override.status, override.body)
      }
    }

    const [status, payload] = this.dispatch(method, url, body)
    call.status = status
    return json(route, status, payload)
  }

  private dispatch(method: string, url: URL, body: unknown): [number, unknown] {
    const p = url.pathname
    const b = (body ?? {}) as Record<string, unknown>
    let m: RegExpMatchArray | null

    // ── Builder: workflows ───────────────────────────────────────────────────
    if (p === '/api/builder/workflows' && method === 'GET') {
      return [200, [...this.workflows.values()].map((wf) => this.savedWorkflow(wf))]
    }
    if (p === '/api/builder/workflows/metrics' && method === 'GET') {
      return [200, { totals: { runs: 0, success: 0, failed: 0 }, byWorkflow: {} }]
    }
    if (p === '/api/builder/workflows/create' && method === 'POST') {
      const nodes = Array.isArray(b.nodes) ? (b.nodes as GraphNode[]) : []
      const edges = Array.isArray(b.edges) ? (b.edges as GraphEdge[]) : []
      const wf = this.seedWorkflow({
        name: typeof b.name === 'string' ? b.name : 'Novo fluxo',
        nodes: nodes.length || edges.length ? nodes : undefined,
        edges,
        tree: b.tree as Flow | undefined,
      })
      return [200, this.savedWorkflow(wf)]
    }
    if ((m = p.match(/^\/api\/builder\/workflows\/([^/]+)$/))) {
      const id = decodeURIComponent(m[1])
      if (method === 'GET') return [200, this.savedWorkflow(this.ensureWorkflow(id))]
      if (method === 'PATCH') return this.patchWorkflow(id, b)
      if (method === 'DELETE') {
        this.workflows.delete(id)
        return [200, { success: true }]
      }
    }
    if ((m = p.match(/^\/api\/builder\/workflows\/([^/]+)\/publish$/)) && method === 'POST') {
      return this.publishWorkflow(decodeURIComponent(m[1]))
    }
    if ((m = p.match(/^\/api\/builder\/workflows\/([^/]+)\/versions$/)) && method === 'GET') {
      const wf = this.ensureWorkflow(decodeURIComponent(m[1]))
      return [
        200,
        [...wf.versions]
          .sort((a, z) => z.version - a.version)
          .map((v) => ({ id: v.id, version: v.version, status: v.status, created_at: v.created_at, published_at: v.published_at })),
      ]
    }
    if ((m = p.match(/^\/api\/builder\/workflows\/([^/]+)\/duplicate$/)) && method === 'POST') {
      const src = this.ensureWorkflow(decodeURIComponent(m[1]))
      const active = this.activeVersion(src.id)
      const copy = this.seedWorkflow({ name: `${src.name} (cópia)`, nodes: active.nodes, edges: active.edges, tree: active.tree as Flow })
      return [200, this.savedWorkflow(copy)]
    }
    if ((m = p.match(/^\/api\/builder\/workflows\/([^/]+)\/(run|enroll)$/)) && method === 'POST') {
      return [200, { executionId: `exec-${Date.now()}`, status: 'running', workflowId: decodeURIComponent(m[1]) }]
    }
    if ((m = p.match(/^\/api\/builder\/workflow\/([^/]+)\/execute$/)) && method === 'POST') {
      return [200, { executionId: `exec-${Date.now()}`, status: 'running' }]
    }

    // ── Settings do builder ──────────────────────────────────────────────────
    if (p === '/api/settings/workflow-builder') {
      if (method === 'POST') this.defaultWorkflowId = String(b.defaultWorkflowId ?? '')
      return [200, { defaultWorkflowId: this.defaultWorkflowId }]
    }

    // ── Fontes de dados do ConfigPanel ───────────────────────────────────────
    if (p === '/api/campaigns' && method === 'GET') return [200, this.campaigns]
    if (p === '/api/templates' && method === 'GET') return [200, this.templates]
    if (p === '/api/contacts/tags' && method === 'GET') return [200, this.tags]
    if (p === '/api/pipelines' && method === 'GET') return [200, this.pipelines]

    // ── Shell do dashboard ───────────────────────────────────────────────────
    if (p === '/api/health') {
      return [
        200,
        {
          overall: 'healthy',
          services: {
            database: { status: 'ok', provider: 'supabase', latency: 1 },
            whatsapp: { status: 'ok', source: 'db', phoneNumber: '+55 11 90000-0000' },
            webhook: { status: 'ok', lastEventAt: nowIso() },
          },
          timestamp: nowIso(),
        },
      ]
    }
    if (p === '/api/auth/status') {
      return [200, { isSetup: true, isAuthenticated: true, isConfigured: true, company: { id: 'company-e2e', name: 'Empresa E2E', email: 'e2e@example.test', phone: '' } }]
    }
    if (p === '/api/settings/onboarding') return [200, { onboardingCompleted: true, permanentTokenConfirmed: true }]
    if (p === '/api/inbox/unread-count') return [200, { count: 0 }]
    if (p === '/api/account/alerts') return [200, { alerts: [] }]
    // ok:false → WebhookAlertBanner não mostra nada (mesmo caminho de erro da Meta).
    if (p === '/api/meta/webhooks/subscription') return [200, { ok: false }]

    this.unhandled.push(`${method} ${p}${url.search}`)
    return [200, method === 'GET' ? {} : { success: true }]
  }

  /** Espelho de app/api/builder/workflows/[workflowId]/route.ts (PATCH). */
  private patchWorkflow(id: string, body: Record<string, unknown>): [number, unknown] {
    const normalized = {
      name: typeof body.name === 'string' ? body.name : undefined,
      description: typeof body.description === 'string' ? body.description : undefined,
      nodes: Array.isArray(body.nodes) ? (body.nodes as GraphNode[]) : undefined,
      edges: Array.isArray(body.edges) ? (body.edges as GraphEdge[]) : undefined,
      settings: body.settings && typeof body.settings === 'object' ? parseWorkflowSettings(body.settings) : undefined,
    }
    // PATCH parcial (só { settings } ou só { name }) não valida nem toca o grafo
    // (como a rota real desde o commit 0104a24).
    if (normalized.nodes !== undefined || normalized.edges !== undefined) {
      const validation = validateWorkflowSchema({ ...normalized, nodes: normalized.nodes ?? [], edges: normalized.edges ?? [] })
      if (!validation.success) return [400, { error: 'Invalid workflow', details: validation.errors }]
      const graphIssues = findWorkflowGraphIssues(normalized.nodes ?? [])
      if (graphIssues.length > 0) return [400, workflowGraphIssuesBody(graphIssues)]
    }
    let tree: unknown
    if (body.tree !== undefined) {
      if (body.tree === null || typeof body.tree !== 'object') {
        return [400, { error: 'Invalid tree', details: 'tree deve ser um objeto Flow' }]
      }
      const treeValidation = validateTree(body.tree as Flow)
      if (!treeValidation.valid) return [400, { error: 'Invalid tree', details: treeValidation.issues }]
      tree = body.tree
    }

    const wf = this.ensureWorkflow(id)
    const active = this.activeVersion(id)
    wf.name = normalized.name ?? wf.name
    if (normalized.description !== undefined) wf.description = normalized.description
    if (normalized.settings !== undefined) wf.settings = normalized.settings
    wf.updatedAt = nowIso()
    if (normalized.nodes !== undefined) active.nodes = normalized.nodes
    if (normalized.edges !== undefined) active.edges = normalized.edges
    if (tree !== undefined) active.tree = tree
    return [200, this.savedWorkflow(wf)]
  }

  /** Espelho de .../publish/route.ts. */
  private publishWorkflow(id: string): [number, unknown] {
    const wf = this.ensureWorkflow(id)
    const active = this.activeVersion(id)
    const graphIssues = findWorkflowGraphIssues(active.nodes)
    if (graphIssues.length > 0) return [400, workflowGraphIssuesBody(graphIssues)]
    const version = Math.max(...wf.versions.map((v) => v.version)) + 1
    const published: VersionRow = {
      ...structuredClone(active),
      id: `${id}-v${version}`,
      version,
      status: 'published',
      published_at: nowIso(),
    }
    active.status = 'archived'
    wf.versions.push(published)
    wf.activeVersionId = published.id
    wf.status = 'published'
    wf.updatedAt = nowIso()
    return [200, { success: true, versionId: published.id, version }]
  }
}
