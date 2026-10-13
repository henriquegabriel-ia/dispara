'use client'

import React from 'react'
import { Ellipsis, KanbanSquare, Pencil, Plus, SlidersHorizontal, Trash2 } from 'lucide-react'
import {
  EiaButton,
  EiaEmpty,
  EiaIconButton,
  EiaMenu,
  EiaPanel,
  EiaSelect,
  EiaSpinner,
} from '@/components/eia'
import { ConfirmDeleteModal } from '@/components/app/ConfirmDeleteModal'
import { PageActions, PageDescription, PageHeader, PageTitle } from '@/components/app/page'
import type { CrmController } from '@/hooks/useCrm'
import { KanbanBoard } from '@/components/features/crm/KanbanBoard'
import { PipelineFormModal } from '@/components/features/crm/PipelineFormModal'
import { ManageStagesModal } from '@/components/features/crm/ManageStagesModal'
import { NewOpportunityModal } from '@/components/features/crm/NewOpportunityModal'
import { EditOpportunityModal } from '@/components/features/crm/EditOpportunityModal'

export interface CrmViewProps {
  controller: CrmController
}

/** Carregamento centralizado: spinner do DS + texto (o spinner já anuncia o rótulo). */
function CrmLoading({ label }: { label: string }) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center">
      <div className="flex flex-col items-center gap-(--eia-space-3)">
        <EiaSpinner size="lg" label={label} />
        <p aria-hidden="true" className="text-(length:--eia-type-control) text-eia-muted">
          {label}
        </p>
      </div>
    </div>
  )
}

/**
 * View principal do CRM: header (seletor de pipeline + ações) e kanban de oportunidades.
 * Componente de apresentação — toda a lógica vive no useCrmController.
 */
export function CrmView({ controller }: CrmViewProps) {
  const {
    pipelines,
    selectedPipeline,
    selectedPipelineId,
    columns,
    isLoadingPipelines,
    isLoadingOpportunities,
    setSelectedPipelineId,
  } = controller

  const newOpportunityStage =
    columns.find((c) => c.stage.id === controller.newOpportunityStageId)?.stage ?? null

  // --- Loading inicial ---
  if (isLoadingPipelines) {
    return (
      <div className="flex h-full flex-col">
        <CrmLoading label="Carregando CRM…" />
      </div>
    )
  }

  const hasPipelines = pipelines.length > 0

  return (
    <div className="flex h-full flex-col gap-(--eia-space-6)">
      {/* Header da página */}
      <PageHeader className="shrink-0">
        <div>
          <PageTitle>CRM</PageTitle>
          <PageDescription>Acompanhe suas oportunidades por etapa do funil.</PageDescription>
        </div>

        {/* Sem pipelines, a ação de criar fica no estado vazio (um só chamado por tela) */}
        {hasPipelines && (
          <PageActions>
            {/* O rótulo "Pipeline" fica só para leitores de tela: o contexto já o nomeia.
                No celular o seletor ocupa a linha inteira; menu e botão vão para a de baixo. */}
            <div className="dispara-sr-label w-56 max-sm:w-full">
              <EiaSelect
                label="Pipeline"
                placeholder="Selecione um pipeline"
                value={selectedPipelineId ?? ''}
                onValueChange={(value) => {
                  if (value) setSelectedPipelineId(value)
                }}
                options={pipelines.map((pipeline) => ({ value: pipeline.id, label: pipeline.name }))}
              />
            </div>

            <EiaMenu
              label="Ações do pipeline"
              trigger={
                <EiaIconButton variant="secondary" label="Ações do pipeline">
                  <Ellipsis size={18} />
                </EiaIconButton>
              }
              groups={[
                {
                  id: 'edit',
                  items: [
                    {
                      label: 'Renomear pipeline',
                      icon: <Pencil size={16} />,
                      onSelect: () => controller.setIsRenamePipelineOpen(true),
                    },
                    {
                      label: 'Gerenciar etapas',
                      icon: <SlidersHorizontal size={16} />,
                      onSelect: () => controller.setIsManageStagesOpen(true),
                    },
                  ],
                },
                {
                  id: 'danger',
                  items: [
                    {
                      label: 'Excluir pipeline',
                      icon: <Trash2 size={16} />,
                      danger: true,
                      onSelect: () => controller.setIsDeletePipelineOpen(true),
                    },
                  ],
                },
              ]}
            />

            <EiaButton
              variant="secondary"
              leadingIcon={<Plus />}
              onClick={() => controller.setIsNewPipelineOpen(true)}
            >
              Criar pipeline
            </EiaButton>
          </PageActions>
        )}
      </PageHeader>

      {/* Conteúdo: estado vazio ou kanban */}
      {!hasPipelines ? (
        <div className="flex min-h-0 flex-1 items-center justify-center">
          <EiaPanel material="dense" className="w-full max-w-md">
            <EiaEmpty
              icon={<KanbanSquare />}
              title="Crie seu primeiro pipeline"
              description="Organize suas oportunidades em etapas e acompanhe cada negociação do primeiro contato ao fechamento."
              action={
                <EiaButton leadingIcon={<Plus />} onClick={() => controller.setIsNewPipelineOpen(true)}>
                  Criar pipeline
                </EiaButton>
              }
            />
          </EiaPanel>
        </div>
      ) : isLoadingOpportunities ? (
        <CrmLoading label="Carregando oportunidades…" />
      ) : (
        <KanbanBoard
          columns={columns}
          onMoveOpportunity={controller.onMoveOpportunity}
          onAddOpportunity={(stageId) => controller.setNewOpportunityStageId(stageId)}
          onChangeStatus={controller.onChangeStatus}
          onEditOpportunity={(opportunity) => controller.setEditingOpportunity(opportunity)}
          onDeleteOpportunity={(opportunity) => controller.setDeletingOpportunity(opportunity)}
        />
      )}

      {/* Diálogos */}
      <PipelineFormModal
        isOpen={controller.isNewPipelineOpen}
        mode="create"
        isSaving={controller.isCreatingPipeline}
        onSubmit={controller.onCreatePipeline}
        onClose={() => controller.setIsNewPipelineOpen(false)}
      />

      <PipelineFormModal
        isOpen={controller.isRenamePipelineOpen}
        mode="rename"
        initialName={selectedPipeline?.name ?? ''}
        isSaving={controller.isRenamingPipeline}
        onSubmit={controller.onRenamePipeline}
        onClose={() => controller.setIsRenamePipelineOpen(false)}
      />

      <ManageStagesModal
        isOpen={controller.isManageStagesOpen}
        pipelineName={selectedPipeline?.name ?? ''}
        stages={selectedPipeline?.stages ?? []}
        isAdding={controller.isAddingStage}
        isRenaming={controller.isRenamingStage}
        isDeleting={controller.isDeletingStage}
        onAddStage={controller.onAddStage}
        onRenameStage={controller.onRenameStage}
        onDeleteStage={controller.onDeleteStage}
        onClose={() => controller.setIsManageStagesOpen(false)}
      />

      <ConfirmDeleteModal
        isOpen={controller.isDeletePipelineOpen}
        title="Excluir pipeline"
        description="Todas as etapas e oportunidades deste pipeline serão excluídas. Esta ação não pode ser desfeita."
        itemName={selectedPipeline?.name}
        isDeleting={controller.isDeletingPipeline}
        onConfirm={controller.onDeletePipeline}
        onCancel={() => controller.setIsDeletePipelineOpen(false)}
        confirmText="Excluir pipeline"
        loadingText="Excluindo…"
      />

      <NewOpportunityModal
        isOpen={!!controller.newOpportunityStageId}
        stage={newOpportunityStage}
        isSaving={controller.isCreatingOpportunity}
        onSubmit={controller.onCreateOpportunity}
        onClose={() => controller.setNewOpportunityStageId(null)}
      />

      <EditOpportunityModal
        opportunity={controller.editingOpportunity}
        isSaving={controller.isSavingOpportunity}
        onSubmit={controller.onSaveEdit}
        onClose={() => controller.setEditingOpportunity(null)}
      />

      <ConfirmDeleteModal
        isOpen={!!controller.deletingOpportunity}
        title="Excluir oportunidade"
        itemName={controller.deletingOpportunity?.name}
        isDeleting={controller.isDeletingOpportunity}
        onConfirm={controller.onConfirmDeleteOpportunity}
        onCancel={() => controller.setDeletingOpportunity(null)}
        confirmText="Excluir oportunidade"
        loadingText="Excluindo…"
      />
    </div>
  )
}
