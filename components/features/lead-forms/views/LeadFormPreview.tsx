'use client'

import { useId } from 'react'
import { ChevronDown } from 'lucide-react'
import type { LeadFormField } from '@/types'
import { EiaButton, EiaField, EiaInput, EiaSelect } from '@/components/eia'
import { PUBLIC_FORM_COPY } from '@/components/features/lead-forms/public-form-copy'

export interface LeadFormPreviewProps {
  title: string
  collectEmail: boolean
  fields: LeadFormField[]
}

const noop = () => {}

/*
 * Pré-visualização do formulário público (/f/[slug]) com os controles do DS.
 *
 * A maquete é `inert`: nada recebe foco nem clique e ela sai da árvore de
 * acessibilidade — por isso os controles não precisam de `disabled` (que os
 * deixaria apagados e menos fiéis ao formulário real). Para leitor de tela, um
 * resumo em texto descreve os campos.
 *
 * O telefone é desenhado com primitivas do DS em vez do
 * InternationalPhoneInput: ele usa Popover/Command do Radix (legacy-ui), que
 * não pode ficar dentro do overlay Base UI do EiaDialog.
 *
 * Os textos vêm de PUBLIC_FORM_COPY, os mesmos da página pública.
 */
export function LeadFormPreview({ title, collectEmail, fields }: LeadFormPreviewProps) {
  const baseId = useId()
  const headingId = `${baseId}-heading`
  const formTitle = title.trim() || 'Formulário sem nome'

  const summary = [
    `${PUBLIC_FORM_COPY.nameLabel}, obrigatório`,
    `${PUBLIC_FORM_COPY.phoneLabel}, obrigatório`,
    collectEmail ? `${PUBLIC_FORM_COPY.emailLabel}, opcional` : null,
    ...fields.map((f, idx) => `${f.label?.trim() || `Campo ${idx + 1}`}, ${f.required ? 'obrigatório' : 'opcional'}`),
  ]
    .filter(Boolean)
    .join('; ')

  return (
    <section aria-labelledby={headingId} className="space-y-3">
      <div>
        <h3
          id={headingId}
          className="text-(length:--eia-type-body) font-(--eia-weight-semibold) leading-(--eia-line-control) text-eia-text"
        >
          Pré-visualização
        </h3>
        <p className="mt-1 text-(length:--eia-type-label) leading-(--eia-line-body) text-eia-muted">
          Como o formulário aparece para quem abre o link.
        </p>
      </div>

      <p className="sr-only">
        Formulário “{formTitle}” com os campos: {summary}.
      </p>

      <div
        inert
        className="space-y-4 rounded-eia-panel border border-eia-border-subtle bg-eia-surface p-5 select-none"
      >
        <div>
          <p className="text-(length:--eia-type-lead) font-(--eia-weight-semibold) leading-(--eia-line-control) tracking-(--eia-tracking-tight) text-eia-text break-words">
            {formTitle}
          </p>
          <p className="mt-1 text-(length:--eia-type-label) leading-(--eia-line-body) text-eia-muted">
            {PUBLIC_FORM_COPY.description}
          </p>
        </div>

        <EiaField label={PUBLIC_FORM_COPY.nameLabel} htmlFor={`${baseId}-name`} required>
          <EiaInput controlSize="sm" placeholder={PUBLIC_FORM_COPY.namePlaceholder} />
        </EiaField>

        <EiaField label={PUBLIC_FORM_COPY.phoneLabel} htmlFor={`${baseId}-phone`} required>
          <div className="flex gap-2">
            {/* Seletor de país do formulário real (DDI do Brasil por padrão) */}
            <span
              aria-hidden="true"
              className="inline-flex min-h-(--eia-control-sm) shrink-0 items-center gap-1 rounded-eia-control border border-eia-border-control [background:var(--eia-material-control)] px-3 text-(length:--eia-type-label) text-eia-text tabular-nums"
            >
              +55
              <ChevronDown size={14} className="text-eia-subtle" />
            </span>
            <EiaInput controlSize="sm" type="tel" placeholder="(11) 91234-5678" />
          </div>
        </EiaField>

        {collectEmail ? (
          <EiaField
            label={PUBLIC_FORM_COPY.emailLabel}
            htmlFor={`${baseId}-email`}
            description={PUBLIC_FORM_COPY.emailDescription}
          >
            <EiaInput controlSize="sm" type="email" placeholder={PUBLIC_FORM_COPY.emailPlaceholder} />
          </EiaField>
        ) : null}

        {fields.map((f, idx) => {
          const label = f.label?.trim() || `Campo ${idx + 1}`
          const controlId = `${baseId}-field-${idx}`

          if (f.type === 'select') {
            const options = Array.from(new Set((f.options || []).filter(Boolean))).map((opt) => ({
              value: opt,
              label: opt,
            }))
            return (
              <EiaField key={controlId} label={label} htmlFor={controlId} required={!!f.required}>
                <EiaSelect label={label} size="sm" value="" onValueChange={noop} options={options} />
              </EiaField>
            )
          }

          const inputType = f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'
          return (
            <EiaField key={controlId} label={label} htmlFor={controlId} required={!!f.required}>
              <EiaInput controlSize="sm" type={inputType} />
            </EiaField>
          )
        })}

        {/* Largura total via style: .eia-button fixa width: fit-content (eia.css sem @layer vence o className) */}
        <div className="flex flex-col gap-3 pt-1">
          <EiaButton style={{ width: '100%' }}>{PUBLIC_FORM_COPY.submit}</EiaButton>
          <p className="text-(length:--eia-type-label) leading-(--eia-line-body) text-eia-muted">
            {PUBLIC_FORM_COPY.consent}
          </p>
        </div>
      </div>
    </section>
  )
}
