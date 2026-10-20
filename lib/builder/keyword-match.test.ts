import { describe, expect, it } from 'vitest'
import { matchesKeyword, normalizeAnswerText, normalizeKeywordText, parseKeywordList } from '@/lib/builder/keyword-match'
import { answerMatchesButton, askButtonsForResumeNode, canonicalAskAnswer } from '@/lib/builder/ask-reply'
import { phoneLookupVariants } from '@/lib/builder/phone-variants'
import type { WorkflowEdge, WorkflowNode } from '@/lib/builder/graph-types'

describe('keyword-match: a regra única do webhook e do /execute', () => {
  it('normaliza trim + minúsculas + sem acento (espaços internos preservados)', () => {
    expect(normalizeKeywordText('  Olá AÇÃO ')).toBe('ola acao')
    expect(normalizeKeywordText('quero  muito')).toBe('quero  muito')
  })

  it('parseKeywordList: uma palavra por linha, normalizada, sem vazias', () => {
    expect(parseKeywordList('Promoção\r\n\n  OI \n')).toEqual(['promocao', 'oi'])
    expect(parseKeywordList(undefined)).toEqual([])
  })

  it.each([
    ['olá', 'ola', true],
    ['Promoção', 'promocao', true],
    ['quero', '  QUERO ', true],
    ['quero', 'eu quero', false],
    ['quero muito', 'quero  muito', false],
    ['oi', '', false],
  ])('palavra "%s" × mensagem "%s" → %s', (keyword, message, expected) => {
    expect(matchesKeyword(parseKeywordList(keyword), message)).toBe(expected)
  })
})

describe('ask-reply: resposta do Perguntar casa o botão', () => {
  const graph = {
    nodes: [
      { id: 'ask', type: 'action', position: { x: 0, y: 0 }, data: { label: 'P', type: 'action', config: { actionType: 'whatsapp/ask-question', buttons: ['Sim', 'Não', 'Falar com atendente'] } } },
      { id: 'ask__var', type: 'action', position: { x: 0, y: 0 }, data: { label: 'V', type: 'action', config: { actionType: 'Get Variable' } } },
    ] as unknown as WorkflowNode[],
    edges: [{ id: 'e', source: 'ask', target: 'ask__var' }] as unknown as WorkflowEdge[],
  }

  it('acha os botões do nó que pausou (origem da aresta do nó de retomada)', () => {
    expect(askButtonsForResumeNode(graph, 'ask__var')).toEqual(['Sim', 'Não', 'Falar com atendente'])
    expect(askButtonsForResumeNode(graph, 'outro')).toEqual([])
  })

  it.each([
    ['sim', null, 'Sim'],
    ['  NAO ', null, 'Não'],
    ['falar   com ATENDENTE', null, 'Falar com atendente'],
    ['Pode ser', 'Sim', 'Sim'],
    ['talvez', null, 'talvez'],
    ['  talvez  ', 'id-desconhecido', 'talvez'],
  ])('"%s" (id %s) → "%s"', (answer, replyId, expected) => {
    const buttons = askButtonsForResumeNode(graph, 'ask__var')
    expect(canonicalAskAnswer(buttons, answer, replyId)).toBe(expected)
    expect(answerMatchesButton(buttons, answer, replyId)).toBe(buttons.includes(expected))
  })

  it('sem botões conhecidos devolve a resposta aparada', () => {
    expect(canonicalAskAnswer([], '  oi ')).toBe('oi')
    expect(normalizeAnswerText('  Sim   QUERO ')).toBe('sim quero')
  })
})

describe('phone-variants', () => {
  it('cobre o 9 brasileiro e o "+"', () => {
    expect(phoneLookupVariants('+5511988887777').sort()).toEqual(['+551188887777', '+5511988887777', '551188887777', '5511988887777'])
    expect(phoneLookupVariants('551188887777')).toContain('+5511988887777')
    expect(phoneLookupVariants('abc')).toEqual([])
  })
})
