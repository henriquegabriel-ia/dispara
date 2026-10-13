'use client'

import React, { useState } from 'react'
import type { Opportunity, OpportunityStatus } from '@/services/crmService'
import type { StageColumn } from '@/hooks/useCrm'
import { KanbanColumn } from '@/components/features/crm/KanbanColumn'

export interface KanbanBoardProps {
  columns: StageColumn[]
  onMoveOpportunity: (id: string, stageId: string) => void
  onAddOpportunity: (stageId: string) => void
  onChangeStatus: (opportunity: Opportunity, status: OpportunityStatus) => void
  onEditOpportunity: (opportunity: Opportunity) => void
  onDeleteOpportunity: (opportunity: Opportunity) => void
}

/**
 * Quadro kanban com drag and drop nativo (HTML5).
 * O estado do drag (card arrastado + coluna alvo) vive aqui;
 * a mutação de mover é delegada ao controller via onMoveOpportunity.
 * Sem mouse, o mesmo movimento fica no menu do cartão ("Mover para").
 */
export function KanbanBoard({
  columns,
  onMoveOpportunity,
  onAddOpportunity,
  onChangeStatus,
  onEditOpportunity,
  onDeleteOpportunity,
}: KanbanBoardProps) {
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [draggingStageId, setDraggingStageId] = useState<string | null>(null)
  const [dragOverStageId, setDragOverStageId] = useState<string | null>(null)

  const stages = columns.map((column) => column.stage)

  const handleDragStart = (e: React.DragEvent, opportunity: Opportunity) => {
    e.dataTransfer.setData('text/plain', opportunity.id)
    e.dataTransfer.effectAllowed = 'move'
    setDraggingId(opportunity.id)
    setDraggingStageId(opportunity.stageId)
  }

  const handleDragEnd = () => {
    setDraggingId(null)
    setDraggingStageId(null)
    setDragOverStageId(null)
  }

  const handleDragOver = (e: React.DragEvent, stageId: string) => {
    // preventDefault é obrigatório para permitir o drop
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (dragOverStageId !== stageId) setDragOverStageId(stageId)
  }

  const handleDragLeave = (e: React.DragEvent, stageId: string) => {
    // Ignora dragleave disparado por elementos filhos da própria coluna
    const related = e.relatedTarget as Node | null
    if (related && e.currentTarget.contains(related)) return
    if (dragOverStageId === stageId) setDragOverStageId(null)
  }

  const handleDrop = (e: React.DragEvent, stageId: string) => {
    e.preventDefault()
    const id = e.dataTransfer.getData('text/plain') || draggingId
    const sourceStageId = draggingStageId
    handleDragEnd()
    if (!id) return
    // Soltar na mesma coluna não gera PATCH
    if (sourceStageId === stageId) return
    onMoveOpportunity(id, stageId)
  }

  // "Mover para" do menu: o cartão só lista as outras etapas, então nunca é a mesma coluna
  const handleMoveFromMenu = (opportunity: Opportunity, stageId: string) => {
    if (opportunity.stageId === stageId) return
    onMoveOpportunity(opportunity.id, stageId)
  }

  return (
    // Região rolável na horizontal: focável para rolar pelo teclado (setas).
    // `relative` contém os textos .eia-sr-only (absolutos) dos cartões: sem ele,
    // eles escapam da rolagem e alargam a página no celular.
    <div
      role="region"
      aria-label="Quadro de oportunidades"
      tabIndex={0}
      className="relative min-h-0 flex-1 overflow-x-auto overflow-y-hidden rounded-eia-panel focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-eia-focus"
    >
      <div className="flex h-full gap-(--eia-space-3) pb-(--eia-space-2)">
        {columns.map((column) => (
          <KanbanColumn
            key={column.stage.id}
            column={column}
            stages={stages}
            isDragOver={dragOverStageId === column.stage.id && draggingStageId !== column.stage.id}
            draggingId={draggingId}
            onDragStartCard={handleDragStart}
            onDragEndCard={handleDragEnd}
            onDragOver={(e) => handleDragOver(e, column.stage.id)}
            onDragLeave={(e) => handleDragLeave(e, column.stage.id)}
            onDrop={(e) => handleDrop(e, column.stage.id)}
            onMoveOpportunity={handleMoveFromMenu}
            onAddOpportunity={onAddOpportunity}
            onChangeStatus={onChangeStatus}
            onEditOpportunity={onEditOpportunity}
            onDeleteOpportunity={onDeleteOpportunity}
          />
        ))}
      </div>
    </div>
  )
}
