'use client'

import { useEffect, useId, useRef, type Ref } from 'react'
import type { CreateLeadFormDTO, LeadFormField } from '@/types'
import {
  EiaAlert,
  EiaField,
  EiaInput,
  EiaSelect,
  EiaSwitch,
  EiaTextarea,
  type EiaSelectOption,
} from '@/components/eia'
import { FormFieldsSection } from '@/components/features/lead-forms/views/FormFieldsSection'
import { LeadFormPreview } from '@/components/features/lead-forms/views/LeadFormPreview'
import {
  createDefaultField,
  moveItem,
  normalizeFieldOrder,
  slugify,
} from '@/components/features/lead-forms/views/utils'

/*
 * Corpo compartilhado dos diálogos de criar e editar formulário (antes
 * duplicado em CreateFormDialog e EditFormDialog).
 *
 * Duas colunas quando o diálogo tem largura (container query no corpo do
 * EiaDialog lg): configuração à esquerda e pré-visualização fixa à direita.
 * Em telas estreitas a pré-visualização desce para o fim.
 *
 * Limites de tamanho (maxLength) espelham o CreateLeadFormSchema da API, para o
 * erro não aparecer só depois de enviar.
 */

export interface FormDraftEditorProps {
  draft: CreateLeadFormDTO
  setDraft: (dto: CreateLeadFormDTO) => void
  publicBaseUrl: string
  sortedTags: string[]
  /** Bloqueia a edição enquanto o envio está em andamento */
  disabled?: boolean
  /** Mensagem de erro do envio (vinda da API) */
  error?: string
  /** Título do alerta de erro ("Não foi possível criar o formulário") */
  errorTitle: string
  /** Ref do campo Nome: os diálogos usam como foco inicial (o X do DS vem antes do corpo) */
  nameInputRef?: Ref<HTMLInputElement>
}

export function FormDraftEditor({
  draft,
  setDraft,
  publicBaseUrl,
  sortedTags,
  disabled = false,
  error,
  errorTitle,
  nameInputRef,
}: FormDraftEditorProps) {
  const baseId = useId()
  const errorRef = useRef<HTMLDivElement>(null)
  const fields = draft.fields || []

  // O erro aparece no topo do corpo; quem clicou no rodapé pode estar rolado
  // para baixo, então traz o alerta para a área visível.
  useEffect(() => {
    if (error) errorRef.current?.scrollIntoView({ block: 'nearest' })
  }, [error])

  const addField = () => {
    const next = createDefaultField(fields.length)
    setDraft({ ...draft, fields: normalizeFieldOrder([...fields, next]) })
  }

  const updateField = (index: number, patch: Partial<LeadFormField>) => {
    const next = fields.map((f, i) => (i === index ? { ...f, ...patch } : f))
    setDraft({ ...draft, fields: next })
  }

  const removeField = (index: number) => {
    const next = normalizeFieldOrder(fields.filter((_, i) => i !== index))
    setDraft({ ...draft, fields: next })
  }

  const moveFieldUp = (index: number) => {
    const next = normalizeFieldOrder(moveItem(fields, index, index - 1))
    setDraft({ ...draft, fields: next })
  }

  const moveFieldDown = (index: number) => {
    const next = normalizeFieldOrder(moveItem(fields, index, index + 1))
    setDraft({ ...draft, fields: next })
  }

  // slugify remove o hífen final; enquanto a pessoa digita, um espaço ou hífen
  // no fim vira separador para a próxima palavra (senão "lista espera" virava
  // "listaespera"). Ao sair do campo, o slug é limpo de vez.
  const handleSlugChange = (raw: string) => {
    const base = slugify(raw)
    const keepSeparator = base.length > 0 && base.length < 80 && /[\s_-]$/.test(raw)
    setDraft({ ...draft, slug: keepSeparator ? `${base}-` : base })
  }

  const handleSlugBlur = () => {
    const clean = slugify(draft.slug || '')
    if (clean !== draft.slug) setDraft({ ...draft, slug: clean })
  }

  const publicUrl = `${(publicBaseUrl || '…').replace(/\/$/, '')}/f/${draft.slug || 'seu-slug'}`

  // '' é "sem seleção" no EiaSelect: tags vazias e repetidas ficam de fora.
  const tagOptions: EiaSelectOption[] = Array.from(new Set(sortedTags.filter(Boolean))).map((tag) => ({
    value: tag,
    label: tag,
  }))
  const existingTag = tagOptions.some((option) => option.value === draft.tag) ? draft.tag : ''

  return (
    <div className="@container">
      <div className="grid gap-8 @2xl:grid-cols-[minmax(0,1fr)_16rem]">
        <div className="min-w-0 space-y-6">
          {error ? (
            <EiaAlert ref={errorRef} tone="danger" size="compact" title={errorTitle}>
              {error}
            </EiaAlert>
          ) : null}

          <div className="space-y-5">
            <EiaField label="Nome" htmlFor={`${baseId}-name`} required>
              <EiaInput
                ref={nameInputRef}
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder="Ex.: Lista de espera — Turma de janeiro"
                maxLength={120}
                autoComplete="off"
                required
                disabled={disabled}
              />
            </EiaField>

            <EiaField
              label="Slug (endereço do link)"
              htmlFor={`${baseId}-slug`}
              required
              description={
                <>
                  Link público: <span className="break-all text-eia-text">{publicUrl}</span>
                </>
              }
            >
              <EiaInput
                value={draft.slug}
                onChange={(e) => handleSlugChange(e.target.value)}
                onBlur={handleSlugBlur}
                placeholder="ex.: lista-espera-janeiro"
                maxLength={80}
                autoComplete="off"
                spellCheck={false}
                required
                disabled={disabled}
              />
            </EiaField>

            <div className="grid gap-4 @md:grid-cols-2">
              <EiaField
                label="Tag"
                htmlFor={`${baseId}-tag`}
                required
                description="Aplicada a quem preencher. Campanhas podem filtrar por ela."
              >
                <EiaInput
                  value={draft.tag}
                  onChange={(e) => setDraft({ ...draft, tag: e.target.value })}
                  placeholder="Ex.: alunos-turma-jan"
                  maxLength={50}
                  autoComplete="off"
                  required
                  disabled={disabled}
                />
              </EiaField>

              <EiaSelect
                label="Usar tag existente"
                value={existingTag}
                onValueChange={(tag) => {
                  if (tag) setDraft({ ...draft, tag })
                }}
                options={tagOptions}
                placeholder={tagOptions.length > 0 ? 'Selecione uma tag' : 'Nenhuma tag cadastrada'}
                disabled={disabled || tagOptions.length === 0}
              />
            </div>

            <EiaField
              label="Mensagem de sucesso"
              htmlFor={`${baseId}-success`}
              description="Opcional. Aparece depois que a pessoa envia o formulário."
            >
              <EiaTextarea
                value={draft.successMessage ?? ''}
                onChange={(e) => setDraft({ ...draft, successMessage: e.target.value })}
                placeholder="Ex.: Cadastro confirmado! Em breve você recebe uma mensagem no WhatsApp."
                rows={3}
                maxLength={300}
                disabled={disabled}
              />
            </EiaField>
          </div>

          <div className="divide-y divide-eia-border-subtle rounded-eia-control border border-eia-border-subtle">
            <EiaSwitch
              className="px-4 py-3"
              label="Formulário ativo"
              description="Desligado, o link público avisa que o formulário está indisponível."
              checked={draft.isActive ?? true}
              onCheckedChange={(checked) => setDraft({ ...draft, isActive: checked })}
              disabled={disabled}
            />
            <EiaSwitch
              className="px-4 py-3"
              label="Coletar e-mail"
              description="Mostra o campo de e-mail, opcional, no formulário público."
              checked={draft.collectEmail ?? true}
              onCheckedChange={(checked) => setDraft({ ...draft, collectEmail: checked })}
              disabled={disabled}
            />
          </div>

          <FormFieldsSection
            fields={fields}
            collectEmail={draft.collectEmail ?? true}
            disabled={disabled}
            onAddField={addField}
            onUpdateField={updateField}
            onRemoveField={removeField}
            onMoveFieldUp={moveFieldUp}
            onMoveFieldDown={moveFieldDown}
          />
        </div>

        <aside className="min-w-0 self-start @2xl:sticky @2xl:top-0">
          <LeadFormPreview title={draft.name} collectEmail={draft.collectEmail ?? true} fields={fields} />
        </aside>
      </div>
    </div>
  )
}
