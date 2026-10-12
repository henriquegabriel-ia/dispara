'use client'

import React from 'react'
import { Trash2 } from 'lucide-react'

import { ConfirmDialog } from '@/components/app/ConfirmDialog'

export interface ConfirmDeleteModalProps {
  /** Whether the modal is open */
  isOpen: boolean
  /** Modal title */
  title: string
  /** Description text (default: "Esta ação não pode ser desfeita.") */
  description?: string
  /** Single item name to display */
  itemName?: string
  /** List of item names to delete (for bulk delete) */
  itemsToDelete?: string[]
  /** Custom content to show instead of itemName/itemsToDelete */
  children?: React.ReactNode
  /** Number of items being deleted (for button text) */
  count?: number
  /** Whether deletion is in progress */
  isDeleting?: boolean
  /** Callback when user confirms deletion */
  onConfirm: () => void
  /** Callback when user cancels */
  onCancel: () => void
  /** Button text (default: "Confirmar exclusão" or "Excluir X itens" if count > 1) */
  confirmText?: string
  /** Loading button text (default: "Excluindo…") */
  loadingText?: string
}

/**
 * Confirmação de exclusão reutilizável, sobre o ConfirmDialog (tom destrutivo).
 * Suporta item único, lista de itens (exclusão em massa) ou conteúdo próprio.
 *
 * Quem chama controla o fechamento (`onCancel`/estado `isOpen`): o diálogo não
 * fecha sozinho após `onConfirm`, para mostrar "Excluindo…" enquanto a
 * exclusão roda. Durante `isDeleting`, Escape e "Cancelar" ficam bloqueados.
 * Ao fechar, o ConfirmDialog congela o conteúdo (título, corpo, largura,
 * rótulos): quem chama pode limpar item/lista no mesmo batch que fecha.
 *
 * @example
 * <ConfirmDeleteModal
 *   isOpen={isOpen}
 *   title="Excluir template"
 *   itemName={template.name}
 *   onConfirm={handleDelete}
 *   onCancel={() => setIsOpen(false)}
 * />
 *
 * @example
 * <ConfirmDeleteModal
 *   isOpen={isOpen}
 *   title="Excluir templates"
 *   itemsToDelete={['Template 1', 'Template 2']}
 *   count={2}
 *   onConfirm={handleBulkDelete}
 *   onCancel={() => setIsOpen(false)}
 * />
 */
export function ConfirmDeleteModal({
  isOpen,
  title,
  description = 'Esta ação não pode ser desfeita.',
  itemName,
  itemsToDelete,
  children,
  count = 1,
  isDeleting = false,
  onConfirm,
  onCancel,
  confirmText,
  loadingText = 'Excluindo…',
}: ConfirmDeleteModalProps) {
  const buttonText = confirmText || (count > 1 ? `Excluir ${count} itens` : 'Confirmar exclusão')
  const list = !children && itemsToDelete && itemsToDelete.length > 0 ? itemsToDelete : null

  return (
    <ConfirmDialog
      open={isOpen}
      onOpenChange={(next) => {
        if (!next) onCancel()
      }}
      title={title}
      description={description}
      tone="danger"
      confirmLabel={buttonText}
      loadingLabel={loadingText}
      confirmIcon={<Trash2 />}
      loading={isDeleting}
      onConfirm={onConfirm}
      closeOnConfirm={false}
      size={list ? 'md' : 'sm'}
    >
      {/* Cada ramo vem num <div>: `.eia-overlay-body > p` (eia.css, sem @layer)
          pintaria um <p> filho direto de cinza e venceria o text-eia-text do nome. */}
      {children ? (
        children
      ) : list ? (
        <div>
          <p className="text-(length:--eia-type-control) leading-(--eia-line-body) text-eia-muted">
            Você está prestes a excluir{' '}
            <strong className="font-(--eia-weight-semibold) text-eia-text tabular-nums">
              {list.length.toLocaleString('pt-BR')} {list.length === 1 ? 'item' : 'itens'}
            </strong>
            :
          </p>
          <ul className="mt-(--eia-space-3) max-h-32 space-y-(--eia-space-1) overflow-y-auto">
            {list.map((item) => (
              <li
                key={item}
                className="truncate rounded-(--eia-radius-small) border border-eia-border-subtle bg-eia-code px-(--eia-space-2) py-(--eia-space-1) font-mono text-(length:--eia-type-caption) text-eia-code-text"
              >
                {item}
              </li>
            ))}
          </ul>
        </div>
      ) : itemName ? (
        <div>
          <p className="text-(length:--eia-type-control) leading-(--eia-line-body) text-eia-muted">
            Você está prestes a excluir:
          </p>
          <p className="mt-(--eia-space-1) break-words font-(--eia-weight-semibold) text-eia-text">
            {itemName}
          </p>
        </div>
      ) : null}
    </ConfirmDialog>
  )
}
