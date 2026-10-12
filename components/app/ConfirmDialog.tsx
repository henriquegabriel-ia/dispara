'use client'

import * as React from 'react'
import { AlertDialog as AlertDialogPrimitive } from '@base-ui/react/alert-dialog'

import { EiaButton } from '@/components/eia'
import {
  AlertDialog,
  AlertDialogDescription,
  AlertDialogOverlay,
  AlertDialogPortal,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { logger } from '@/lib/logger'
import { cn } from '@/lib/utils'

/*
 * ConfirmDialog — confirmação (inclusive destrutiva) do Dispara.
 *
 * O DS não tem confirmação destrutiva: o EiaDialog fecha sempre por clique
 * fora/Escape e mostra o kicker de marca. Aqui a base é a primitiva AlertDialog
 * da Base UI (components/ui/alert-dialog.tsx) com o markup/classes do overlay do
 * DS (portal `eia-theme eia-overlay-portal`, scrim, `eia-overlay eia-dialog`,
 * cabeçalho/corpo/rodapé `eia-overlay-*`), sem kicker.
 *
 * Comportamento:
 * - role="alertdialog" (Base UI), título/descrição ligados ao popup;
 * - nunca fecha por clique fora (padrão de alertdialog: escolha explícita);
 * - Escape e "Cancelar" fecham, exceto durante o carregamento; nesse caso o
 *   Escape é marcado como tratado (preventDefault) para não fechar um Modal
 *   irmão aberto por baixo (ex.: "Gerenciar etapas" → excluir etapa);
 * - foco inicial em "Cancelar" quando o tom é destrutivo;
 * - botões com `focusableWhenDisabled`: no carregamento ficam com
 *   aria-disabled (não disabled nativo) e o foco não cai no <body>; o rótulo
 *   de carregamento é anunciado numa região de status;
 * - `onConfirm` pode ser assíncrono: o botão mostra carregamento enquanto a
 *   promessa corre e o diálogo fecha quando ela resolve (`closeOnConfirm`).
 *   Se rejeitar, o diálogo continua aberto para nova tentativa — exibir o erro
 *   é responsabilidade de quem chamou (toast, alerta);
 * - o conteúdo exibido congela ao fechar: o popup da Base UI segue montado
 *   durante a animação de saída, e quem chama costuma limpar os dados no
 *   mesmo batch que fecha (item/lista viram vazios). Sem o congelamento, a
 *   largura, o corpo e o rótulo trocariam no meio do fade-out.
 */

export type ConfirmDialogTone = 'danger' | 'default'

export interface ConfirmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Pergunta ou ação em jogo ("Excluir pipeline?") */
  title: string
  /** Consequência da ação, em uma ou duas frases */
  description?: React.ReactNode
  /** Rótulo do botão de confirmar: verbo + objeto ("Excluir pipeline") */
  confirmLabel?: string
  cancelLabel?: string
  /** `danger` para ações destrutivas/irreversíveis */
  tone?: ConfirmDialogTone
  /** Carregamento controlado por quem chama (ex.: `isPending` da mutação) */
  loading?: boolean
  /** Rótulo do botão durante o carregamento ("Excluindo…"); padrão: `confirmLabel` */
  loadingLabel?: string
  /** Ícone opcional à esquerda do rótulo de confirmar (Lucide, decorativo) */
  confirmIcon?: React.ReactNode
  /** Ação confirmada; pode ser assíncrona */
  onConfirm: () => void | Promise<void>
  /**
   * Fecha o diálogo quando `onConfirm` resolve. Use `false` quando quem chama
   * controla o fechamento (ex.: fecha só no sucesso da mutação).
   */
  closeOnConfirm?: boolean
  /** Largura do diálogo do DS: `sm` (380px) ou `md` (520px) */
  size?: 'sm' | 'md'
  /**
   * Para onde o foco volta ao fechar (Base UI). Útil quando o gatilho foi
   * desmontado (ex.: item de um popover/menu que fechou ao abrir o diálogo);
   * sem isso o foco cai no <body>.
   */
  finalFocus?: AlertDialogPrimitive.Popup.Props['finalFocus']
  /** Conteúdo extra no corpo (lista de itens, aviso) */
  children?: React.ReactNode
  className?: string
}

/** O que o diálogo mostra; congelado enquanto fechado (ver comentário do topo). */
interface ConfirmDialogView {
  title: string
  description: React.ReactNode
  confirmLabel: string
  cancelLabel: string
  tone: ConfirmDialogTone
  /** `loading` de quem chama ou a promessa de `onConfirm` em andamento */
  busy: boolean
  loadingLabel: string | undefined
  confirmIcon: React.ReactNode
  size: 'sm' | 'md'
  children: React.ReactNode
}

function isSameView(a: ConfirmDialogView, b: ConfirmDialogView) {
  return (Object.keys(a) as (keyof ConfirmDialogView)[]).every((key) => Object.is(a[key], b[key]))
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Confirmar',
  cancelLabel = 'Cancelar',
  tone = 'default',
  loading = false,
  loadingLabel,
  confirmIcon,
  onConfirm,
  closeOnConfirm = true,
  size = 'sm',
  finalFocus,
  children,
  className,
}: ConfirmDialogProps) {
  const [pending, setPending] = React.useState(false)

  // Aberto: mostra as props atuais e guarda uma cópia. Fechado: mostra a
  // última cópia (estado derivado durante o render; ao guardar, o React
  // re-renderiza na hora com as mesmas props, então a comparação estabiliza).
  const liveView: ConfirmDialogView = {
    title,
    description,
    confirmLabel,
    cancelLabel,
    tone,
    busy: loading || pending,
    loadingLabel,
    confirmIcon,
    size,
    children,
  }
  const [lastOpenView, setLastOpenView] = React.useState(liveView)
  if (open && !isSameView(lastOpenView, liveView)) setLastOpenView(liveView)
  const view = open ? liveView : lastOpenView
  const busy = view.busy
  const cancelRef = React.useRef<HTMLButtonElement>(null)

  // Evita setState/fechamento depois de desmontar (a promessa pode resolver tarde).
  const mountedRef = React.useRef(true)
  React.useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const handleOpenChange = (
    next: boolean,
    details: AlertDialogPrimitive.Root.ChangeEventDetails,
  ) => {
    if (!next && busy) {
      // Durante o carregamento o diálogo só fecha pelo resultado da ação. Com
      // cancel() a Base UI não chama preventDefault no Escape; sem marcar aqui,
      // o listener de um Modal irmão aberto por baixo (que respeita
      // `defaultPrevented`) recebe a mesma tecla e fecharia por trás.
      if (details.reason === 'escape-key') details.event.preventDefault()
      details.cancel()
      return
    }
    onOpenChange(next)
  }

  const handleConfirm = async () => {
    if (busy) return
    setPending(true)
    try {
      await onConfirm()
      if (closeOnConfirm && mountedRef.current) onOpenChange(false)
    } catch (error) {
      logger.error('Falha ao confirmar a ação do diálogo', {
        title,
        error: error instanceof Error ? error.message : String(error),
      })
    } finally {
      if (mountedRef.current) setPending(false)
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogPortal className="eia-theme eia-overlay-portal">
        <AlertDialogOverlay className="eia-overlay-scrim" />
        <AlertDialogPrimitive.Popup
          data-slot="confirm-dialog"
          data-size={view.size}
          data-tone={view.tone}
          // Aberto já ocupado (ex.: outra exclusão ainda em andamento): `true`
          // deixa a Base UI escolher o alvo, para o foco entrar no alertdialog.
          initialFocus={view.tone === 'danger' && !busy ? cancelRef : true}
          finalFocus={finalFocus}
          aria-busy={busy || undefined}
          className={cn('eia-overlay eia-dialog', className)}
        >
          {/*
            O .eia-overlay-header reserva 70px à direita para o X do EiaDialog; aqui
            não há X (alertdialog), então o recuo volta ao da escala (32px; ~24px no
            celular, como o padding do DS ≤600px). Sem corpo, a borda do cabeçalho
            somaria com a do rodapé (linha dupla).
          */}
          <header
            className="eia-overlay-header"
            style={{
              paddingRight: 'min(var(--eia-space-8), 6vw)',
              ...(view.children ? null : { borderBottom: 0 }),
            }}
          >
            <AlertDialogTitle className="eia-overlay-title">{view.title}</AlertDialogTitle>
            {view.description && (
              <AlertDialogDescription className="eia-overlay-description">
                {view.description}
              </AlertDialogDescription>
            )}
          </header>
          {view.children && <div className="eia-overlay-body">{view.children}</div>}
          <footer className="eia-overlay-footer">
            <EiaButton
              ref={cancelRef}
              variant="secondary"
              onClick={() => onOpenChange(false)}
              disabled={busy}
              focusableWhenDisabled
            >
              {view.cancelLabel}
            </EiaButton>
            <EiaButton
              variant={view.tone === 'danger' ? 'danger' : 'primary'}
              onClick={handleConfirm}
              loading={busy}
              focusableWhenDisabled
              leadingIcon={view.confirmIcon}
            >
              {busy && view.loadingLabel ? view.loadingLabel : view.confirmLabel}
            </EiaButton>
          </footer>
          {/* Anuncia o carregamento (a região existe antes de o texto mudar). */}
          <span role="status" className="eia-sr-only">
            {busy ? view.loadingLabel || 'Processando…' : ''}
          </span>
        </AlertDialogPrimitive.Popup>
      </AlertDialogPortal>
    </AlertDialog>
  )
}

export default ConfirmDialog
