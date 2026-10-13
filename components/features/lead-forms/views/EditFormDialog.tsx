'use client'

import { useRef } from 'react'
import type { CreateLeadFormDTO } from '@/types'
import { EiaButton, EiaDialog } from '@/components/eia'
import { FormDraftEditor } from '@/components/features/lead-forms/views/FormDraftEditor'

export interface EditFormDialogProps {
  isOpen: boolean
  onClose: () => void
  draft: CreateLeadFormDTO
  setDraft: (dto: CreateLeadFormDTO) => void
  onSave: () => void
  isUpdating: boolean
  updateError?: string
  publicBaseUrl: string
  sortedTags: string[]
}

/** Diálogo de edição de formulário (EiaDialog lg, controlado). */
export function EditFormDialog({
  isOpen,
  onClose,
  draft,
  setDraft,
  onSave,
  isUpdating,
  updateError,
  publicBaseUrl,
  sortedTags,
}: EditFormDialogProps) {
  const nameRef = useRef<HTMLInputElement>(null)

  return (
    <EiaDialog
      open={isOpen}
      onOpenChange={(open) => {
        // Não fecha no meio do salvamento (Escape/clique fora).
        if (!open && !isUpdating) onClose()
      }}
      size="lg"
      // O X do DS vem antes do corpo: o foco inicial vai direto para o Nome
      initialFocus={nameRef}
      title="Editar formulário"
      description="Mudar o slug muda o link público: quem tiver o link antigo não consegue mais abrir o formulário."
      footer={
        <>
          <EiaButton variant="secondary" onClick={onClose} disabled={isUpdating}>
            Cancelar
          </EiaButton>
          <EiaButton onClick={onSave} loading={isUpdating} focusableWhenDisabled>
            {isUpdating ? 'Salvando…' : 'Salvar alterações'}
          </EiaButton>
        </>
      }
    >
      <FormDraftEditor
        draft={draft}
        setDraft={setDraft}
        publicBaseUrl={publicBaseUrl}
        sortedTags={sortedTags}
        disabled={isUpdating}
        error={updateError}
        errorTitle="Não foi possível salvar as alterações"
        nameInputRef={nameRef}
      />
    </EiaDialog>
  )
}
