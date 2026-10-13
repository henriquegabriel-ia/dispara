'use client'

import React, { useId } from 'react'
import { Inbox, Plus } from 'lucide-react'
import { EiaBadge, EiaButton, EiaIconButton } from '@/components/eia'
import { cn } from '@/lib/utils'
import type { Opportunity, OpportunityStatus, PipelineStage } from '@/services/crmService'
import type { StageColumn } from '@/hooks/useCrm'
import { OpportunityCard } from '@/components/features/crm/OpportunityCard'
import { formatBRL } from '@/components/features/crm/crm-format'

export interface KanbanColumnProps {
  column: StageColumn
  /** Todas as etapas do pipeline (para o "Mover para" dos cartões) */
  stages: PipelineStage[]
  isDragOver: boolean
  draggingId: string | null
  onDragStartCard: (e: React.DragEvent, opportunity: Opportunity) => void
  onDragEndCard: () => void
  onDragOver: (e: React.DragEvent) => void
  onDragLeave: (e: React.DragEvent) => void
  onDrop: (e: React.DragEvent) => void
  onMoveOpportunity: (opportunity: Opportunity, stageId: string) => void
  onAddOpportunity: (stageId: string) => void
  onChangeStatus: (opportunity: Opportunity, status: OpportunityStatus) => void
  onEditOpportunity: (opportunity: Opportunity) => void
  onDeleteOpportunity: (opportunity: Opportunity) => void
}

/**
 * Coluna do kanban (= etapa do pipeline).
 * Alvo de drop do drag and drop nativo; quando é o alvo, ganha a borda de foco
 * e o plano de hover do DS.
 */
export function KanbanColumn({
  column,
  stages,
  isDragOver,
  draggingId,
  onDragStartCard,
  onDragEndCard,
  onDragOver,
  onDragLeave,
  onDrop,
  onMoveOpportunity,
  onAddOpportunity,
  onChangeStatus,
  onEditOpportunity,
  onDeleteOpportunity,
}: KanbanColumnProps) {
  const { stage, opportunities, totalValue } = column
  const headingId = useId()
  const count = opportunities.length
  const countLabel = `${count.toLocaleString('pt-BR')} ${count === 1 ? 'oportunidade' : 'oportunidades'}`

  return (
    <section
      aria-labelledby={headingId}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      data-drag-over={isDragOver || undefined}
      className={cn(
        'flex h-full w-72 shrink-0 flex-col rounded-eia-panel border',
        'transition-[border-color,background-color] duration-(--eia-motion-fast) ease-(--eia-motion-ease)',
        isDragOver ? 'border-eia-focus bg-eia-hover/60' : 'border-eia-border-subtle bg-eia-surface/40'
      )}
    >
      {/* Cabeçalho: nome + contagem + soma em BRL + atalho de nova oportunidade */}
      <header className="shrink-0 px-(--eia-space-4) pt-(--eia-space-3) pb-(--eia-space-3)">
        <div className="flex items-center justify-between gap-(--eia-space-2)">
          <div className="flex min-w-0 items-center gap-(--eia-space-2)">
            {/*
             * Até duas linhas (a coluna tem 18rem); nomes maiores que isso
             * mostram o texto completo no title.
             */}
            <h2
              id={headingId}
              title={stage.name}
              className="line-clamp-2 min-w-0 [overflow-wrap:anywhere] text-(length:--eia-type-control) font-(--eia-weight-semibold) text-eia-text"
            >
              {stage.name}
            </h2>
            <EiaBadge size="sm" className="tabular-nums">
              <span aria-hidden="true">{count.toLocaleString('pt-BR')}</span>
              <span className="eia-sr-only">{countLabel}</span>
            </EiaBadge>
          </div>
          <EiaIconButton
            size="sm"
            label={`Criar oportunidade em ${stage.name}`}
            onClick={() => onAddOpportunity(stage.id)}
          >
            <Plus size={16} />
          </EiaIconButton>
        </div>
        <p className="mt-(--eia-space-1) text-(length:--eia-type-label) text-eia-muted">
          Total <span className="font-(--eia-weight-semibold) text-eia-text tabular-nums">{formatBRL(totalValue)}</span>
        </p>
      </header>

      {/* Cartões da etapa */}
      <div className="min-h-0 flex-1 overflow-y-auto px-(--eia-space-3) pb-(--eia-space-3)">
        {count === 0 ? (
          <div className="flex flex-col items-center gap-(--eia-space-3) rounded-eia-control border border-dashed border-eia-border px-(--eia-space-4) py-(--eia-space-6) text-center">
            <Inbox aria-hidden="true" className="size-5 text-eia-subtle" />
            <p className="text-(length:--eia-type-label) leading-(--eia-line-body) text-eia-muted">
              Nenhuma oportunidade nesta etapa. Arraste um cartão para cá ou crie uma nova.
            </p>
            <EiaButton
              variant="ghost"
              size="sm"
              leadingIcon={<Plus />}
              onClick={() => onAddOpportunity(stage.id)}
            >
              Criar oportunidade
            </EiaButton>
          </div>
        ) : (
          <ul className="flex flex-col gap-(--eia-space-2)">
            {opportunities.map((opportunity) => (
              <li key={opportunity.id}>
                <OpportunityCard
                  opportunity={opportunity}
                  stages={stages}
                  isDragging={draggingId === opportunity.id}
                  onDragStart={onDragStartCard}
                  onDragEnd={onDragEndCard}
                  onMove={onMoveOpportunity}
                  onChangeStatus={onChangeStatus}
                  onEdit={onEditOpportunity}
                  onDelete={onDeleteOpportunity}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
