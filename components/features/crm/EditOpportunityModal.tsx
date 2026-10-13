'use client'

import React, { useEffect, useId, useRef, useState } from 'react'
import { EiaButton, EiaDialog, EiaField, EiaInput } from '@/components/eia'
import type { Opportunity } from '@/services/crmService'

export interface EditOpportunityModalProps {
  /** Oportunidade em edição (null = fechado) */
  opportunity: Opportunity | null
  isSaving: boolean
  onSubmit: (id: string, data: { name: string; value: number | null }) => void
  onClose: () => void
}

/** Diálogo de edição de oportunidade (nome e valor). */
export function EditOpportunityModal({
  opportunity,
  isSaving,
  onSubmit,
  onClose,
}: EditOpportunityModalProps) {
  const [name, setName] = useState('')
  const [valueInput, setValueInput] = useState('')
  const formId = useId()
  const nameId = useId()
  const valueId = useId()
  const nameRef = useRef<HTMLInputElement>(null)

  // Preenche o formulário quando uma oportunidade é selecionada para edição
  useEffect(() => {
    if (opportunity) {
      setName(opportunity.name)
      setValueInput(opportunity.value !== null ? String(opportunity.value) : '')
    }
  }, [opportunity])

  const parsedValue = valueInput.trim() === '' ? null : Number(valueInput.replace(',', '.'))
  const isValueInvalid = parsedValue !== null && (!Number.isFinite(parsedValue) || parsedValue < 0)
  const canSubmit = !!opportunity && name.trim().length > 0 && !isValueInvalid && !isSaving

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSubmit || !opportunity) return
    onSubmit(opportunity.id, { name: name.trim(), value: parsedValue })
  }

  return (
    <EiaDialog
      open={!!opportunity}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      title="Editar oportunidade"
      description="Altere o nome ou o valor desta oportunidade."
      // O X do DS vem antes do corpo: o foco inicial vai direto para o nome
      initialFocus={nameRef}
      footer={
        <>
          <EiaButton variant="secondary" onClick={onClose} disabled={isSaving}>
            Cancelar
          </EiaButton>
          <EiaButton
            type="submit"
            form={formId}
            loading={isSaving}
            disabled={!opportunity || !name.trim() || isValueInvalid}
          >
            {isSaving ? 'Salvando…' : 'Salvar alterações'}
          </EiaButton>
        </>
      }
    >
      <form id={formId} onSubmit={handleSubmit} className="flex flex-col gap-(--eia-space-5)">
        <EiaField label="Nome da oportunidade" htmlFor={nameId} required>
          <EiaInput
            ref={nameRef}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ex.: Proposta plano anual"
            maxLength={120}
            autoComplete="off"
            aria-required="true"
          />
        </EiaField>

        <EiaField
          label="Valor (R$, opcional)"
          htmlFor={valueId}
          error={isValueInvalid ? 'Informe um valor igual ou maior que zero.' : undefined}
        >
          <EiaInput
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0"
            value={valueInput}
            onChange={(e) => setValueInput(e.target.value)}
            placeholder="Ex.: 1500,00"
          />
        </EiaField>
      </form>
    </EiaDialog>
  )
}
