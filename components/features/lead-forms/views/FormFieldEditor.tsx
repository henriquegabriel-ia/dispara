'use client'

import { useId, useState } from 'react'
import { ArrowDown, ArrowUp, Trash2 } from 'lucide-react'
import type { LeadFormField, LeadFormFieldType } from '@/types'
import {
  EiaField,
  EiaIconButton,
  EiaInput,
  EiaSelect,
  EiaSwitch,
  EiaTextarea,
  type EiaSelectOption,
} from '@/components/eia'

export interface FormFieldEditorProps {
  field: LeadFormField
  index: number
  isFirst: boolean
  isLast: boolean
  disabled?: boolean
  onUpdate: (index: number, patch: Partial<LeadFormField>) => void
  onRemove: (index: number) => void
  onMoveUp: (index: number) => void
  onMoveDown: (index: number) => void
}

const FIELD_TYPE_OPTIONS: EiaSelectOption[] = [
  { value: 'text', label: 'Texto' },
  { value: 'number', label: 'Número' },
  { value: 'date', label: 'Data' },
  { value: 'select', label: 'Lista de opções' },
]

function isFieldType(value: string): value is LeadFormFieldType {
  return value === 'text' || value === 'number' || value === 'date' || value === 'select'
}

/** Uma opção por linha, sem espaços nas pontas e sem linhas vazias. */
function parseOptions(text: string): string[] {
  return text
    .split('\n')
    .map((x) => x.trim())
    .filter(Boolean)
}

export function FormFieldEditor({
  field,
  index,
  isFirst,
  isLast,
  disabled = false,
  onUpdate,
  onRemove,
  onMoveUp,
  onMoveDown,
}: FormFieldEditorProps) {
  const baseId = useId()
  const position = index + 1
  const fieldName = field.label?.trim() || `campo ${position}`

  // Texto das opções guardado localmente: derivar o textarea direto de
  // `field.options` (já limpas) engolia o espaço e a quebra de linha no fim
  // enquanto a pessoa digitava ("Turma A" virava "TurmaA"). Se as opções
  // mudarem por fora (campo trocou de posição), o texto local é refeito.
  const savedOptions = (field.options || []).join('\n')
  const [optionsText, setOptionsText] = useState(savedOptions)
  if (parseOptions(optionsText).join('\n') !== parseOptions(savedOptions).join('\n')) {
    setOptionsText(savedOptions)
  }

  return (
    <article
      aria-label={`Campo extra ${position}`}
      className="@container rounded-eia-control border border-eia-border-subtle bg-eia-bg p-4"
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="min-w-0 truncate text-(length:--eia-type-label) font-(--eia-weight-medium) text-eia-muted">
          Campo {position}
        </p>
        <div className="flex shrink-0 items-center gap-1">
          <EiaIconButton
            size="sm"
            label={`Mover ${fieldName} para cima`}
            onClick={() => onMoveUp(index)}
            disabled={disabled || isFirst}
          >
            <ArrowUp size={16} />
          </EiaIconButton>
          <EiaIconButton
            size="sm"
            label={`Mover ${fieldName} para baixo`}
            onClick={() => onMoveDown(index)}
            disabled={disabled || isLast}
          >
            <ArrowDown size={16} />
          </EiaIconButton>
          <EiaIconButton
            size="sm"
            label={`Remover ${fieldName}`}
            onClick={() => onRemove(index)}
            disabled={disabled}
          >
            <Trash2 size={16} />
          </EiaIconButton>
        </div>
      </div>

      <div className="grid gap-4 @sm:grid-cols-2">
        <EiaField label="Rótulo" htmlFor={`${baseId}-label`} required>
          <EiaInput
            controlSize="sm"
            value={field.label}
            onChange={(e) => onUpdate(index, { label: e.target.value })}
            placeholder="Ex.: Qual é a sua turma?"
            maxLength={80}
            autoComplete="off"
            required
            disabled={disabled}
          />
        </EiaField>

        <EiaField
          label="Chave"
          htmlFor={`${baseId}-key`}
          required
          description="Nome salvo no contato: letras minúsculas, números e _, começando por letra."
        >
          <EiaInput
            controlSize="sm"
            value={field.key}
            onChange={(e) => onUpdate(index, { key: e.target.value })}
            placeholder="Ex.: turma"
            maxLength={50}
            autoComplete="off"
            spellCheck={false}
            required
            disabled={disabled}
          />
        </EiaField>

        <EiaSelect
          label="Tipo"
          size="sm"
          value={field.type}
          onValueChange={(value) => {
            if (isFieldType(value)) onUpdate(index, { type: value })
          }}
          options={FIELD_TYPE_OPTIONS}
          disabled={disabled}
        />

        {/* Alinha a chave com o seletor de tipo (altura de controle sm) */}
        <div className="flex min-h-(--eia-control-sm) items-center self-end">
          <EiaSwitch
            className="w-full"
            label="Obrigatório"
            checked={!!field.required}
            onCheckedChange={(checked) => onUpdate(index, { required: checked })}
            disabled={disabled}
          />
        </div>
      </div>

      {field.type === 'select' ? (
        <EiaField
          className="mt-4"
          label="Opções"
          htmlFor={`${baseId}-options`}
          description="Uma opção por linha."
        >
          <EiaTextarea
            value={optionsText}
            onChange={(e) => {
              setOptionsText(e.target.value)
              onUpdate(index, { options: parseOptions(e.target.value) })
            }}
            placeholder={'Ex.:\nTurma A\nTurma B\nTurma C'}
            rows={4}
            disabled={disabled}
          />
        </EiaField>
      ) : null}
    </article>
  )
}
