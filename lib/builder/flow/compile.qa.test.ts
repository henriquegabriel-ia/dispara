// @vitest-environment node
/**
 * QA do compileFlow (árvore → grafo do executor) e dos guardas que o servidor aplica
 * ao grafo cru (workflow-schema + workflow-graph-guard).
 *
 * Complementa lib/builder/flow/compile.test.ts (cenário principal + regressões) com:
 * - o contrato EXATO do nó __trigger que app/api/webhook/route.ts e a rota execute leem;
 * - cada passo e cada gatilho, ids/edges determinísticos, invariantes de grafo
 *   (sem nó órfão, sem referência que some no resume);
 * - consistência meta.ts ↔ compile e matriz gatilho × passo ↔ schema/guard.
 *
 * Bugs de produto ficam como `it.fails` com o comportamento CORRETO e um comentário BUG.
 */
import { describe, expect, it } from 'vitest'
import { getStepImporter } from '@/lib/builder/step-registry'
import { SYSTEM_ACTION_TYPES } from '@/lib/builder/action-types'
import {
  compileFlow,
  FlowCompileError,
  TRIGGER_NODE_ID,
  type CompiledEdge,
  type CompiledNode,
  type CompiledWorkflow,
} from '@/lib/builder/flow/compile'
import { CONDITION_OPERATORS, PICKER_ORDER, STEP_META, WAIT_UNITS } from '@/lib/builder/flow/meta'
import { addStep, createEmptyFlow } from '@/lib/builder/flow/operations'
import type { Branch, Flow, FlowTrigger, Step, StepType } from '@/lib/builder/flow/types'
import {
  describeWorkflowGraphIssues,
  findWorkflowGraphIssues,
  workflowGraphIssuesBody,
} from '@/lib/builder/workflow-graph-guard'
import { validateWorkflowSchema } from '@/lib/shared/workflow-schema'
import { chain, makeFlow, steps, triggers } from '@/tests/helpers/workflow-harness'

// ─── Helpers ───────────────────────────────────────────────────────────────────

const node = (g: CompiledWorkflow, id: string): CompiledNode => {
  const found = g.nodes.find((n) => n.id === id)
  if (!found) throw new Error(`nó "${id}" não foi compilado (tem: ${g.nodes.map((n) => n.id).join(', ')})`)
  return found
}
const cfg = (g: CompiledWorkflow, id: string) => node(g, id).data.config
const targetsOf = (g: CompiledWorkflow, source: string) => g.edges.filter((e) => e.source === source).map((e) => e.target)
const sourcesOf = (g: CompiledWorkflow, target: string) => g.edges.filter((e) => e.target === target).map((e) => e.source)
const ids = (g: CompiledWorkflow) => g.nodes.map((n) => n.id)
const triggerNodes = (g: CompiledWorkflow) => g.nodes.filter((n) => n.data.type === 'trigger')

/** Captura o FlowCompileError (falha o teste se compilar). */
function compileError(flow: Flow): FlowCompileError {
  try {
    compileFlow(flow)
  } catch (error) {
    if (error instanceof FlowCompileError) return error
    throw error
  }
  throw new Error('esperava FlowCompileError, mas compilou')
}

/** Nós alcançáveis a partir de `start` seguindo as edges. */
function reachableFrom(g: CompiledWorkflow, start: string): Set<string> {
  const seen = new Set<string>()
  const stack = [start]
  while (stack.length) {
    const cur = stack.pop()!
    if (seen.has(cur)) continue
    seen.add(cur)
    for (const t of targetsOf(g, cur)) stack.push(t)
  }
  return seen
}

/** Referências {{@<nodeId>:...}} de uma expressão de Condition. */
function nodeRefs(expression: string): string[] {
  return Array.from(expression.matchAll(/\{\{@([^:]+):[^}]+\}\}/g), (m) => m[1])
}

const REF_TRIGGER = '{{@__trigger:Gatilho.message}}'

// ─── Gatilho: contrato com o webhook da Meta e com a rota execute ─────────────

describe('compileFlow — nó __trigger (formato lido pelo webhook e pelo execute)', () => {
  it('C01 keywords: exatamente 1 nó trigger "__trigger" com config { triggerType, keywordList } e nada mais', () => {
    const g = compileFlow(
      makeFlow({ trigger: { type: 'keywords', label: '', keywords: ['oi', 'menu'] }, root: steps.whatsapp({ id: 'w1', message: 'Olá' }) })
    )
    const trig = triggerNodes(g)
    expect(trig).toHaveLength(1)
    expect(trig[0]).toMatchObject({ id: TRIGGER_NODE_ID, type: 'trigger', data: { type: 'trigger', label: 'Palavras-chave' } })
    expect(TRIGGER_NODE_ID).toBe('__trigger')
    // o webhook faz split(/\r?\n/) do keywordList — formato exato, sem chaves extras
    expect(trig[0].data.config).toEqual({ triggerType: 'Keywords', keywordList: 'oi\nmenu' })
    expect(g.edges).toEqual([{ id: 'e-__trigger-w1', source: '__trigger', target: 'w1' }])
  })

  it('C01 keywords: o compile apara e descarta palavras vazias; caixa/acento/dedupe ficam para o casamento (keyword-match)', () => {
    const g = compileFlow(makeFlow({ trigger: triggers.keywords(['  Olá ', '', 'PROMO', 'promo']), root: steps.end() }))
    expect(cfg(g, TRIGGER_NODE_ID)).toEqual({ triggerType: 'Keywords', keywordList: 'Olá\nPROMO\npromo' })
  })

  it('C03 sem type (árvore antiga) compila como Keywords; label customizado é preservado', () => {
    const g = compileFlow(makeFlow({ trigger: triggers.legacyKeywords(['quero']), root: null }))
    expect(cfg(g, TRIGGER_NODE_ID)).toEqual({ triggerType: 'Keywords', keywordList: 'quero' })
    const custom = compileFlow(makeFlow({ trigger: triggers.keywords(['x'], 'Meu gatilho'), root: null }))
    expect(node(custom, TRIGGER_NODE_ID).data.label).toBe('Meu gatilho')
  })

  it('C03 none: { triggerType: "None" } com label de fallback "Sem gatilho (entrada manual)"', () => {
    const g = compileFlow(makeFlow({ trigger: triggers.none(), root: steps.whatsapp({ id: 'w1', message: 'oi' }) }))
    expect(node(g, TRIGGER_NODE_ID)).toMatchObject({ data: { type: 'trigger', label: 'Sem gatilho (entrada manual)' } })
    expect(cfg(g, TRIGGER_NODE_ID)).toEqual({ triggerType: 'None' })
    // o /enroll usa as edges que saem de __trigger como heads
    expect(targetsOf(g, TRIGGER_NODE_ID)).toEqual(['w1'])
  })

  it('C03 campaign_reply sem campanha/filtro: campaignId "" (= qualquer disparo para o webhook)', () => {
    const trigger: FlowTrigger = { type: 'campaign_reply', label: '', keywords: [], campaignId: null, campaignName: null }
    const g = compileFlow(makeFlow({ trigger, root: null }))
    expect(node(g, TRIGGER_NODE_ID).data.label).toBe('Respondeu ao disparo')
    expect(cfg(g, TRIGGER_NODE_ID)).toEqual({ triggerType: 'CampaignReply', campaignId: '', campaignName: '', replyFilter: '' })
  })

  it('C03 campaign_reply com campanha e filtro: replyFilter com trim, campaignId como string', () => {
    const g = compileFlow(
      makeFlow({ trigger: triggers.campaignReply({ campaignId: 'c1', campaignName: 'Black Friday', replyFilter: '  quero ' }), root: null })
    )
    expect(cfg(g, TRIGGER_NODE_ID)).toEqual({
      triggerType: 'CampaignReply',
      campaignId: 'c1',
      campaignName: 'Black Friday',
      replyFilter: 'quero',
    })
  })

  // Corrigido BUG(keywords-vazias): um gatilho "Palavra-chave" sem nenhuma palavra válida compila e publica,
  // mas o webhook descarta fluxos com lista vazia (app/api/webhook/route.ts loadKeywordWorkflows):
  // o fluxo publicado nunca dispara e a tela não avisa. O compile já recusa whatsapp/tag/pipeline
  // vazios; o correto é recusar também este gatilho (é o que a tela grava com o textarea vazio).
  it('C04 keywords-vazias: gatilho keywords sem palavra válida deveria falhar no compile', () => {
    expect(() => compileFlow(makeFlow({ trigger: triggers.keywords(['', '  ']), root: steps.whatsapp({ id: 'w1', message: 'oi' }) }))).toThrow(
      FlowCompileError
    )
  })
})

// ─── Passos ────────────────────────────────────────────────────────────────────

describe('compileFlow — whatsapp', () => {
  it('C05 precedência: template > mídia > mensagem', () => {
    const tpl = compileFlow(makeFlow({ root: steps.whatsapp({ id: 'w', template: ' promo_out ', mediaUrl: 'https://x/y.png', message: 'm' }) }))
    // a mídia do passo vira a mídia do HEADER do template (contrato: templateHeaderMediaUrl tem precedência)
    expect(cfg(tpl, 'w')).toEqual({
      actionType: 'whatsapp/send-template',
      toSource: 'inbound',
      templateName: 'promo_out',
      language: 'pt_BR',
      headerMediaUrl: 'https://x/y.png',
    })

    const tplFull = steps.whatsapp({ id: 'w', template: 'pedido' })
    Object.assign(tplFull.config, {
      templateLanguage: 'en_US',
      templateBodyParams: ['{{var.nome}}', '42'],
      templateHeaderMediaUrl: 'https://x/h.png',
    })
    expect(cfg(compileFlow(makeFlow({ root: tplFull })), 'w')).toEqual({
      actionType: 'whatsapp/send-template',
      toSource: 'inbound',
      templateName: 'pedido',
      language: 'en_US',
      bodyParams: ['{{var.nome}}', '42'],
      headerMediaUrl: 'https://x/h.png',
    })

    const media = compileFlow(makeFlow({ root: steps.whatsapp({ id: 'w', mediaUrl: ' https://x/v.mp4 ', mediaType: 'video', message: 'cap' }) }))
    expect(cfg(media, 'w')).toEqual({
      actionType: 'whatsapp/send-media',
      toSource: 'inbound',
      mediaType: 'video',
      mediaUrl: 'https://x/v.mp4',
      caption: 'cap',
    })
    const mediaDefault = compileFlow(makeFlow({ root: steps.whatsapp({ id: 'w', mediaUrl: 'https://x/a.png' }) }))
    expect(cfg(mediaDefault, 'w')).toMatchObject({ mediaType: 'image', caption: '' })

    const text = compileFlow(makeFlow({ root: steps.whatsapp({ id: 'w', message: ' oi {{var.nome}} ' }) }))
    // mensagem vai crua (sem trim): espaços e templates de variável preservados
    expect(cfg(text, 'w')).toEqual({ actionType: 'whatsapp/send-message', toSource: 'inbound', message: ' oi {{var.nome}} ' })
  })

  it('C05 template/mídia/mensagem só com espaços → FlowCompileError com o stepId', () => {
    const err = compileError(makeFlow({ root: steps.whatsapp({ id: 'w-vazio', name: 'Boas-vindas', template: ' ', mediaUrl: ' ', message: '  ' }) }))
    expect(err.stepId).toBe('w-vazio')
    expect(err.message).toContain('Boas-vindas')
  })
})

describe('compileFlow — wait (Aguardar)', () => {
  it.each([
    [2, 'minutes', 120_000],
    [3, 'hours', 10_800_000],
    [1, 'days', 86_400_000],
    [24, 'days', 24 * 86_400_000],
  ] as const)('C06 %s %s → Delay %sms', (value, unit, ms) => {
    const g = compileFlow(makeFlow({ root: steps.wait({ id: 'wt', value, unit }) }))
    expect(cfg(g, 'wt')).toEqual({ actionType: 'Delay', delayMs: ms })
  })

  it('C06 unidades de WAIT_UNITS batem com o ms usado no compile', () => {
    expect(Object.fromEntries(Object.entries(WAIT_UNITS).map(([k, u]) => [k, u.ms]))).toEqual({
      minutes: 60_000,
      hours: 3_600_000,
      days: 86_400_000,
    })
  })

  it.each([0, -1, 'abc', Number.NaN, Number.POSITIVE_INFINITY])('C06 duração inválida (%s) → FlowCompileError com stepId', (value) => {
    const step = steps.wait({ id: 'wt' })
    step.config.value = value
    expect(compileError(makeFlow({ root: step })).stepId).toBe('wt')
  })

  it('C06 unidade desconhecida, modo "reply" e 25 dias → FlowCompileError', () => {
    const weeks = steps.wait({ id: 'wt' })
    weeks.config.unit = 'weeks'
    expect(compileError(makeFlow({ root: weeks })).message).toContain('unidade de tempo desconhecida')
    expect(compileError(makeFlow({ root: steps.wait({ id: 'wt', mode: 'reply' }) })).message).toContain('não é suportado no v1')
    expect(compileError(makeFlow({ root: steps.wait({ id: 'wt', value: 25, unit: 'days' }) })).message).toContain('excede o máximo')
  })
})

describe('compileFlow — interactive (Perguntar)', () => {
  /** Botões Sim→w1, Não→(vazio), [Not Delivered travada no MEIO], Talvez→END, [Timeout travada]; next w2. */
  function askFlow(): Flow {
    const branches: Branch[] = [
      { id: 'b-sim', label: 'Sim', child: steps.whatsapp({ id: 'w1', message: 'Ótimo!' }) },
      { id: 'b-nao', label: 'Não', child: null },
      { id: 'b-nd', label: 'Not Delivered', child: null, locked: true },
      { id: 'b-talvez', label: 'Talvez', child: steps.end({ id: 'fim' }) },
      { id: 'b-to', label: 'Timeout', child: null, locked: true },
    ]
    const ask: Step = {
      id: 'ask',
      type: 'interactive',
      name: 'Pergunta',
      config: { message: 'Quer a proposta?' },
      branches,
      next: steps.whatsapp({ id: 'w2', message: 'Seguimos' }),
    }
    return makeFlow({ root: ask })
  }
  const R = '{{@ask__var:Resposta.value}}'

  it('C07 nós e ids: ask, ask__var (resume), ask__cond_<índice ORIGINAL> e ask__cond_else', () => {
    const g = compileFlow(askFlow())
    expect(new Set(ids(g))).toEqual(
      new Set(['__trigger', 'w2', 'ask', 'ask__var', 'ask__cond_0', 'w1', 'ask__cond_1', 'ask__cond_3', 'ask__cond_else'])
    )
    // o índice 2 (Not Delivered travada) é pulado: o sufixo vem do índice da branch, não da posição do botão
    expect(ids(g)).not.toContain('ask__cond_2')
    expect(cfg(g, 'ask')).toEqual({
      actionType: 'whatsapp/ask-question',
      toSource: 'inbound',
      message: 'Quer a proposta?',
      variableKey: 'reply_ask',
      // rótulos das branches NÃO travadas, na ordem
      buttons: ['Sim', 'Não', 'Talvez'],
    })
    // Get Variable SEM "message" (senão o executor o sequestraria como ask-question)
    expect(cfg(g, 'ask__var')).toEqual({ actionType: 'Get Variable', variableKey: 'reply_ask' })
    expect(node(g, 'ask__var').data.label).toBe('Pergunta · resposta')
    expect(node(g, 'ask__cond_else').data.label).toBe('Outra resposta')
    expect(node(g, 'ask__cond_3').data.label).toBe('Talvez')
  })

  it('C07 edges: ask tem saída ÚNICA para ask__var; fan-out para conds; convergência na continuação', () => {
    const g = compileFlow(askFlow())
    expect(targetsOf(g, TRIGGER_NODE_ID)).toEqual(['ask'])
    expect(targetsOf(g, 'ask')).toEqual(['ask__var']) // resume_node_id = ÚNICO next
    expect(targetsOf(g, 'ask__var')).toEqual(['ask__cond_0', 'ask__cond_1', 'ask__cond_3', 'ask__cond_else'])
    expect(targetsOf(g, 'ask__cond_0')).toEqual(['w1'])
    expect(targetsOf(g, 'w1')).toEqual(['w2']) // a branch converge na continuação
    expect(targetsOf(g, 'ask__cond_1')).toEqual(['w2']) // branch vazia segue direto
    expect(targetsOf(g, 'ask__cond_3')).toEqual([]) // END: sem saída e sem convergir
    expect(targetsOf(g, 'ask__cond_else')).toEqual(['w2'])
    expect(sourcesOf(g, 'w2').sort()).toEqual(['ask__cond_1', 'ask__cond_else', 'w1'])
  })

  it('C07 expressões: igualdade exata ao rótulo + negação dos anteriores; else = negação de todos', () => {
    const g = compileFlow(askFlow())
    const sim = `${R} === "Sim"`
    const nao = `${R} === "Não"`
    const talvez = `${R} === "Talvez"`
    expect(cfg(g, 'ask__cond_0')).toEqual({ actionType: 'Condition', condition: sim })
    expect(cfg(g, 'ask__cond_1').condition).toBe(`${nao} && !(${sim})`)
    expect(cfg(g, 'ask__cond_3').condition).toBe(`${talvez} && !(${sim}) && !(${nao})`)
    expect(cfg(g, 'ask__cond_else').condition).toBe(`!(${sim}) && !(${nao}) && !(${talvez})`)
  })

  it('C08 erros: sem mensagem, só branches travadas e branch travada com ações', () => {
    const noMessage = steps.interactive({ id: 'q', message: '   ', buttons: ['Sim'] })
    expect(compileError(makeFlow({ root: noMessage })).stepId).toBe('q')

    const onlyLocked = steps.interactive({ id: 'q', message: 'Oi?', buttons: [] })
    expect(compileError(makeFlow({ root: onlyLocked })).message).toContain('pelo menos 1 botão')

    const lockedWithChild = steps.interactive({ id: 'q', message: 'Oi?', buttons: ['Sim'] })
    lockedWithChild.branches![1].child = steps.whatsapp({ id: 'nd', message: 'não entregue' })
    expect(compileError(makeFlow({ root: lockedWithChild })).message).toContain('não é suportada no v1')
  })

  it('C08 rótulo duplicado (ignorando maiúsculas), vazio ou com mais de 20 caracteres não compila; até 10 opções', () => {
    const ask = (buttons: Array<string | { label: string }>) =>
      makeFlow({ root: steps.interactive({ id: 'q', message: 'Escolha', buttons: buttons as never }) })
    expect(compileError(ask(['Sim', 'sim'])).message).toContain('está repetido')
    expect(compileError(ask(['Sim', '  '])).message).toContain('sem texto')
    expect(compileError(ask(['Um rótulo comprido demais'])).message).toContain('20 caracteres')
    expect(compileError(ask(Array.from({ length: 11 }, (_, i) => `Opção ${i + 1}`))).message).toContain('no máximo 10')
    expect(() => compileFlow(ask(Array.from({ length: 10 }, (_, i) => `Opção ${i + 1}`)))).not.toThrow()
    expect(compileError(ask(['Sim', 'sim'])).stepId).toBe('q')
  })

  // Corrigido BUG(perguntar-sem-botoes): a tela configura até 3 botões ("N botões interativos" no card) e o
  // compile assume que "a resposta do WhatsApp volta EXATA (o texto do botão)", mas o nó ask
  // compilado só leva message/variableKey e askQuestionStep (lib/builder/steps/whatsapp/ask-question.ts)
  // envia buildTextMessage — texto puro, sem botões. O contato precisa digitar o rótulo idêntico
  // (=== e sensível a maiúsculas); "sim" cai em "Outra resposta".
  it('C09 perguntar-sem-botoes: o nó ask compilado deveria carregar os botões', () => {
    const g = compileFlow(makeFlow({ root: steps.interactive({ id: 'q', message: 'Confirma?', buttons: ['Sim', 'Não'] }) }))
    const askConfig = cfg(g, 'q')
    const serialized = JSON.stringify(askConfig.buttons ?? askConfig.interactive ?? null)
    expect(serialized).toContain('Sim')
    expect(serialized).toContain('Não')
  })
})

describe('compileFlow — condition', () => {
  function rootCondition(): Step {
    return steps.condition({
      id: 'c',
      branches: [
        { label: 'Tem a', value: 'a', operator: 'contains' },
        { label: 'Sem b', value: 'b', operator: 'not_contains' },
        { label: 'É c', value: 'c', operator: 'equals' },
      ],
      none: steps.whatsapp({ id: 'w9', message: 'Não entendi' }),
    })
  }

  it('C10 condição no root referencia a mensagem do gatilho e gera bases por operador', () => {
    const g = compileFlow(makeFlow({ root: rootCondition() }))
    const A = `${REF_TRIGGER}.includes("a")`
    const B = `!(${REF_TRIGGER}.includes("b"))`
    const C = `${REF_TRIGGER} === "c"`
    expect(cfg(g, 'c__cond_0')).toEqual({ actionType: 'Condition', condition: A })
    expect(cfg(g, 'c__cond_1').condition).toBe(`${B} && !(${A})`)
    expect(cfg(g, 'c__cond_2').condition).toBe(`${C} && !(${A}) && !(${B})`)
    expect(cfg(g, 'c__cond_none').condition).toBe(`!(${A}) && !(${B}) && !(${C})`)
    expect(node(g, 'c__cond_none').data.label).toBe('None')
    expect(node(g, 'c__cond_1').data.label).toBe('Sem b')
  })

  it('C10 o pai liga em TODOS os cond-heads (fan-out exclusivo) e a None leva ao seu filho', () => {
    const g = compileFlow(makeFlow({ root: rootCondition() }))
    expect(targetsOf(g, TRIGGER_NODE_ID)).toEqual(['c__cond_0', 'c__cond_1', 'c__cond_2', 'c__cond_none'])
    expect(targetsOf(g, 'c__cond_none')).toEqual(['w9'])
    for (const id of ['c__cond_0', 'c__cond_1', 'c__cond_2']) expect(targetsOf(g, id)).toEqual([])
    // não existe nó para o step "c" em si: a condição é só o leque de portões
    expect(ids(g)).not.toContain('c')
  })

  it('C10 depois de um Perguntar a referência é a variável persistida {{var.reply_<askId>}}', () => {
    const g = compileFlow(
      makeFlow({
        root: chain(
          steps.interactive({ id: 'ask', message: 'Qual plano?', buttons: ['Básico'] }),
          steps.condition({ id: 'c', branches: [{ label: 'Pro', value: 'pro' }] })
        ),
      })
    )
    expect(cfg(g, 'c__cond_0').condition).toBe('{{var.reply_ask}}.includes("pro")')
    expect(cfg(g, 'c__cond_0').condition).not.toContain('__trigger')
  })

  it('C10 condição é sensível a maiúsculas (contains/equals) — documentado; o gatilho não é', () => {
    const g = compileFlow(makeFlow({ root: steps.condition({ id: 'c', branches: [{ label: 'Preço', value: 'Preço', operator: 'equals' }] }) }))
    expect(cfg(g, 'c__cond_0').condition).toBe(`${REF_TRIGGER} === "Preço"`)
  })

  it('C10 valor com aspas/quebra de linha/barra vira literal escapado e passa no guard do servidor', () => {
    const g = compileFlow(makeFlow({ root: steps.condition({ id: 'c', branches: [{ label: 'x', value: 'a"b\\c\nd' }] }) }))
    expect(cfg(g, 'c__cond_0').condition).toBe(`${REF_TRIGGER}.includes("a\\"b\\\\c\\nd")`)
    expect(findWorkflowGraphIssues(g.nodes)).toEqual([])
  })

  it('C10 operador desconhecido e duas branches "None" → FlowCompileError', () => {
    const regex = steps.condition({ id: 'c', branches: [{ label: 'r', value: '.*' }] })
    regex.branches![0].operator = 'regex'
    expect(compileError(makeFlow({ root: regex })).message).toContain('operador não suportado "regex"')

    const twoNone = steps.condition({ id: 'c', branches: [{ label: 'x', value: 'x' }] })
    twoNone.branches!.push({ id: 'c-none-2', label: 'None 2', child: null, locked: true })
    expect(compileError(makeFlow({ root: twoNone })).message).toContain('só uma branch "None"')
  })

  it('C10 sem branch "None" travada ganha o fallback __cond_none ("Outra resposta") ligado à continuação', () => {
    const g = compileFlow(
      makeFlow({
        root: chain(
          steps.condition({ id: 'c', noneBranch: false, branches: [{ label: 'x', value: 'x', child: steps.end() }] }),
          steps.whatsapp({ id: 'depois', message: 'depois' })
        ),
      })
    )
    expect(node(g, 'c__cond_none').data.label).toBe('Outra resposta')
    expect(targetsOf(g, 'c__cond_none')).toEqual(['depois'])
  })

  // Corrigido BUG(condicao-valor-vazio): a condição criada pela tela (operations.createStep: operator
  // "contains", value "") compila para `.includes("")`, que é SEMPRE true: todo contato vai para a
  // "Branch 1" e a "None" nunca roda. O compile recusa whatsapp/tag/pipeline vazios; o correto é
  // recusar também a branch sem valor (contains/equals com "" não tem sentido para o usuário).
  it('C18 condicao-valor-vazio: condição com valor vazio deveria falhar no compile', () => {
    const { flow, stepId } = addStep(createEmptyFlow({ keywords: ['oi'] }), { type: 'condition', slot: { kind: 'root' } })
    expect(stepId).not.toBe('')
    expect(() => compileFlow(flow)).toThrow(FlowCompileError)
  })
})

describe('compileFlow — end, split, goto e cadeias vazias', () => {
  it('C13 root END e root null: só o nó trigger, nenhuma edge', () => {
    for (const root of [steps.end(), null]) {
      const g = compileFlow(makeFlow({ root }))
      expect(ids(g)).toEqual(['__trigger'])
      expect(g.edges).toEqual([])
    }
  })

  it('C13 END numa branch corta a convergência só daquela branch', () => {
    const g = compileFlow(
      makeFlow({
        root: chain(
          steps.condition({ id: 'c', branches: [{ label: 'x', value: 'x', child: steps.end() }] }),
          steps.whatsapp({ id: 'depois', message: 'depois' })
        ),
      })
    )
    expect(targetsOf(g, 'c__cond_0')).toEqual([])
    expect(targetsOf(g, 'c__cond_none')).toEqual(['depois'])
  })

  it('C13 split e goto → "não é suportado no v1"; goto com next → árvore inválida', () => {
    const split = steps.split({ id: 's', paths: [{ label: 'A', percent: 50 }, { label: 'B', percent: 50 }] })
    expect(compileError(makeFlow({ root: split }))).toMatchObject({ stepId: 's', message: expect.stringContaining('não é suportado no v1') })

    const target = steps.whatsapp({ id: 'alvo', message: 'x' })
    const gotoOk = chain(target, steps.goto({ id: 'g', targetId: 'alvo' }))
    expect(compileError(makeFlow({ root: gotoOk })).message).toContain('não é suportado no v1')

    const gotoWithNext = steps.goto({ id: 'g', targetId: null })
    gotoWithNext.next = steps.whatsapp({ id: 'x', message: 'x' })
    expect(compileError(makeFlow({ root: gotoWithNext })).message).toMatch(/^Árvore inválida: .*não pode ter continuação/)
  })
})

describe('compileFlow — tag / tag_remove / pipeline', () => {
  it('C14 tag: trim + dedupe + sem vazias; tagName legado; tag_remove', () => {
    const g = compileFlow(
      makeFlow({
        root: chain(
          steps.tag({ id: 't', tags: [' vip ', 'vip', '', 'lead'] }),
          { id: 'legado', type: 'tag', name: 'Tag antiga', config: { tagName: ' x ' }, next: null },
          steps.tagRemove({ id: 'r', tags: ['frio'] })
        ),
      })
    )
    expect(cfg(g, 't')).toEqual({ actionType: 'contacts/add-tag', toSource: 'inbound', tags: ['vip', 'lead'] })
    expect(cfg(g, 'legado')).toEqual({ actionType: 'contacts/add-tag', toSource: 'inbound', tags: ['x'] })
    expect(cfg(g, 'r')).toEqual({ actionType: 'contacts/remove-tag', toSource: 'inbound', tags: ['frio'] })
    expect(g.edges.map((e) => e.id)).toEqual(['e-legado-r', 'e-t-legado', 'e-__trigger-t'])
  })

  it('C14 tag sem tags válidas → FlowCompileError', () => {
    expect(compileError(makeFlow({ root: steps.tag({ id: 't', tags: [' ', ''] }) })).stepId).toBe('t')
    expect(compileError(makeFlow({ root: steps.tagRemove({ id: 'r', tags: [] }) })).stepId).toBe('r')
  })

  it('C14 pipeline → crm/move-pipeline com ids, status default "open" e nomes denormalizados', () => {
    const p = steps.pipeline({ id: 'p', pipelineId: ' pl_vendas ', stageId: 'pls_novo', oppName: 'Lead do fluxo' })
    delete p.config.oppStatus
    const g = compileFlow(makeFlow({ root: p }))
    expect(cfg(g, 'p')).toEqual({
      actionType: 'crm/move-pipeline',
      toSource: 'inbound',
      pipelineId: 'pl_vendas',
      stageId: 'pls_novo',
      oppStatus: 'open',
      pipelineName: 'Vendas',
      stageName: 'Novo lead',
      oppName: 'Lead do fluxo',
    })
    expect(compileError(makeFlow({ root: steps.pipeline({ id: 'p', stageId: '' }) })).stepId).toBe('p')
    expect(compileError(makeFlow({ root: steps.pipeline({ id: 'p', pipelineId: ' ' }) })).stepId).toBe('p')
  })
})

// ─── Ids e edges ───────────────────────────────────────────────────────────────

function bigTree(): Flow {
  return makeFlow({
    trigger: triggers.keywords(['oi']),
    root: chain(
      steps.whatsapp({ id: 'w1', message: 'Olá' }),
      steps.interactive({
        id: 'ask',
        message: 'Quer?',
        buttons: [{ label: 'Sim', child: steps.tag({ id: 't1', tags: ['quente'] }) }, 'Não'],
      }),
      steps.condition({
        id: 'c',
        branches: [
          { label: 'Plano', value: 'plano', child: steps.pipeline({ id: 'p1' }) },
          { label: 'Sair', value: 'sair', operator: 'equals', child: steps.end() },
        ],
        none: steps.wait({ id: 'wt', value: 5 }),
      }),
      steps.whatsapp({ id: 'w2', message: 'Fim' })
    ),
  })
}

describe('compileFlow — ids estáveis e formato das edges', () => {
  it('C15 compilar 2x a mesma árvore dá o mesmo grafo (determinístico)', () => {
    expect(compileFlow(bigTree())).toEqual(compileFlow(bigTree()))
  })

  it('C15 renomear passos/branches de condição não muda ids nem edges', () => {
    const base = compileFlow(bigTree())
    const renamed = structuredClone(bigTree())
    const rename = (s: Step | null) => {
      if (!s) return
      s.name = `${s.name} (renomeado)`
      if (s.type === 'condition') for (const b of s.branches ?? []) b.label = `${b.label}!`
      for (const b of s.branches ?? []) rename(b.child)
      rename(s.next)
    }
    rename(renamed.root)
    const g = compileFlow(renamed)
    expect(ids(g)).toEqual(ids(base))
    expect(g.edges).toEqual(base.edges)
  })

  it('C15 reordenar branches muda o sufixo __cond_<i> (o id vem do ÍNDICE, não do branch.id) — documentado', () => {
    const tree = bigTree()
    const c = tree.root!.next!.next! // w1 → ask → c
    expect(c.id).toBe('c')
    const before = compileFlow(tree)
    expect(cfg(before, 'c__cond_0').condition).toContain('"plano"')
    ;[c.branches![0], c.branches![1]] = [c.branches![1], c.branches![0]]
    const after = compileFlow(tree)
    expect(cfg(after, 'c__cond_0').condition).toContain('"sair"')
    expect(targetsOf(after, 'c__cond_1')).toEqual(['p1'])
  })

  it('C15 toda edge é exatamente { id, source, target } com id `e-<source>-<target>`, única e sem sourceHandle', () => {
    const g = compileFlow(bigTree())
    const nodeIds = new Set(ids(g))
    expect(new Set(g.edges.map((e) => e.id)).size).toBe(g.edges.length)
    expect(nodeIds.size).toBe(g.nodes.length)
    for (const e of g.edges as Array<CompiledEdge & Record<string, unknown>>) {
      expect(Object.keys(e).sort()).toEqual(['id', 'source', 'target'])
      expect(e.id).toBe(`e-${e.source}-${e.target}`)
      expect(nodeIds.has(e.source) && nodeIds.has(e.target)).toBe(true)
      expect(e.sourceHandle).toBeUndefined()
    }
  })

  it('C15 árvore grande: ids derivados de step.id e nenhum nó de action sem actionType', () => {
    const g = compileFlow(bigTree())
    expect(ids(g)).toEqual([
      '__trigger',
      'w1',
      'w2',
      'c__cond_0',
      'p1',
      'c__cond_1',
      'c__cond_none',
      'wt',
      'ask',
      'ask__var',
      'ask__cond_0',
      't1',
      'ask__cond_1',
      'ask__cond_else',
    ])
    for (const n of g.nodes.filter((x) => x.data.type === 'action')) expect(typeof n.data.config.actionType).toBe('string')
  })
})

// ─── Invariantes de grafo (bugs) ───────────────────────────────────────────────

describe('compileFlow — invariantes do grafo executável', () => {
  /** Condição em que TODAS as branches (inclusive a None) terminam em END, com um passo depois. */
  function allEndsThenNext(): Flow {
    return makeFlow({
      root: chain(
        steps.condition({ id: 'c', branches: [{ label: 'Tem x', value: 'x', child: steps.end() }], none: steps.end() }),
        steps.whatsapp({ id: 'obrigado', message: 'Obrigado' })
      ),
    })
  }

  // Corrigido BUG(orphan-next): o executor (workflow-executor.workflow.ts, readyQueue inicial) roda como RAIZ
  // todo nó com 0 arestas de entrada. O passo "obrigado" acima é órfão: é executado no início de
  // TODA execução (envia "Obrigado" antes até da condição), enquanto o canvas o desenha depois
  // dela. A tela permite montar isso (END entra em qualquer branch vazia). Correto: nenhum nó
  // não-trigger sem entrada — o next inalcançável não deveria ser emitido (ou ser recusado).
  it('C11 orphan-next: todo nó não-trigger deveria ter ≥1 edge de entrada', () => {
    const g = compileFlow(allEndsThenNext())
    const orphans = g.nodes.filter((n) => n.id !== TRIGGER_NODE_ID && sourcesOf(g, n.id).length === 0).map((n) => n.id)
    expect(orphans).toEqual([])
  })

  it('C11 (controle) a árvore grande e as de cada passo não têm órfãos', () => {
    const g = compileFlow(bigTree())
    const orphans = g.nodes.filter((n) => n.id !== TRIGGER_NODE_ID && sourcesOf(g, n.id).length === 0)
    expect(orphans).toEqual([])
  })

  /** C1{ B1 contém "aju" → Perguntar(Sim), None } → next C2{ contém "aju" → W, None → W2 }. */
  function askInsideBranchThenCondition(): Flow {
    return makeFlow({
      trigger: triggers.keywords(['ajuda']),
      root: chain(
        steps.condition({
          id: 'c1',
          branches: [{ label: 'Ajuda', value: 'aju', child: steps.interactive({ id: 'ask', message: 'Falar com alguém?', buttons: ['Sim'] }) }],
        }),
        steps.condition({
          id: 'c2',
          branches: [{ label: 'Ajuda', value: 'aju', child: steps.whatsapp({ id: 'w', message: 'Encaminhando' }) }],
          none: steps.whatsapp({ id: 'w2', message: 'Ok' }),
        })
      ),
    })
  }

  it('C12 a condição da convergência (alcançável a partir do resume) usa a mensagem do gatilho persistida nas variáveis', () => {
    const g = compileFlow(askInsideBranchThenCondition())
    const fromResume = reachableFrom(g, 'ask__var')
    expect(fromResume.has('c2__cond_0')).toBe(true)
    expect(String(cfg(g, 'c2__cond_0').condition)).toBe('{{var.__trigger_message}}.includes("aju")')
    expect(nodeRefs(String(cfg(g, 'c2__cond_0').condition))).toEqual([])
    // a condição da RAIZ (só roda na execução inicial) continua lendo a saída do gatilho
    expect(nodeRefs(String(cfg(g, 'c1__cond_0').condition))).toEqual(['__trigger'])
  })

  // Corrigido BUG(resume-trigger-ref): no resume a rota (app/api/builder/workflow/[id]/resume) executa a partir
  // de "ask__var" SEM initialOutputs; outputs.__trigger não existe, o template {{@__trigger:...}}
  // fica literal, a validação falha e c2__cond_0 E c2__cond_none dão false — o fluxo morre em
  // silêncio depois da resposta. Correto: toda Condition alcançável a partir de um nó de resume só
  // referencia saídas de nós que também rodam nesse resume (ou variáveis persistidas {{var.*}}).
  it('C12 resume-trigger-ref: condições alcançáveis do resume não deveriam referenciar nós fora dele', () => {
    const g = compileFlow(askInsideBranchThenCondition())
    const violations: string[] = []
    for (const resumeRoot of ids(g).filter((id) => id.endsWith('__var'))) {
      const reach = reachableFrom(g, resumeRoot)
      for (const id of reach) {
        const c = cfg(g, id)
        if (c.actionType !== 'Condition') continue
        for (const ref of nodeRefs(String(c.condition))) if (!reach.has(ref)) violations.push(`${resumeRoot} → ${id} usa {{@${ref}}}`)
      }
    }
    expect(violations).toEqual([])
  })

  it('C12 (controle) Perguntar no root seguido de condição usa {{var.*}} e não viola a invariante', () => {
    const g = compileFlow(
      makeFlow({
        root: chain(
          steps.interactive({ id: 'ask', message: 'Plano?', buttons: ['A'] }),
          steps.condition({ id: 'c', branches: [{ label: 'x', value: 'x' }] })
        ),
      })
    )
    const reach = reachableFrom(g, 'ask__var')
    for (const id of reach) {
      const c = cfg(g, id)
      if (c.actionType === 'Condition') for (const ref of nodeRefs(String(c.condition))) expect(reach.has(ref)).toBe(true)
    }
  })
})

// ─── Matriz gatilho × passo ↔ schema e guard do servidor ──────────────────────

const ROOTS: Record<string, () => Step> = {
  'whatsapp (mensagem)': () => steps.whatsapp({ id: 'w', message: 'Olá {{var.nome}}' }),
  'whatsapp (template)': () => steps.whatsapp({ id: 'w', template: 'boas_vindas' }),
  'whatsapp (mídia)': () => steps.whatsapp({ id: 'w', mediaUrl: 'https://cdn.test/a.jpg', message: 'legenda' }),
  interactive: () => steps.interactive({ id: 'q', message: 'Sim ou não?', buttons: ['Sim', { label: 'Não', child: steps.end() }] }),
  wait: () => chain(steps.wait({ id: 'wt', value: 3, unit: 'hours' }), steps.whatsapp({ id: 'w', message: 'voltei' }))!,
  condition: () => steps.condition({ id: 'c', branches: [{ label: 'Preço', value: 'preço', child: steps.whatsapp({ id: 'w', message: 'R$ 10' }) }] }),
  tag: () => steps.tag({ id: 't', tags: ['vip'] }),
  tag_remove: () => steps.tagRemove({ id: 't', tags: ['frio'] }),
  pipeline: () => steps.pipeline({ id: 'p' }),
  end: () => steps.end({ id: 'e' }),
}
const TRIGGERS: Record<string, () => FlowTrigger> = {
  none: () => triggers.none(),
  keywords: () => triggers.keywords(['oi']),
  legado: () => triggers.legacyKeywords(['oi']),
  campaign_reply: () => triggers.campaignReply({ campaignId: 'c_promo', replyFilter: 'quero' }),
}
const MATRIX = Object.keys(TRIGGERS).flatMap((t) => Object.keys(ROOTS).map((s) => [t, s] as const))

describe('C16 matriz gatilho × passo: todo grafo compilável passa no schema e no graph guard', () => {
  it.each(MATRIX)('gatilho %s × passo %s', (t, s) => {
    const g = compileFlow(makeFlow({ trigger: TRIGGERS[t](), root: ROOTS[s]() }))
    const schema = validateWorkflowSchema({ nodes: g.nodes, edges: g.edges })
    expect(schema.success, JSON.stringify(schema)).toBe(true)
    expect(findWorkflowGraphIssues(g.nodes)).toEqual([])
    expect(triggerNodes(g)).toHaveLength(1)
    for (const n of g.nodes.filter((x) => x.data.type === 'action')) {
      const actionType = String(n.data.config.actionType)
      if ((SYSTEM_ACTION_TYPES as readonly string[]).includes(actionType)) continue
      expect(getStepImporter(actionType), `sem importer: ${actionType}`).not.toBeNull()
    }
  })
})

// ─── meta.ts ↔ compile ─────────────────────────────────────────────────────────

describe('C17 meta.ts ↔ compile', () => {
  const ALL: StepType[] = ['whatsapp', 'interactive', 'wait', 'condition', 'split', 'tag', 'tag_remove', 'pipeline', 'goto', 'end']

  it('PICKER_ORDER é permutação dos 10 StepType e STEP_META cobre todos', () => {
    expect([...PICKER_ORDER].sort()).toEqual([...ALL].sort())
    expect(Object.keys(STEP_META).sort()).toEqual([...ALL].sort())
  })

  it('enabledV1 false ⇔ o compile recusa com "não é suportado no v1" (default do createStep)', () => {
    for (const type of ALL) {
      const { flow } = addStep(createEmptyFlow({ keywords: ['oi'] }), { type, slot: { kind: 'root' } })
      let message: string | null = null
      try {
        compileFlow(flow)
      } catch (error) {
        expect(error).toBeInstanceOf(FlowCompileError)
        message = (error as Error).message
      }
      const unsupported = message?.includes('não é suportado no v1') ?? false
      expect(unsupported, `tipo ${type}`).toBe(!STEP_META[type].enabledV1)
    }
  })

  it('defaults do createStep: whatsapp/interactive/condition/tag/tag_remove/pipeline vazios falham; wait/end compilam', () => {
    const outcome = (type: StepType) => {
      const { flow } = addStep(createEmptyFlow({ keywords: ['oi'] }), { type, slot: { kind: 'root' } })
      try {
        compileFlow(flow)
        return 'ok'
      } catch {
        return 'erro'
      }
    }
    expect(Object.fromEntries(ALL.map((t) => [t, outcome(t)]))).toEqual({
      whatsapp: 'erro',
      interactive: 'erro',
      wait: 'ok',
      condition: 'erro', // C18: branch sem valor não compila
      split: 'erro',
      tag: 'erro',
      tag_remove: 'erro',
      pipeline: 'erro',
      goto: 'erro',
      end: 'ok',
    })
  })

  it('CONDITION_OPERATORS: toda chave é aceita pelo compile', () => {
    expect(Object.keys(CONDITION_OPERATORS)).toEqual(['contains', 'not_contains', 'equals'])
    for (const operator of Object.keys(CONDITION_OPERATORS)) {
      const c = steps.condition({ id: 'c', branches: [{ label: 'x', value: 'x', operator: operator as 'contains' }] })
      expect(() => compileFlow(makeFlow({ root: c }))).not.toThrow()
    }
  })

  it('createEmptyFlow() (fluxo novo da tela) compila para trigger None sem passos', () => {
    const g = compileFlow(createEmptyFlow({ id: 'novo' }))
    expect(g).toMatchObject({ nodes: [{ id: '__trigger', data: { config: { triggerType: 'None' } } }], edges: [] })
  })
})

// ─── Guard do servidor (workflow-graph-guard) ─────────────────────────────────

const MALICIOUS = '{{@__trigger:Gatilho.message}}["constructor"]["constructor"]("return process.env")()'
const actionNode = (id: string, actionType: unknown, label = id) => ({ id, type: 'action', position: { x: 0, y: 0 }, data: { type: 'action', label, config: { actionType } } })
const conditionNode = (id: string, condition: unknown, label = id) => ({
  id,
  type: 'action',
  position: { x: 0, y: 0 },
  data: { type: 'action', label, config: { actionType: 'Condition', condition } },
})

describe('G01 workflow-graph-guard', () => {
  it('ação fora da allowlist, condição maliciosa e condição não-string viram issues; ações vêm primeiro', () => {
    const issues = findWorkflowGraphIssues([
      conditionNode('c1', MALICIOUS, 'Cond'),
      actionNode('db', 'Database Query', 'Consulta'),
      conditionNode('c2', 42),
      actionNode('n', 7),
    ])
    expect(issues.map((i) => [i.kind, i.nodeId])).toEqual([
      ['action', 'db'],
      ['action', 'n'],
      ['condition', 'c1'],
      ['condition', 'c2'],
    ])
    expect(issues[0]).toEqual({ nodeId: 'db', label: 'Consulta', kind: 'action', error: 'Action type "Database Query" is not supported' })
    expect(issues[1].error).toBe('Action type must be a string')
    expect(issues[3].error).toBe('Condition must be a string expression or a boolean')
    expect(describeWorkflowGraphIssues(issues)).toBe(
      'Ação não suportada no nó "Consulta": Action type "Database Query" is not supported (e mais 3 problema(s) no fluxo)'
    )
    expect(workflowGraphIssuesBody(issues)).toEqual({ error: describeWorkflowGraphIssues(issues), details: issues })
  })

  it('condição booleana/ausente, actionType vazio e nodes não-array passam; label vazio usa o id', () => {
    expect(findWorkflowGraphIssues([conditionNode('c', true), conditionNode('d', undefined), actionNode('x', '')])).toEqual([])
    expect(findWorkflowGraphIssues(null)).toEqual([])
    expect(findWorkflowGraphIssues({ nodes: [] })).toEqual([])
    const [issue] = findWorkflowGraphIssues([conditionNode('sem-label', MALICIOUS, '')])
    expect(describeWorkflowGraphIssues([issue])).toMatch(/^Condição inválida no nó "sem-label": /)
    expect(describeWorkflowGraphIssues([])).toBe('')
  })

  it('aliases legados do executor ("Send Message") são aceitos; o grafo legado do buildDefaultGraph passa', () => {
    expect(findWorkflowGraphIssues([actionNode('a', 'Send Message'), actionNode('b', 'whatsapp/send-message')])).toEqual([])
  })

  it('G02 (fato) o guard NÃO olha a estrutura: ciclo, nó órfão e 0 triggers passam', () => {
    const cyclic = [actionNode('a', 'Delay'), actionNode('b', 'Delay'), actionNode('orfao', 'Delay')]
    // sem trigger, com ciclo a→b→a (as edges nem são parâmetro do guard)
    expect(findWorkflowGraphIssues(cyclic)).toEqual([])
  })
})

// ─── workflow-schema ───────────────────────────────────────────────────────────

describe('S01 validateWorkflowSchema', () => {
  const trigger = { id: 't', type: 'trigger', position: { x: 0, y: 0 }, data: { type: 'trigger', label: 'T', config: {} } }
  const action = (id: string) => ({ id, type: 'action', position: { x: 0, y: 0 }, data: { type: 'action', label: id, config: {} } })

  it('exige exatamente 1 trigger (mensagem pt-BR com a contagem)', () => {
    const zero = validateWorkflowSchema({ nodes: [action('a')], edges: [] })
    expect(zero.success).toBe(false)
    expect(JSON.stringify(zero)).toContain('exatamente um node de gatilho (encontrado 0)')
    const two = validateWorkflowSchema({ nodes: [trigger, { ...trigger, id: 't2' }], edges: [] })
    expect(JSON.stringify(two)).toContain('(encontrado 2)')
  })

  it('edge para nó ausente, tipo de nó inválido e payload sem nodes falham', () => {
    const dangling = validateWorkflowSchema({ nodes: [trigger], edges: [{ id: 'e', source: 't', target: 'fantasma' }] })
    expect(JSON.stringify(dangling)).toContain('1 conexão(oes) com nodes ausentes')
    expect(validateWorkflowSchema({ nodes: [{ ...trigger, type: 'foo' }], edges: [] }).success).toBe(false)
    expect(validateWorkflowSchema({ edges: [] }).success).toBe(false)
  })

  it('campos extras da edge (sourceHandle) somem do data validado', () => {
    const res = validateWorkflowSchema({
      nodes: [trigger, action('a')],
      edges: [{ id: 'e', source: 't', target: 'a', sourceHandle: 'yes', type: 'animated' }],
    })
    expect(res.success).toBe(true)
    if (res.success) expect(res.data.edges).toEqual([{ id: 'e', source: 't', target: 'a', type: 'animated' }])
  })
})
