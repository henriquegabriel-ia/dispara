'use client'

import { useEffect, useMemo, useState } from 'react'
import { Plus } from 'lucide-react'
import type { CreateLeadFormDTO, LeadForm } from '@/types'
import { EiaButton } from '@/components/eia'
import { ConfirmDeleteModal } from '@/components/app/ConfirmDeleteModal'
import { Page, PageActions, PageDescription, PageHeader, PageTitle } from '@/components/app/page'
import { CreateFormDialog } from '@/components/features/lead-forms/views/CreateFormDialog'
import { EditFormDialog } from '@/components/features/lead-forms/views/EditFormDialog'
import { FormList } from '@/components/features/lead-forms/views/FormList'
import { slugify } from '@/components/features/lead-forms/views/utils'
import { toast } from '@/lib/toast'

export interface LeadFormsViewProps {
  forms: LeadForm[]
  tags: string[]
  isLoading: boolean
  error?: string

  publicBaseUrl: string

  isCreateOpen: boolean
  setIsCreateOpen: (open: boolean) => void
  createDraft: CreateLeadFormDTO
  setCreateDraft: (dto: CreateLeadFormDTO) => void
  onCreate: () => void
  isCreating: boolean
  createError?: string

  // edit
  isEditOpen: boolean
  editDraft: CreateLeadFormDTO
  setEditDraft: (dto: CreateLeadFormDTO) => void
  onEdit: (form: LeadForm) => void
  onCloseEdit: () => void
  onSaveEdit: () => void
  isUpdating: boolean
  updateError?: string

  onDelete: (id: string) => void
  isDeleting: boolean
  deleteError?: string

  // Optional: hide header when embedded in page with its own header
  hideHeader?: boolean
}

/** Copia o link público e confirma por toast (ou explica como copiar à mão). */
async function copyPublicLink(url: string) {
  try {
    if (!navigator.clipboard?.writeText) throw new Error('Área de transferência indisponível')
    await navigator.clipboard.writeText(url)
    toast.success('Link copiado', { description: url })
  } catch {
    toast.error('Não foi possível copiar o link', {
      description: `Selecione e copie manualmente: ${url}`,
    })
  }
}

export function LeadFormsView(props: LeadFormsViewProps) {
  const {
    forms,
    tags,
    isLoading,
    error,
    publicBaseUrl,
    isCreateOpen,
    setIsCreateOpen,
    createDraft,
    setCreateDraft,
    onCreate,
    isCreating,
    createError,

    isEditOpen,
    editDraft,
    setEditDraft,
    onEdit,
    onCloseEdit,
    onSaveEdit,
    isUpdating,
    updateError,

    onDelete,
    isDeleting,
    deleteError,
    hideHeader = false,
  } = props

  // Formulário aguardando confirmação de exclusão
  const [pendingDelete, setPendingDelete] = useState<LeadForm | null>(null)

  // Fecha a confirmação quando a exclusão pedida termina (sucesso ou erro; o
  // erro aparece na lista). Estado anterior guardado em state, não em effect.
  const [wasDeleting, setWasDeleting] = useState(isDeleting)
  if (wasDeleting !== isDeleting) {
    setWasDeleting(isDeleting)
    if (wasDeleting && !isDeleting) setPendingDelete(null)
  }

  // Auto-sugerir slug a partir do nome (se slug ainda estiver vazio)
  useEffect(() => {
    if (!createDraft.name) return
    if (createDraft.slug?.trim()) return
    setCreateDraft({ ...createDraft, slug: slugify(createDraft.name) })
  }, [createDraft.name, createDraft.slug, setCreateDraft])

  const sortedTags = useMemo(() => [...tags].sort((a, b) => a.localeCompare(b, 'pt-BR')), [tags])

  const openCreate = () => setIsCreateOpen(true)

  return (
    <Page>
      {/* Cabeçalho próprio só em /forms; na aba Forms de /templates a página já tem o seu */}
      {!hideHeader && (
        <PageHeader>
          <div>
            <PageTitle>Formulários</PageTitle>
            <PageDescription>
              Crie um link público para captar contatos e aplicar uma tag automaticamente.
            </PageDescription>
          </div>
          <PageActions>
            <EiaButton leadingIcon={<Plus size={16} />} onClick={openCreate}>
              Criar formulário
            </EiaButton>
          </PageActions>
        </PageHeader>
      )}

      <CreateFormDialog
        isOpen={isCreateOpen}
        setIsOpen={setIsCreateOpen}
        draft={createDraft}
        setDraft={setCreateDraft}
        onCreate={onCreate}
        isCreating={isCreating}
        createError={createError}
        publicBaseUrl={publicBaseUrl}
        sortedTags={sortedTags}
      />

      <EditFormDialog
        isOpen={isEditOpen}
        onClose={onCloseEdit}
        draft={editDraft}
        setDraft={setEditDraft}
        onSave={onSaveEdit}
        isUpdating={isUpdating}
        updateError={updateError}
        publicBaseUrl={publicBaseUrl}
        sortedTags={sortedTags}
      />

      <FormList
        forms={forms}
        publicBaseUrl={publicBaseUrl}
        isLoading={isLoading}
        error={error}
        deleteError={deleteError}
        deletingId={isDeleting ? (pendingDelete?.id ?? null) : null}
        onCopyLink={copyPublicLink}
        onEdit={onEdit}
        onDelete={setPendingDelete}
        onCreate={openCreate}
      />

      <ConfirmDeleteModal
        isOpen={pendingDelete !== null}
        title="Excluir formulário"
        description="O link público deixa de funcionar. Os contatos já captados continuam na sua base."
        itemName={pendingDelete?.name}
        confirmText="Excluir formulário"
        isDeleting={isDeleting}
        onConfirm={() => {
          if (pendingDelete) onDelete(pendingDelete.id)
        }}
        onCancel={() => setPendingDelete(null)}
      />
    </Page>
  )
}
