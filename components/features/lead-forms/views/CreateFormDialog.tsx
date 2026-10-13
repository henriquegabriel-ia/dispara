'use client'

import { useRef } from 'react'
import type { CreateLeadFormDTO } from '@/types'
import { EiaButton, EiaDialog } from '@/components/eia'
import { FormDraftEditor } from '@/components/features/lead-forms/views/FormDraftEditor'

export interface CreateFormDialogProps {
  isOpen: boolean
  setIsOpen: (open: boolean) => void
  draft: CreateLeadFormDTO
  setDraft: (dto: CreateLeadFormDTO) => void
  onCreate: () => void
  isCreating: boolean
  createError?: string
  publicBaseUrl: string
  sortedTags: string[]
}

/**
 * Diálogo de criação de formulário (EiaDialog lg, controlado).
 * O DS não tem gatilho embutido: quem abre é o botão "Criar formulário" da
 * página (LeadFormsView) ou da aba Forms em /templates.
 */
export function CreateFormDialog({
  isOpen,
  setIsOpen,
  draft,
  setDraft,
  onCreate,
  isCreating,
  createError,
  publicBaseUrl,
  sortedTags,
}: CreateFormDialogProps) {
  const nameRef = useRef<HTMLInputElement>(null)

  return (
    <EiaDialog
      open={isOpen}
      onOpenChange={(open) => {
        // Não fecha no meio do envio (Escape/clique fora); o rascunho fica no controller.
        if (!open && isCreating) return
        setIsOpen(open)
      }}
      size="lg"
      // O X do DS vem antes do corpo: o foco inicial vai direto para o Nome
      initialFocus={nameRef}
      title="Novo formulário"
      description="Defina o nome, o link e a tag aplicada a quem preencher."
      footer={
        <>
          <EiaButton variant="secondary" onClick={() => setIsOpen(false)} disabled={isCreating}>
            Cancelar
          </EiaButton>
          <EiaButton onClick={onCreate} loading={isCreating} focusableWhenDisabled>
            {isCreating ? 'Criando…' : 'Criar formulário'}
          </EiaButton>
        </>
      }
    >
      <FormDraftEditor
        draft={draft}
        setDraft={setDraft}
        publicBaseUrl={publicBaseUrl}
        sortedTags={sortedTags}
        disabled={isCreating}
        error={createError}
        errorTitle="Não foi possível criar o formulário"
        nameInputRef={nameRef}
      />
    </EiaDialog>
  )
}
