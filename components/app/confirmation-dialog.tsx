'use client'

import React from 'react'

import { ConfirmDialog } from '@/components/app/ConfirmDialog'

interface ConfirmationDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  confirmLabel?: string
  cancelLabel?: string
  onConfirm: () => void | Promise<void>
  variant?: 'default' | 'destructive'
  isLoading?: boolean
}

/**
 * Diálogo de confirmação (API antiga) sobre o ConfirmDialog do DS.
 *
 * Como antes, quem chama controla o fechamento após `onConfirm`; `isLoading`
 * mostra o carregamento no botão e bloqueia Escape/Cancelar.
 */
export function ConfirmationDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Confirmar',
  cancelLabel = 'Cancelar',
  onConfirm,
  variant = 'default',
  isLoading = false,
}: ConfirmationDialogProps) {
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      confirmLabel={confirmLabel}
      cancelLabel={cancelLabel}
      tone={variant === 'destructive' ? 'danger' : 'default'}
      loading={isLoading}
      onConfirm={onConfirm}
      closeOnConfirm={false}
    />
  )
}
