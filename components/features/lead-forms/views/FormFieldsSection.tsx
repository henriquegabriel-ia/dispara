'use client'

import { useId } from 'react'
import { Plus } from 'lucide-react'
import type { LeadFormField } from '@/types'
import { EiaBadge, EiaButton } from '@/components/eia'
import { FormFieldEditor } from '@/components/features/lead-forms/views/FormFieldEditor'

export interface FormFieldsSectionProps {
  fields: LeadFormField[]
  collectEmail: boolean
  disabled?: boolean
  onAddField: () => void
  onUpdateField: (index: number, patch: Partial<LeadFormField>) => void
  onRemoveField: (index: number) => void
  onMoveFieldUp: (index: number) => void
  onMoveFieldDown: (index: number) => void
}

export function FormFieldsSection({
  fields,
  collectEmail,
  disabled = false,
  onAddField,
  onUpdateField,
  onRemoveField,
  onMoveFieldUp,
  onMoveFieldDown,
}: FormFieldsSectionProps) {
  const headingId = useId()

  return (
    <section aria-labelledby={headingId} className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 basis-56">
          <h3
            id={headingId}
            className="text-(length:--eia-type-body) font-(--eia-weight-semibold) leading-(--eia-line-control) text-eia-text"
          >
            Campos do formulário
          </h3>
          <p className="mt-1 text-(length:--eia-type-label) leading-(--eia-line-body) text-eia-muted">
            Nome e telefone sempre aparecem. Adicione campos extras, como curso, turma ou cidade.
          </p>
        </div>
        <EiaButton
          variant="secondary"
          size="sm"
          leadingIcon={<Plus size={16} />}
          onClick={onAddField}
          disabled={disabled}
        >
          Adicionar campo
        </EiaButton>
      </div>

      {/* Campos fixos do formulário público (não editáveis) */}
      <div className="rounded-eia-control border border-eia-border-subtle bg-eia-bg px-4 py-3">
        <p className="text-(length:--eia-type-label) font-(--eia-weight-medium) text-eia-muted">Campos padrão</p>
        <ul className="mt-2 space-y-2 text-(length:--eia-type-control) text-eia-text">
          <li className="flex items-center justify-between gap-3">
            Nome
            <EiaBadge size="sm">Obrigatório</EiaBadge>
          </li>
          <li className="flex items-center justify-between gap-3">
            Telefone (WhatsApp)
            <EiaBadge size="sm">Obrigatório</EiaBadge>
          </li>
          <li className="flex items-center justify-between gap-3">
            E-mail
            <EiaBadge size="sm">{collectEmail ? 'Opcional' : 'Oculto'}</EiaBadge>
          </li>
        </ul>
      </div>

      {fields.length === 0 ? (
        <p className="text-(length:--eia-type-label) leading-(--eia-line-body) text-eia-muted">
          Nenhum campo extra por enquanto.
        </p>
      ) : (
        <ol className="space-y-3" aria-label="Campos extras">
          {fields.map((f, idx) => (
            // Chave pela posição: com `f.key` na chave, cada tecla digitada no
            // campo "Chave" remontava o editor e o foco saía do input.
            <li key={idx}>
              <FormFieldEditor
                field={f}
                index={idx}
                isFirst={idx === 0}
                isLast={idx === fields.length - 1}
                disabled={disabled}
                onUpdate={onUpdateField}
                onRemove={onRemoveField}
                onMoveUp={onMoveFieldUp}
                onMoveDown={onMoveFieldDown}
              />
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
