'use client'

import { useId } from 'react'
import { FileText, Plus } from 'lucide-react'
import type { LeadForm } from '@/types'
import { EiaAlert, EiaButton, EiaEmpty, EiaPanel } from '@/components/eia'
import { FormCardSkeletonList } from '@/components/features/lead-forms/FormsSkeleton'
import { FormCard } from '@/components/features/lead-forms/views/FormCard'

export interface FormListProps {
  forms: LeadForm[]
  publicBaseUrl: string
  isLoading: boolean
  error?: string
  deleteError?: string
  /** Id do formulário com exclusão em andamento (ou null) */
  deletingId?: string | null
  onCopyLink: (url: string) => void
  onEdit: (form: LeadForm) => void
  onDelete: (form: LeadForm) => void
  /** Abre a criação (ação do estado vazio) */
  onCreate?: () => void
}

const numberFormat = new Intl.NumberFormat('pt-BR')

/** Mensagem da API como frase (sem ponto duplicado antes da orientação). */
function asSentence(message: string) {
  return `${message.trim().replace(/[.!]+$/, '')}.`
}

export function FormList({
  forms,
  publicBaseUrl,
  isLoading,
  error,
  deleteError,
  deletingId = null,
  onCopyLink,
  onEdit,
  onDelete,
  onCreate,
}: FormListProps) {
  const headingId = useId()
  const count = forms.length

  return (
    <section aria-labelledby={headingId} className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <h2
            id={headingId}
            className="font-(family-name:--eia-font-display) text-(length:--eia-type-lead) font-(--eia-weight-semibold) leading-(--eia-line-control) tracking-(--eia-tracking-tight) text-eia-text"
          >
            Seus formulários
          </h2>
          <p className="mt-1 text-(length:--eia-type-control) leading-(--eia-line-body) text-eia-muted">
            Copie o link e compartilhe com seus contatos.
          </p>
        </div>
        {!isLoading && count > 0 ? (
          <p className="text-(length:--eia-type-label) text-eia-muted tabular-nums">
            {numberFormat.format(count)} {count === 1 ? 'formulário' : 'formulários'}
          </p>
        ) : null}
      </div>

      {error ? (
        <EiaAlert tone="danger" title="Não foi possível carregar os formulários">
          {asSentence(error)} Recarregue a página para tentar de novo.
        </EiaAlert>
      ) : null}

      {deleteError ? (
        <EiaAlert tone="danger" title="Não foi possível excluir o formulário">
          {asSentence(deleteError)} Tente excluir de novo.
        </EiaAlert>
      ) : null}

      {isLoading ? (
        <FormCardSkeletonList />
      ) : count === 0 ? (
        error ? null : (
          <EiaPanel material="dense">
            <EiaEmpty
              icon={<FileText size={24} />}
              title="Nenhum formulário ainda"
              description="Crie um formulário para captar contatos por um link público e aplicar uma tag automaticamente."
              action={
                onCreate ? (
                  <EiaButton size="sm" leadingIcon={<Plus size={16} />} onClick={onCreate}>
                    Criar formulário
                  </EiaButton>
                ) : undefined
              }
            />
          </EiaPanel>
        )
      ) : (
        <ul className="space-y-3">
          {forms.map((form) => (
            <li key={form.id}>
              <FormCard
                form={form}
                publicBaseUrl={publicBaseUrl}
                isDeleting={deletingId === form.id}
                onCopyLink={onCopyLink}
                onEdit={onEdit}
                onDelete={onDelete}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
