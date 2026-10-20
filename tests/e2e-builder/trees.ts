// Árvores (Flow, schemaVersion 1) com ids FIXOS para semear o backend falso.
// Mesmo formato que o builder grava em workflow_versions.tree.

import { compileFlow } from '@/lib/builder/flow/compile'
import type { Branch, Flow, FlowTrigger, Step } from '@/lib/builder/flow/types'
import type { GraphEdge, GraphNode } from '@/tests/e2e-builder/fake-backend'

export function step(partial: Partial<Step> & Pick<Step, 'id' | 'type'>): Step {
  return {
    name: partial.name ?? partial.type,
    config: partial.config ?? {},
    next: partial.next ?? null,
    ...partial,
  }
}

export function branch(partial: Partial<Branch> & Pick<Branch, 'id' | 'label'>): Branch {
  return { child: null, ...partial }
}

export function flow(id: string, name: string, trigger: Partial<FlowTrigger>, root: Step | null): Flow {
  return {
    schemaVersion: 1,
    id,
    name,
    trigger: { type: 'keywords', label: 'Palavras-chave', keywords: [], ...trigger },
    root,
  }
}

/** Grafo compilado da árvore (o que o builder salvaria em nodes/edges). */
export function compiled(tree: Flow): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const out = compileFlow(tree)
  return { nodes: out.nodes as unknown as GraphNode[], edges: out.edges as unknown as GraphEdge[] }
}

/** Duas mensagens em sequência: A → B (para inserir no meio). */
export function twoMessagesTree(id = 'wf-two'): Flow {
  return flow(
    id,
    'Duas mensagens',
    { keywords: ['oi'] },
    step({
      id: 'msgA',
      type: 'whatsapp',
      name: 'Mensagem A',
      config: { template: '', mediaUrl: '', message: 'Olá! Primeira mensagem.' },
      next: step({
        id: 'msgB',
        type: 'whatsapp',
        name: 'Mensagem B',
        config: { template: '', mediaUrl: '', message: 'Segunda mensagem.' },
      }),
    })
  )
}

/**
 * Fluxo ramificado "realista": boas-vindas → pergunta (Sim / Não / Talvez) →
 * espera → pipeline. "Sim" aplica tag e encerra; "Não" tem uma condição com
 * mensagem na 1ª branch; "Talvez" fica vazia.
 */
export function branchedTree(id = 'wf-branched'): Flow {
  return flow(
    id,
    'Fluxo ramificado',
    { keywords: ['quero', 'oi'] },
    step({
      id: 'welcome',
      type: 'whatsapp',
      name: 'Boas-vindas',
      config: { template: '', mediaUrl: '', message: 'Olá {{var.nome}}! Tudo bem?' },
      next: step({
        id: 'ask',
        type: 'interactive',
        name: 'Quer saber mais?',
        config: { message: 'Quer receber a proposta?' },
        branches: [
          branch({
            id: 'b-sim',
            label: 'Sim',
            child: step({
              id: 'tagVip',
              type: 'tag',
              name: 'Marca VIP',
              config: { tags: ['vip'] },
              next: step({ id: 'endSim', type: 'end', name: 'END' }),
            }),
          }),
          branch({
            id: 'b-nao',
            label: 'Não',
            child: step({
              id: 'cond',
              type: 'condition',
              name: 'Falou de preço?',
              branches: [
                branch({
                  id: 'c-preco',
                  label: 'Preço',
                  field: 'Replied message',
                  operator: 'contains',
                  value: 'preço',
                  child: step({
                    id: 'msgPreco',
                    type: 'whatsapp',
                    name: 'Tabela de preços',
                    config: { template: 'lembrete_pagamento', mediaUrl: '', message: '' },
                  }),
                }),
                branch({ id: 'c-none', label: 'None', locked: true }),
              ],
            }),
          }),
          branch({ id: 'b-talvez', label: 'Talvez' }),
        ],
        next: step({
          id: 'wait2',
          type: 'wait',
          name: 'Aguardar 2 min',
          config: { mode: 'duration', value: 2, unit: 'minutes' },
          next: step({
            id: 'pipe',
            type: 'pipeline',
            name: 'Mover no pipeline',
            config: {
              pipelineId: 'pipe-vendas',
              pipelineName: 'Vendas',
              stageId: 'stage-novo',
              stageName: 'Novo lead',
              oppStatus: 'open',
            },
          }),
        }),
      }),
    })
  )
}

/** Pergunta com sub-árvore numa branch e continuação (para deletar com filhos). */
export function askWithChildrenTree(id = 'wf-ask-children'): Flow {
  return flow(
    id,
    'Pergunta com filhos',
    { keywords: ['menu'] },
    step({
      id: 'ask2',
      type: 'interactive',
      name: 'Menu principal',
      config: { message: 'Escolha uma opção' },
      branches: [
        branch({
          id: 'o1',
          label: 'Comprar',
          child: step({
            id: 'buyMsg',
            type: 'whatsapp',
            name: 'Link de compra',
            config: { template: '', mediaUrl: '', message: 'Compre aqui: https://exemplo.test' },
          }),
        }),
        branch({ id: 'o2', label: 'Suporte' }),
      ],
      next: step({
        id: 'after',
        type: 'whatsapp',
        name: 'Depois do menu',
        config: { template: '', mediaUrl: '', message: 'Obrigado!' },
      }),
    })
  )
}

/** Passo WhatsApp vazio (não compila) — publicação deve ser bloqueada. */
export function invalidTree(id = 'wf-invalid'): Flow {
  return flow(
    id,
    'Fluxo inválido',
    { keywords: ['oi'] },
    step({ id: 'emptyMsg', type: 'whatsapp', name: 'Mensagem vazia', config: { template: '', mediaUrl: '', message: '' } })
  )
}
