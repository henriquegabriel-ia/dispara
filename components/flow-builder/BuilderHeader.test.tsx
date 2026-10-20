import React from 'react'
import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Cabeçalho do builder: renomear o fluxo (Enter/blur, Esc cancela), Desfazer,
 * indicador de save, badge da versão publicada e botão Publicar.
 */

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

import BuilderHeader, { type SaveState } from '@/components/flow-builder/BuilderHeader'
import { useFlowBuilderStore } from '@/components/flow-builder/store'
import { createEmptyFlow } from '@/lib/builder/flow/operations'

const store = () => useFlowBuilderStore.getState()

function renderHeader(props: Partial<{ saveState: SaveState; publishedVersion: number | null; publishing: boolean }> = {}) {
  const onPublish = vi.fn()
  const onOpenSettings = vi.fn()
  const utils = render(
    <BuilderHeader
      saveState={props.saveState ?? 'idle'}
      publishedVersion={props.publishedVersion ?? null}
      publishing={props.publishing ?? false}
      onPublish={onPublish}
      onOpenSettings={onOpenSettings}
    />
  )
  return { ...utils, onPublish, onOpenSettings }
}

const nameButton = () => screen.getByTitle(store().flow?.name ?? '') as HTMLButtonElement
const nameField = () => screen.getByRole('textbox') as HTMLInputElement
const undoBtn = () => screen.getByTitle('Desfazer (Cmd+Z)') as HTMLButtonElement
const publishBtn = () => screen.getByRole('button', { name: /Publicar|Publicando/ }) as HTMLButtonElement

beforeEach(() => store().reset())
afterEach(() => cleanup())

// ─── BH-01 ─────────────────────────────────────────────────────────────────────

describe('BH-01 renomear o fluxo', () => {
  it('sem flow mostra "Carregando…", não entra em edição e Publicar fica desabilitado', () => {
    renderHeader()
    fireEvent.click(screen.getByText('Carregando…'))
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(publishBtn()).toBeDisabled()
    expect(screen.getByRole('link', { name: /Workflows/ })).toHaveAttribute('href', '/workflows')
  })

  it('Enter grava o nome com trim (config → debounce)', () => {
    store().loadFlow(createEmptyFlow({ id: 'wf', name: 'Fluxo A' }))
    renderHeader()
    fireEvent.click(nameButton())
    expect(nameField().value).toBe('Fluxo A')
    fireEvent.change(nameField(), { target: { value: '  Novo  ' } })
    fireEvent.keyDown(nameField(), { key: 'Enter' })
    expect(store().flow!.name).toBe('Novo')
    expect(store()).toMatchObject({ rev: 1, saveMode: 'config' })
    expect(screen.getByText('Novo')).toBeInTheDocument()
  })

  it('blur também grava', () => {
    store().loadFlow(createEmptyFlow({ id: 'wf', name: 'Fluxo A' }))
    renderHeader()
    fireEvent.click(nameButton())
    fireEvent.change(nameField(), { target: { value: 'Pelo blur' } })
    fireEvent.blur(nameField())
    expect(store().flow!.name).toBe('Pelo blur')
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it.each([
    ['vazio', ''],
    ['só espaços', '   '],
    ['igual', 'Fluxo A'],
    ['igual com espaços', '  Fluxo A '],
  ])('%s não grava', (_, value) => {
    store().loadFlow(createEmptyFlow({ id: 'wf', name: 'Fluxo A' }))
    renderHeader()
    fireEvent.click(nameButton())
    fireEvent.change(nameField(), { target: { value } })
    fireEvent.keyDown(nameField(), { key: 'Enter' })
    expect(store().flow!.name).toBe('Fluxo A')
    expect(store().rev).toBe(0)
  })

  it('Esc sai sem gravar', () => {
    store().loadFlow(createEmptyFlow({ id: 'wf', name: 'Fluxo A' }))
    renderHeader()
    fireEvent.click(nameButton())
    fireEvent.change(nameField(), { target: { value: 'Descartado' } })
    fireEvent.keyDown(nameField(), { key: 'Escape' })
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(store().flow!.name).toBe('Fluxo A')
    expect(store().rev).toBe(0)
  })
})

// ─── BH-02 ─────────────────────────────────────────────────────────────────────

describe('BH-02 desfazer, status, versão e publicar', () => {
  it('Desfazer desabilitado sem histórico; habilita após mutação e chama undo', () => {
    store().loadFlow(createEmptyFlow({ id: 'wf', name: 'Fluxo A' }))
    renderHeader()
    expect(undoBtn()).toBeDisabled()
    act(() => store().renameFlow('B'))
    expect(undoBtn()).not.toBeDisabled()
    fireEvent.click(undoBtn())
    expect(store().flow!.name).toBe('Fluxo A')
    expect(undoBtn()).toBeDisabled()
  })

  it.each<[SaveState, string]>([
    ['idle', 'Salvo'],
    ['saving', 'Salvando…'],
    ['saved', 'Salvo'],
    ['error', 'Erro ao salvar'],
  ])('saveState %s → "%s"', (state, text) => {
    store().loadFlow(createEmptyFlow())
    renderHeader({ saveState: state })
    expect(screen.getByText(text)).toBeInTheDocument()
  })

  it('badge da versão publicada só quando existe', () => {
    store().loadFlow(createEmptyFlow())
    const { rerender, onPublish, onOpenSettings } = renderHeader({ publishedVersion: null })
    expect(screen.queryByText(/publicada/)).not.toBeInTheDocument()
    rerender(<BuilderHeader saveState="saved" publishedVersion={3} publishing={false} onPublish={onPublish} onOpenSettings={onOpenSettings} />)
    expect(screen.getByText('v3 publicada')).toBeInTheDocument()
  })

  it('Publicar chama o callback; publicando mostra "Publicando…" e desabilita', () => {
    store().loadFlow(createEmptyFlow())
    const { onPublish, onOpenSettings, rerender } = renderHeader()
    fireEvent.click(publishBtn())
    expect(onPublish).toHaveBeenCalledTimes(1)
    rerender(<BuilderHeader saveState="saving" publishedVersion={null} publishing onPublish={onPublish} onOpenSettings={onOpenSettings} />)
    expect(publishBtn()).toHaveTextContent('Publicando…')
    expect(publishBtn()).toBeDisabled()
    fireEvent.click(publishBtn())
    expect(onPublish).toHaveBeenCalledTimes(1)
  })

  it('Configurações abre a sheet; "Testar workflow" fica desabilitado (Em breve)', () => {
    store().loadFlow(createEmptyFlow())
    const { onOpenSettings } = renderHeader()
    fireEvent.click(screen.getByTitle('Configurações do workflow'))
    expect(onOpenSettings).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Testar workflow' })).toBeDisabled()
  })
})

// ─── BH-05 ─────────────────────────────────────────────────────────────────────

describe('BH-05 refazer e pendências', () => {
  it('Refazer fica habilitado depois de desfazer e refaz', () => {
    store().loadFlow(createEmptyFlow({ id: 'wf', name: 'A' }))
    renderHeader()
    const redo = screen.getByTitle('Refazer (Cmd+Shift+Z)') as HTMLButtonElement
    expect(redo).toBeDisabled()
    act(() => store().renameFlow('B'))
    fireEvent.click(undoBtn())
    expect(store().flow!.name).toBe('A')
    expect(redo).not.toBeDisabled()
    fireEvent.click(redo)
    expect(store().flow!.name).toBe('B')
  })

  it('"N pendências" lista o que falta e abre o gatilho/passo ao clicar', () => {
    const flow = createEmptyFlow({ id: 'wf', name: 'A' })
    store().loadFlow({
      ...flow,
      trigger: { type: 'keywords', label: 'Palavras-chave', keywords: [] },
      root: { id: 'w', type: 'whatsapp', name: 'Boas-vindas', config: { message: '' }, next: null },
    })
    renderHeader()
    fireEvent.click(screen.getByRole('button', { name: '2 pendências para publicar' }))
    const items = screen.getAllByRole('button').filter((b) => b.closest('[role="dialog"]'))
    expect(items.map((b) => b.textContent)).toEqual([
      'Gatilho de palavra-chave sem nenhuma palavra: o fluxo nunca dispararia.',
      'Passo WhatsApp "Boas-vindas" está vazio: escolha um template ou escreva a mensagem.',
    ])
    fireEvent.click(items[1])
    expect(store().selectedStepId).toBe('w')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('sem pendências o botão não aparece', () => {
    store().loadFlow(createEmptyFlow({ id: 'wf', name: 'A' }))
    renderHeader()
    expect(screen.queryByRole('button', { name: /pendência/ })).not.toBeInTheDocument()
  })
})
