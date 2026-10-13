'use client'

import { useId } from 'react'
import { Check, CircleSlash, Copy, ExternalLink, Pencil, Trash2 } from 'lucide-react'
import type { LeadForm } from '@/types'
import { EiaBadge, EiaIconButton, EiaLink, EiaPanel } from '@/components/eia'
import { EiaTooltip } from '@/components/eia/extended'

export interface FormCardProps {
  form: LeadForm
  publicBaseUrl: string
  /** Exclusão deste formulário em andamento */
  isDeleting: boolean
  onCopyLink: (url: string) => void
  onEdit: (form: LeadForm) => void
  onDelete: (form: LeadForm) => void
}

const numberFormat = new Intl.NumberFormat('pt-BR')

export function FormCard({ form, publicBaseUrl, isDeleting, onCopyLink, onEdit, onDelete }: FormCardProps) {
  const titleId = useId()
  const url = `${(publicBaseUrl || '').replace(/\/$/, '')}/f/${encodeURIComponent(form.slug)}`
  const extraFields = form.fields?.length ?? 0

  return (
    <EiaPanel as="article" material="dense" aria-labelledby={titleId}>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="min-w-0 flex-1 basis-64 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h3
              id={titleId}
              className="min-w-0 break-words text-(length:--eia-type-body) font-(--eia-weight-semibold) leading-(--eia-line-control) text-eia-text"
            >
              {form.name}
            </h3>
            {/* Status com texto e ícone: a cor nunca é o único sinal */}
            {form.isActive ? (
              <EiaBadge tone="success" size="sm">
                <Check size={12} aria-hidden="true" />
                Ativo
              </EiaBadge>
            ) : (
              <EiaBadge tone="neutral" size="sm">
                <CircleSlash size={12} aria-hidden="true" />
                Inativo
              </EiaBadge>
            )}
          </div>

          <dl className="flex flex-wrap gap-x-5 gap-y-1 text-(length:--eia-type-label) leading-(--eia-line-control) text-eia-muted">
            <div className="flex min-w-0 gap-1">
              <dt>Tag:</dt>
              <dd className="min-w-0 truncate text-eia-text">{form.tag}</dd>
            </div>
            <div className="flex gap-1">
              <dt>Campos extras:</dt>
              <dd className="text-eia-text tabular-nums">{numberFormat.format(extraFields)}</dd>
            </div>
          </dl>

          <p className="break-all text-(length:--eia-type-label) leading-(--eia-line-control) text-eia-subtle">
            <span className="sr-only">Link público: </span>
            {url}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <EiaTooltip content="Copiar link">
            <EiaIconButton label={`Copiar link de ${form.name}`} onClick={() => onCopyLink(url)}>
              <Copy size={18} />
            </EiaIconButton>
          </EiaTooltip>
          <EiaTooltip content="Abrir em nova aba">
            {/* Navegação externa (link público): <a> do DS com o quadrado do botão de ícone */}
            <EiaLink
              href={url}
              target="_blank"
              variant="ghost"
              className="eia-icon-button"
              aria-label={`Abrir ${form.name} em nova aba`}
            >
              <ExternalLink size={18} aria-hidden="true" />
            </EiaLink>
          </EiaTooltip>
          <EiaTooltip content="Editar">
            <EiaIconButton label={`Editar ${form.name}`} onClick={() => onEdit(form)}>
              <Pencil size={18} />
            </EiaIconButton>
          </EiaTooltip>
          <EiaTooltip content="Excluir">
            <EiaIconButton
              label={`Excluir ${form.name}`}
              onClick={() => onDelete(form)}
              disabled={isDeleting}
              aria-busy={isDeleting || undefined}
              focusableWhenDisabled
            >
              <Trash2 size={18} />
            </EiaIconButton>
          </EiaTooltip>
        </div>
      </div>
    </EiaPanel>
  )
}
