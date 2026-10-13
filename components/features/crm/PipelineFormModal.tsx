'use client'

import React, { useEffect, useId, useRef, useState } from 'react'
import { EiaButton, EiaDialog, EiaField, EiaInput } from '@/components/eia'

export interface PipelineFormModalProps {
  isOpen: boolean
  mode: 'create' | 'rename'
  /** Nome atual (modo rename) */
  initialName?: string
  isSaving: boolean
  onSubmit: (name: string) => void
  onClose: () => void
}

/** Etapas criadas por padrão quando o pipeline nasce sem etapas customizadas */
const DEFAULT_STAGES = ['Novo lead', 'Em conversa', 'Fechado']

/**
 * Diálogo de criação/renomeação de pipeline.
 * Na criação, o backend gera as etapas padrão automaticamente.
 */
export function PipelineFormModal({
  isOpen,
  mode,
  initialName = '',
  isSaving,
  onSubmit,
  onClose,
}: PipelineFormModalProps) {
  const [name, setName] = useState(initialName)
  const formId = useId()
  const nameId = useId()
  const nameRef = useRef<HTMLInputElement>(null)

  // Ressincroniza o campo ao abrir (criação limpa, renomeação preenchida)
  useEffect(() => {
    if (isOpen) setName(mode === 'rename' ? initialName : '')
  }, [isOpen, mode, initialName])

  const trimmed = name.trim()
  const canSubmit = trimmed.length > 0 && !isSaving

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (canSubmit) onSubmit(trimmed)
  }

  const isCreate = mode === 'create'

  return (
    <EiaDialog
      open={isOpen}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      size="sm"
      title={isCreate ? 'Novo pipeline' : 'Renomear pipeline'}
      description={
        isCreate ? 'Organize suas oportunidades em um novo funil.' : 'Altere o nome do pipeline atual.'
      }
      // O X do DS vem antes do corpo: o foco inicial vai direto para o campo
      initialFocus={nameRef}
      footer={
        <>
          <EiaButton variant="secondary" onClick={onClose} disabled={isSaving}>
            Cancelar
          </EiaButton>
          <EiaButton type="submit" form={formId} loading={isSaving} disabled={!trimmed}>
            {isSaving ? 'Salvando…' : isCreate ? 'Criar pipeline' : 'Salvar nome'}
          </EiaButton>
        </>
      }
    >
      <form id={formId} onSubmit={handleSubmit} className="flex flex-col gap-(--eia-space-5)">
        <EiaField label="Nome do pipeline" htmlFor={nameId} required>
          <EiaInput
            ref={nameRef}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ex.: Vendas WhatsApp"
            maxLength={80}
            autoComplete="off"
            aria-required="true"
          />
        </EiaField>

        {isCreate && (
          <p className="text-(length:--eia-type-label) leading-(--eia-line-body) text-eia-muted">
            O pipeline começa com as etapas{' '}
            <span className="font-(--eia-weight-medium) text-eia-text">{DEFAULT_STAGES.join(' → ')}</span>.
            Você pode renomear ou adicionar etapas depois.
          </p>
        )}
      </form>
    </EiaDialog>
  )
}
