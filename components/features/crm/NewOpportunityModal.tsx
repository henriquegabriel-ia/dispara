'use client'

import React, { useEffect, useId, useRef, useState } from 'react'
import { Phone, Search, X } from 'lucide-react'
import {
  EiaButton,
  EiaDialog,
  EiaField,
  EiaIconButton,
  EiaInput,
  EiaSpinner,
} from '@/components/eia'
import { EiaAvatar } from '@/components/eia/extended'
import { formatPhoneNumberDisplay } from '@/lib/phone-formatter'
import { useContactSearch, type NewOpportunityForm } from '@/hooks/useCrm'
import type { ContactSearchResult, PipelineStage } from '@/services/crmService'

export interface NewOpportunityModalProps {
  isOpen: boolean
  /** Etapa onde a oportunidade será criada */
  stage: PipelineStage | null
  isSaving: boolean
  onSubmit: (form: NewOpportunityForm) => void
  onClose: () => void
}

/** Avatar do contato (só apoio visual: nome e telefone vêm escritos ao lado). */
function ContactAvatar({ contact }: { contact: ContactSearchResult }) {
  return (
    <span aria-hidden="true" className="inline-flex shrink-0">
      {contact.name ? (
        <EiaAvatar name={contact.name} size="sm" />
      ) : (
        // Mesmo diâmetro do EiaAvatar size="sm" (30px no extended.css)
        <span className="inline-flex size-[30px] items-center justify-center rounded-full border border-eia-border bg-eia-raised text-eia-muted">
          <Phone className="size-3.5" />
        </span>
      )}
    </span>
  )
}

/**
 * Diálogo de criação de oportunidade:
 * busca de contato com debounce + nome (prefill = nome do contato) + valor opcional.
 */
export function NewOpportunityModal({
  isOpen,
  stage,
  isSaving,
  onSubmit,
  onClose,
}: NewOpportunityModalProps) {
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedContact, setSelectedContact] = useState<ContactSearchResult | null>(null)
  const [name, setName] = useState('')
  const [valueInput, setValueInput] = useState('')

  const formId = useId()
  const contactId = useId()
  const contactLabelId = useId()
  const resultsId = useId()
  const nameId = useId()
  const valueId = useId()
  const searchRef = useRef<HTMLInputElement>(null)
  const nameRef = useRef<HTMLInputElement>(null)
  /** Ao remover o contato escolhido, o foco volta para a busca (que reaparece) */
  const focusSearchAfterRemoveRef = useRef(false)

  const { results, isSearching, hasSearched } = useContactSearch(searchTerm)

  // Limpa o formulário sempre que o modal abre
  useEffect(() => {
    if (isOpen) {
      setSearchTerm('')
      setSelectedContact(null)
      setName('')
      setValueInput('')
    }
  }, [isOpen])

  useEffect(() => {
    if (!selectedContact && focusSearchAfterRemoveRef.current) {
      focusSearchAfterRemoveRef.current = false
      searchRef.current?.focus()
    }
  }, [selectedContact])

  const handleSelectContact = (contact: ContactSearchResult) => {
    setSelectedContact(contact)
    setSearchTerm('')
    // Prefill do nome da oportunidade com o nome do contato (sem sobrescrever digitação)
    if (!name.trim()) {
      setName(contact.name || formatPhoneNumberDisplay(contact.phone))
    }
    // O botão do resultado some da tela: o próximo passo natural é o nome
    nameRef.current?.focus()
  }

  const handleRemoveContact = () => {
    focusSearchAfterRemoveRef.current = true
    setSelectedContact(null)
  }

  const parsedValue = valueInput.trim() === '' ? null : Number(valueInput.replace(',', '.'))
  const isValueInvalid = parsedValue !== null && (!Number.isFinite(parsedValue) || parsedValue < 0)
  const canSubmit = !!stage && name.trim().length > 0 && !isValueInvalid && !isSaving

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSubmit || !stage) return
    onSubmit({
      stageId: stage.id,
      name: name.trim(),
      contactId: selectedContact?.id ?? null,
      phone: selectedContact?.phone ?? null,
      value: parsedValue,
    })
  }

  const showResults = !selectedContact && searchTerm.trim().length >= 2
  const resultsCount = results.length

  return (
    <EiaDialog
      open={isOpen}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      title="Nova oportunidade"
      description={stage ? `Será criada na etapa “${stage.name}”.` : undefined}
      // O X do DS vem antes do corpo: o foco inicial vai para o primeiro campo
      initialFocus={() => searchRef.current ?? nameRef.current ?? true}
      footer={
        <>
          <EiaButton variant="secondary" onClick={onClose} disabled={isSaving}>
            Cancelar
          </EiaButton>
          <EiaButton
            type="submit"
            form={formId}
            loading={isSaving}
            disabled={!stage || !name.trim() || isValueInvalid}
          >
            {isSaving ? 'Criando…' : 'Criar oportunidade'}
          </EiaButton>
        </>
      }
    >
      <form id={formId} onSubmit={handleSubmit} className="flex flex-col gap-(--eia-space-5)">
        {/* Contato: escolhido (cartão com remover) ou busca com resultados logo abaixo */}
        {selectedContact ? (
          <div className="flex flex-col gap-(--eia-space-2)">
            <p
              id={contactLabelId}
              className="text-(length:--eia-type-control) leading-(--eia-line-control) font-(--eia-weight-medium) text-eia-text"
            >
              Contato
            </p>
            <div
              role="group"
              aria-labelledby={contactLabelId}
              className="flex items-center gap-(--eia-space-3) rounded-eia-control border border-eia-border-subtle bg-(--eia-material-dense) py-(--eia-space-2) pr-(--eia-space-2) pl-(--eia-space-3)"
            >
              <ContactAvatar contact={selectedContact} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-(length:--eia-type-control) font-(--eia-weight-medium) text-eia-text">
                  {selectedContact.name || 'Sem nome'}
                </p>
                <p className="text-(length:--eia-type-label) text-eia-muted tabular-nums">
                  {formatPhoneNumberDisplay(selectedContact.phone)}
                </p>
              </div>
              <EiaIconButton size="sm" label="Remover contato selecionado" onClick={handleRemoveContact}>
                <X size={16} />
              </EiaIconButton>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-(--eia-space-2)">
            <EiaField
              label="Contato (opcional)"
              htmlFor={contactId}
              description="Digite ao menos 2 caracteres do nome ou do telefone."
            >
              <EiaInput
                ref={searchRef}
                leadingIcon={<Search />}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Buscar por nome ou telefone"
                autoComplete="off"
                aria-controls={showResults ? resultsId : undefined}
              />
            </EiaField>

            {showResults && (
              <div
                id={resultsId}
                className="max-h-56 overflow-y-auto rounded-eia-control border border-eia-border-subtle bg-(--eia-material-dense) p-(--eia-space-1)"
              >
                {isSearching ? (
                  <div className="flex items-center gap-(--eia-space-2) px-(--eia-space-3) py-(--eia-space-3) text-(length:--eia-type-label) text-eia-muted">
                    <EiaSpinner size="sm" tone="neutral" label="Buscando contatos…" />
                    <span aria-hidden="true">Buscando contatos…</span>
                  </div>
                ) : resultsCount > 0 ? (
                  <ul aria-label="Contatos encontrados" className="flex flex-col">
                    {results.map((contact) => (
                      <li key={contact.id} className="flex">
                        <EiaButton
                          variant="ghost"
                          onClick={() => handleSelectContact(contact)}
                          // Linha de resultado: ocupa a largura e alinha à esquerda
                          // (largura/alinhamento do .eia-button vêm do DS sem @layer)
                          style={{ width: '100%', justifyContent: 'flex-start', paddingInline: 'var(--eia-space-3)' }}
                          className="[&_.eia-button-label]:min-w-0 [&_.eia-button-label]:gap-(--eia-space-3)"
                        >
                          <ContactAvatar contact={contact} />
                          <span className="flex min-w-0 flex-col items-start text-left">
                            <span className="max-w-full truncate font-(--eia-weight-medium) text-eia-text">
                              {contact.name || 'Sem nome'}
                            </span>
                            <span className="text-(length:--eia-type-label) font-(--eia-weight-regular) text-eia-muted tabular-nums">
                              {formatPhoneNumberDisplay(contact.phone)}
                            </span>
                          </span>
                        </EiaButton>
                      </li>
                    ))}
                  </ul>
                ) : hasSearched ? (
                  <p className="px-(--eia-space-3) py-(--eia-space-3) text-(length:--eia-type-label) text-eia-muted">
                    Nenhum contato encontrado. Confira a grafia ou crie a oportunidade sem contato.
                  </p>
                ) : null}
              </div>
            )}

            {/* Anuncia o resultado da busca para leitores de tela */}
            <p role="status" className="eia-sr-only">
              {showResults && !isSearching && hasSearched
                ? resultsCount > 0
                  ? `${resultsCount.toLocaleString('pt-BR')} ${resultsCount === 1 ? 'contato encontrado' : 'contatos encontrados'}`
                  : 'Nenhum contato encontrado'
                : ''}
            </p>
          </div>
        )}

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
