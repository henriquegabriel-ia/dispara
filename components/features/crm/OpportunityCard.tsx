'use client'

import React, { useId } from 'react'
import {
  ArrowRight,
  CircleSlash,
  CircleX,
  Clock,
  Ellipsis,
  Pencil,
  Phone,
  RotateCcw,
  Trash2,
  Trophy,
} from 'lucide-react'
import { EiaBadge, EiaIconButton, EiaMenu, type EiaMenuGroup } from '@/components/eia'
import { EiaAvatar } from '@/components/eia/extended'
import { cn } from '@/lib/utils'
import { formatRelativeTime } from '@/lib/date-utils'
import type { Opportunity, OpportunityStatus, PipelineStage } from '@/services/crmService'
import { formatBRL, getOpportunityContactLabel } from '@/components/features/crm/crm-format'

/**
 * Selo de status da oportunidade (exibido quando != open): texto + ícone, no tom
 * de estado do DS (sem segunda cor decorativa; "abandonada" é neutro).
 */
const STATUS_BADGES: Record<
  Exclude<OpportunityStatus, 'open'>,
  { label: string; tone: 'success' | 'danger' | 'neutral'; icon: React.ReactNode }
> = {
  won: { label: 'Ganha', tone: 'success', icon: <Trophy aria-hidden="true" /> },
  lost: { label: 'Perdida', tone: 'danger', icon: <CircleX aria-hidden="true" /> },
  abandoned: { label: 'Abandonada', tone: 'neutral', icon: <CircleSlash aria-hidden="true" /> },
}

/** Data completa da entrada na etapa (dica ao passar o mouse), em pt-BR. */
const stageDateFormatter = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'long',
  timeStyle: 'short',
})

function formatStageDate(value: string): string | undefined {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? undefined : `Nesta etapa desde ${stageDateFormatter.format(date)}`
}

export interface OpportunityCardProps {
  opportunity: Opportunity
  /** Etapas do pipeline (ordem do quadro): alimentam "Mover para", alternativa ao arraste */
  stages: PipelineStage[]
  isDragging: boolean
  onDragStart: (e: React.DragEvent, opportunity: Opportunity) => void
  onDragEnd: () => void
  onMove: (opportunity: Opportunity, stageId: string) => void
  onChangeStatus: (opportunity: Opportunity, status: OpportunityStatus) => void
  onEdit: (opportunity: Opportunity) => void
  onDelete: (opportunity: Opportunity) => void
}

/**
 * Cartão de oportunidade do kanban (superfície dense).
 * Arrastável via HTML5 drag and drop nativo; o menu de ações oferece o mesmo
 * movimento por teclado ("Mover para"), além de status, edição e exclusão.
 */
export function OpportunityCard({
  opportunity,
  stages,
  isDragging,
  onDragStart,
  onDragEnd,
  onMove,
  onChangeStatus,
  onEdit,
  onDelete,
}: OpportunityCardProps) {
  const titleId = useId()
  const contactLabel = getOpportunityContactLabel(opportunity)
  const badge = opportunity.status !== 'open' ? STATUS_BADGES[opportunity.status] : null
  const relativeTime = formatRelativeTime(opportunity.stageChangedAt)

  const statusItems = [
    opportunity.status !== 'won' && {
      label: 'Marcar como ganha',
      icon: <Trophy size={16} />,
      onSelect: () => onChangeStatus(opportunity, 'won'),
    },
    opportunity.status !== 'lost' && {
      label: 'Marcar como perdida',
      icon: <CircleX size={16} />,
      onSelect: () => onChangeStatus(opportunity, 'lost'),
    },
    opportunity.status !== 'abandoned' && {
      label: 'Marcar como abandonada',
      icon: <CircleSlash size={16} />,
      onSelect: () => onChangeStatus(opportunity, 'abandoned'),
    },
    opportunity.status !== 'open' && {
      label: 'Reabrir oportunidade',
      icon: <RotateCcw size={16} />,
      onSelect: () => onChangeStatus(opportunity, 'open'),
    },
  ].filter((item) => item !== false)

  const moveItems = stages
    .filter((stage) => stage.id !== opportunity.stageId)
    .map((stage) => ({
      label: stage.name,
      icon: <ArrowRight size={16} />,
      onSelect: () => onMove(opportunity, stage.id),
    }))

  const menuGroups: EiaMenuGroup[] = [
    { id: 'status', items: statusItems },
    ...(moveItems.length > 0 ? [{ id: 'move', label: 'Mover para', items: moveItems }] : []),
    {
      id: 'manage',
      items: [
        { label: 'Editar oportunidade', icon: <Pencil size={16} />, onSelect: () => onEdit(opportunity) },
        {
          label: 'Excluir oportunidade',
          icon: <Trash2 size={16} />,
          danger: true,
          onSelect: () => onDelete(opportunity),
        },
      ],
    },
  ]

  return (
    <article
      draggable
      aria-labelledby={titleId}
      onDragStart={(e) => onDragStart(e, opportunity)}
      onDragEnd={onDragEnd}
      className={cn(
        'rounded-eia-control border border-eia-border-subtle bg-(--eia-material-dense) p-(--eia-space-3)',
        'cursor-grab select-none active:cursor-grabbing',
        'transition-[border-color,opacity] duration-(--eia-motion-fast) ease-(--eia-motion-ease) hover:border-eia-border',
        isDragging && 'opacity-40'
      )}
    >
      <div className="flex items-start justify-between gap-(--eia-space-2)">
        <h3
          id={titleId}
          className="min-w-0 pt-(--eia-space-1) break-words text-(length:--eia-type-control) leading-(--eia-line-control) font-(--eia-weight-semibold) text-eia-text"
        >
          {opportunity.name}
        </h3>
        <EiaMenu
          label={`Ações da oportunidade ${opportunity.name}`}
          trigger={
            <EiaIconButton size="sm" label={`Ações da oportunidade ${opportunity.name}`}>
              <Ellipsis size={16} />
            </EiaIconButton>
          }
          groups={menuGroups}
        />
      </div>

      {contactLabel && (
        <div className="mt-(--eia-space-2) flex min-w-0 items-center gap-(--eia-space-2) text-(length:--eia-type-label) text-eia-muted">
          {opportunity.contactName ? (
            // O nome já está escrito ao lado: o avatar é só apoio visual
            <span aria-hidden="true" className="inline-flex shrink-0">
              <EiaAvatar name={opportunity.contactName} size="sm" />
            </span>
          ) : (
            <Phone aria-hidden="true" className="size-4 shrink-0" />
          )}
          <span className="truncate">{contactLabel}</span>
        </div>
      )}

      <div className="mt-(--eia-space-3) flex items-end justify-between gap-(--eia-space-2)">
        <div className="flex min-w-0 flex-wrap items-center gap-(--eia-space-2)">
          {opportunity.value !== null && (
            <span className="text-(length:--eia-type-control) font-(--eia-weight-semibold) text-eia-text tabular-nums">
              <span className="eia-sr-only">Valor: </span>
              {formatBRL(opportunity.value)}
            </span>
          )}
          {badge && (
            <EiaBadge size="sm" tone={badge.tone}>
              {badge.icon}
              {badge.label}
            </EiaBadge>
          )}
        </div>

        {relativeTime && (
          <span
            className="inline-flex shrink-0 items-center gap-(--eia-space-1) whitespace-nowrap text-(length:--eia-type-caption) text-eia-subtle"
            title={formatStageDate(opportunity.stageChangedAt)}
          >
            <Clock aria-hidden="true" className="size-3.5" />
            <span className="eia-sr-only">Nesta etapa </span>
            <time dateTime={opportunity.stageChangedAt}>{relativeTime}</time>
          </span>
        )}
      </div>
    </article>
  )
}
