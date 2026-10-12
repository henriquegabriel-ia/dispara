'use client'

import React, { createContext, useContext } from 'react'
import { Dialog as DialogPrimitive } from '@base-ui/react/dialog'
import { X } from 'lucide-react'

import { EiaButton, EiaIconButton } from '@/components/eia'
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

/*
 * Modal genérico do Dispara sobre a primitiva Base UI do DS (a mesma do
 * EiaDialog), com o markup/classes do overlay do DS: portal `eia-theme
 * eia-overlay-portal`, scrim `eia-overlay-scrim`, popup `eia-overlay
 * eia-dialog`, corpo `eia-overlay-body`, título `eia-overlay-title`.
 *
 * Diferenças intencionais em relação ao EiaDialog (não editável):
 * - sem o kicker fixo de marca (tela de produto);
 * - o conteúdo inteiro (ModalHeader + campos + ModalFooter) vem em `children`,
 *   como na API antiga, e fica no corpo rolável;
 * - o botão fechar vem DEPOIS do conteúdo no DOM (posicionado no canto): o foco
 *   inicial da Base UI cai no primeiro campo do formulário, e não no "Fechar".
 *
 * A11y pela Base UI: foco contido, fundo inerte, Escape, restauração do foco e
 * `aria-labelledby` ligado ao título (prop `title` ou o título do ModalHeader).
 */

export interface ModalProps {
  /** Whether the modal is open */
  isOpen: boolean
  /** Callback when modal should close */
  onClose?: () => void
  /** Modal title (optional - for accessibility) */
  title?: string
  /** Modal content */
  children: React.ReactNode
  /** Max width variant */
  maxWidth?: 'sm' | 'md' | 'lg' | 'xl' | '2xl'
  /**
   * Tom semântico. O DS não usa borda colorida em diálogos: o valor fica em
   * `data-tone` e o estado é comunicado pelo conteúdo (texto e ação).
   */
  variant?: 'default' | 'warning' | 'danger' | 'success'
  /** Whether to show close button */
  showCloseButton?: boolean
  /** Whether clicking backdrop closes modal */
  closeOnBackdropClick?: boolean
  /** Whether pressing Escape closes modal */
  closeOnEscape?: boolean
  /** Additional className for the modal container */
  className?: string
}

/**
 * Larguras: o `.eia-dialog` fixa `width` por `data-size` (380/520/800px) e não
 * define `max-width`, então o `max-w-*` refina as larguras intermediárias da
 * API antiga sem brigar com o CSS do DS.
 */
const sizeByMaxWidth = {
  sm: { size: 'sm', className: '' },
  md: { size: 'md', className: 'max-w-md' },
  lg: { size: 'md', className: '' },
  xl: { size: 'lg', className: 'max-w-xl' },
  '2xl': { size: 'lg', className: 'max-w-2xl' },
} as const

interface ModalContextValue {
  /** O Modal já renderiza um título ligado ao popup (prop `title`). */
  hasTitle: boolean
  /** Há botão fechar no canto: o ModalHeader reserva espaço à direita. */
  hasCloseButton: boolean
}

const ModalContext = createContext<ModalContextValue | null>(null)

/**
 * Base Modal component with backdrop, animations, and keyboard handling.
 * Use this as a wrapper for all modal content.
 *
 * @example
 * <Modal isOpen={isOpen} onClose={handleClose} title="Excluir etapa">
 *   <p>Esta ação não pode ser desfeita.</p>
 *   <ModalFooter>
 *     <ModalCancelButton onClick={handleClose} />
 *     <ModalConfirmButton variant="danger" onClick={handleConfirm}>Excluir etapa</ModalConfirmButton>
 *   </ModalFooter>
 * </Modal>
 */
export function Modal({
  isOpen,
  onClose,
  title,
  children,
  maxWidth = 'md',
  variant = 'default',
  showCloseButton = false,
  closeOnBackdropClick = true,
  closeOnEscape = true,
  className = '',
}: ModalProps) {
  const width = sizeByMaxWidth[maxWidth]
  const hasCloseButton = showCloseButton && !!onClose

  const handleOpenChange = (
    next: boolean,
    details: DialogPrimitive.Root.ChangeEventDetails,
  ) => {
    if (next) return
    if (details.reason === 'escape-key') {
      // Escape já tratado por uma camada acima (outro diálogo/menu aberto por
      // cima deste, ou um campo que consumiu a tecla): não fecha o Modal junto.
      if (!closeOnEscape || details.event.defaultPrevented) {
        details.cancel()
        return
      }
    }
    if (!onClose) {
      details.cancel()
      return
    }
    onClose()
  }

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange} disablePointerDismissal={!closeOnBackdropClick}>
      <DialogPortal className="eia-theme eia-overlay-portal">
        <DialogOverlay className="eia-overlay-scrim" />
        <DialogPrimitive.Popup
          data-slot="modal"
          data-size={width.size}
          data-tone={variant}
          className={cn('eia-overlay eia-dialog', width.className, className)}
        >
          <ModalContext.Provider value={{ hasTitle: !!title, hasCloseButton }}>
            <div className="eia-overlay-body">
              {title && (
                <DialogTitle
                  className={cn('eia-overlay-title', hasCloseButton && 'pr-(--eia-space-12)')}
                  style={{ marginBottom: 'var(--eia-space-6)' }}
                >
                  {title}
                </DialogTitle>
              )}
              {children}
            </div>
          </ModalContext.Provider>
          {hasCloseButton && (
            <DialogClose
              render={<EiaIconButton label="Fechar janela" className="eia-overlay-close" />}
            >
              <X aria-hidden="true" />
            </DialogClose>
          )}
        </DialogPrimitive.Popup>
      </DialogPortal>
    </Dialog>
  )
}

/**
 * Cabeçalho do Modal: ícone em caixa neutra + título e descrição com a
 * tipografia do overlay do DS. Dentro de um Modal sem `title`, o título vira o
 * `Dialog.Title` (rótulo acessível do popup).
 */
export function ModalHeader({
  icon,
  title,
  description,
  iconClassName = '',
}: {
  icon: React.ReactNode
  title: string
  description?: string
  iconClassName?: string
}) {
  const modal = useContext(ModalContext)
  const linkToDialog = !!modal && !modal.hasTitle

  return (
    <div
      className={cn(
        'mb-(--eia-space-6) flex items-start gap-(--eia-space-4)',
        modal?.hasCloseButton && 'pr-(--eia-space-12)',
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'flex size-11 shrink-0 items-center justify-center rounded-(--eia-radius-control) border border-eia-border-subtle bg-eia-raised text-eia-muted [&_svg]:size-5',
          iconClassName,
        )}
      >
        {icon}
      </span>
      <div className="flex min-w-0 flex-col gap-(--eia-space-2)">
        {linkToDialog ? (
          <DialogTitle className="eia-overlay-title">{title}</DialogTitle>
        ) : (
          <h3 className="eia-overlay-title">{title}</h3>
        )}
        {description &&
          (linkToDialog ? (
            <DialogDescription className="eia-overlay-description">{description}</DialogDescription>
          ) : (
            <p className="eia-overlay-description">{description}</p>
          ))}
      </div>
    </div>
  )
}

/**
 * Rodapé de ações do Modal: botões em colunas iguais (layout da API antiga);
 * rótulos longos quebram para a linha de baixo em vez de serem cortados.
 */
export function ModalFooter({
  children,
  className = '',
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('mt-(--eia-space-6) flex flex-wrap gap-(--eia-space-3)', className)}>
      {children}
    </div>
  )
}

/**
 * Botão padrão de cancelar (EiaButton secondary).
 */
export function ModalCancelButton({
  onClick,
  disabled = false,
  children = 'Cancelar',
}: {
  onClick: () => void
  disabled?: boolean
  children?: React.ReactNode
}) {
  return (
    <EiaButton variant="secondary" onClick={onClick} disabled={disabled} className="flex-1">
      {children}
    </EiaButton>
  )
}

/** Variante do botão de confirmar → variante do EiaButton (o DS não tem botão de aviso). */
const confirmVariants = {
  warning: 'danger',
  danger: 'danger',
  primary: 'primary',
} as const

/**
 * Botão padrão de confirmar (EiaButton danger ou primary, com estado de carregamento).
 * `focusableWhenDisabled`: desabilitado/carregando vira aria-disabled em vez de
 * disabled nativo, então o foco não cai no <body> ao confirmar (o clique segue
 * bloqueado pela Base UI e o eia.css estiliza `.eia-button[aria-disabled]`).
 */
export function ModalConfirmButton({
  onClick,
  disabled = false,
  loading = false,
  variant = 'warning',
  icon,
  loadingText,
  children,
}: {
  onClick: () => void
  disabled?: boolean
  loading?: boolean
  variant?: 'warning' | 'danger' | 'primary'
  icon?: React.ReactNode
  loadingText?: string
  children: React.ReactNode
}) {
  return (
    <EiaButton
      variant={confirmVariants[variant]}
      onClick={onClick}
      disabled={disabled}
      loading={loading}
      focusableWhenDisabled
      leadingIcon={icon}
      className="flex-1"
    >
      {loading ? loadingText || 'Processando…' : children}
    </EiaButton>
  )
}
