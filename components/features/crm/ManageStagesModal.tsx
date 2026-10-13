'use client'

import React, { useEffect, useId, useRef, useState } from 'react'
import { Check, Pencil, Plus, Trash2, X } from 'lucide-react'
import { EiaButton, EiaDialog, EiaField, EiaIconButton, EiaInput } from '@/components/eia'
import { ConfirmDeleteModal } from '@/components/app/ConfirmDeleteModal'
import type { PipelineStage } from '@/services/crmService'

export interface ManageStagesModalProps {
  isOpen: boolean
  pipelineName: string
  stages: PipelineStage[]
  isAdding: boolean
  isRenaming: boolean
  isDeleting: boolean
  onAddStage: (name: string) => void
  onRenameStage: (stageId: string, name: string) => void
  onDeleteStage: (stageId: string) => void
  onClose: () => void
}

/**
 * Diálogo de gerenciamento de etapas do pipeline:
 * renomear inline, excluir (com aviso de cascata) e adicionar etapa.
 */
export function ManageStagesModal({
  isOpen,
  pipelineName,
  stages,
  isAdding,
  isRenaming,
  isDeleting,
  onAddStage,
  onRenameStage,
  onDeleteStage,
  onClose,
}: ManageStagesModalProps) {
  const [editingStageId, setEditingStageId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
  const [newStageName, setNewStageName] = useState('')
  const [stageToDelete, setStageToDelete] = useState<PipelineStage | null>(null)

  const newStageId = useId()
  const singleStageHintId = useId()
  /** Botões "Renomear" por etapa: o foco volta para eles ao sair da edição inline */
  const renameButtonRefs = useRef(new Map<string, HTMLButtonElement>())
  const restoreFocusToStageRef = useRef<string | null>(null)

  const sortedStages = [...stages].sort((a, b) => a.position - b.position)
  const isSingleStage = sortedStages.length <= 1

  useEffect(() => {
    if (editingStageId === null && restoreFocusToStageRef.current) {
      renameButtonRefs.current.get(restoreFocusToStageRef.current)?.focus()
      restoreFocusToStageRef.current = null
    }
  }, [editingStageId])

  const startEditing = (stage: PipelineStage) => {
    setEditingStageId(stage.id)
    setEditingName(stage.name)
  }

  const cancelEditing = () => {
    restoreFocusToStageRef.current = editingStageId
    setEditingStageId(null)
    setEditingName('')
  }

  const confirmRename = () => {
    const trimmed = editingName.trim()
    if (editingStageId && trimmed) {
      onRenameStage(editingStageId, trimmed)
    }
    cancelEditing()
  }

  const handleAddStage = (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = newStageName.trim()
    if (!trimmed || isAdding) return
    onAddStage(trimmed)
    setNewStageName('')
  }

  const handleConfirmDelete = () => {
    if (stageToDelete) {
      onDeleteStage(stageToDelete.id)
      setStageToDelete(null)
    }
  }

  return (
    <>
      <EiaDialog
        open={isOpen}
        onOpenChange={(next) => {
          if (!next) onClose()
        }}
        title="Gerenciar etapas"
        description={`Etapas do pipeline “${pipelineName}”. As mudanças valem na hora.`}
        footer={
          <EiaButton variant="secondary" onClick={onClose}>
            Concluir
          </EiaButton>
        }
      >
        {/* Lista de etapas com renomear inline e excluir */}
        {sortedStages.length > 0 ? (
          <ol aria-label="Etapas do pipeline" className="flex flex-col gap-(--eia-space-2)">
            {sortedStages.map((stage, index) => (
              <li
                key={stage.id}
                className="flex min-h-(--eia-control-md) items-center gap-(--eia-space-2) rounded-eia-control border border-eia-border-subtle bg-(--eia-material-dense) py-(--eia-space-1) pr-(--eia-space-1) pl-(--eia-space-3)"
              >
                <span
                  aria-hidden="true"
                  className="inline-flex size-6 shrink-0 items-center justify-center rounded-eia-small bg-eia-raised text-(length:--eia-type-caption) font-(--eia-weight-medium) text-eia-muted tabular-nums"
                >
                  {index + 1}
                </span>

                {editingStageId === stage.id ? (
                  <>
                    <EiaInput
                      controlSize="sm"
                      aria-label={`Novo nome da etapa ${stage.name}`}
                      value={editingName}
                      onChange={(e) => setEditingName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          confirmRename()
                        }
                        if (e.key === 'Escape') {
                          // Esc cancela só a edição: não deixa a tecla chegar ao diálogo
                          e.preventDefault()
                          e.stopPropagation()
                          cancelEditing()
                        }
                      }}
                      className="flex-1"
                      autoFocus
                      maxLength={80}
                    />
                    <EiaIconButton
                      size="sm"
                      label="Salvar nome da etapa"
                      onClick={confirmRename}
                      disabled={!editingName.trim() || isRenaming}
                    >
                      <Check size={16} />
                    </EiaIconButton>
                    <EiaIconButton size="sm" label="Cancelar renomeação" onClick={cancelEditing}>
                      <X size={16} />
                    </EiaIconButton>
                  </>
                ) : (
                  <>
                    {/* Nome inteiro (até 80 caracteres): quebra linha em vez de cortar */}
                    <span className="min-w-0 flex-1 [overflow-wrap:anywhere] text-(length:--eia-type-control) text-eia-text">
                      {stage.name}
                    </span>
                    <EiaIconButton
                      ref={(node: HTMLButtonElement | null) => {
                        if (node) renameButtonRefs.current.set(stage.id, node)
                        else renameButtonRefs.current.delete(stage.id)
                      }}
                      size="sm"
                      label={`Renomear etapa ${stage.name}`}
                      onClick={() => startEditing(stage)}
                    >
                      <Pencil size={16} />
                    </EiaIconButton>
                    <EiaIconButton
                      size="sm"
                      label={`Excluir etapa ${stage.name}`}
                      onClick={() => setStageToDelete(stage)}
                      disabled={isSingleStage}
                      // Continua no Tab quando desabilitado: o leitor de tela anuncia
                      // "indisponível" e lê a explicação abaixo da lista.
                      focusableWhenDisabled
                      aria-describedby={isSingleStage ? singleStageHintId : undefined}
                    >
                      <Trash2 size={16} />
                    </EiaIconButton>
                  </>
                )}
              </li>
            ))}
          </ol>
        ) : (
          <p className="py-(--eia-space-4) text-center text-(length:--eia-type-control) text-eia-muted">
            Nenhuma etapa neste pipeline. Adicione a primeira abaixo.
          </p>
        )}

        {sortedStages.length === 1 && (
          <p
            id={singleStageHintId}
            className="mt-(--eia-space-2) text-(length:--eia-type-label) text-eia-muted"
          >
            O pipeline precisa de ao menos uma etapa. Adicione outra antes de excluir esta.
          </p>
        )}

        {/* Adicionar etapa */}
        <form
          onSubmit={handleAddStage}
          className="mt-(--eia-space-6) flex items-end gap-(--eia-space-3) max-sm:flex-col max-sm:items-stretch"
        >
          <EiaField label="Nova etapa" htmlFor={newStageId} className="flex-1">
            <EiaInput
              value={newStageName}
              onChange={(e) => setNewStageName(e.target.value)}
              placeholder="Ex.: Proposta enviada"
              maxLength={80}
              autoComplete="off"
            />
          </EiaField>
          <EiaButton
            type="submit"
            variant="secondary"
            leadingIcon={<Plus />}
            loading={isAdding}
            disabled={!newStageName.trim()}
          >
            {isAdding ? 'Adicionando…' : 'Adicionar etapa'}
          </EiaButton>
        </form>
      </EiaDialog>

      {/*
        Confirmação de exclusão (cascata) como irmã do diálogo: assim o scrim dela
        escurece o "Gerenciar etapas" por baixo (aninhada, a Base UI não desenha o
        scrim). O Esc é tratado dentro do alertdialog e não chega ao diálogo de
        baixo; clique fora não fecha nenhum dos dois.
      */}
      <ConfirmDeleteModal
        isOpen={!!stageToDelete}
        title="Excluir etapa"
        description="As oportunidades desta etapa serão apagadas em cascata. Esta ação não pode ser desfeita."
        itemName={stageToDelete?.name}
        isDeleting={isDeleting}
        onConfirm={handleConfirmDelete}
        onCancel={() => setStageToDelete(null)}
        confirmText="Excluir etapa"
        loadingText="Excluindo…"
      />
    </>
  )
}
