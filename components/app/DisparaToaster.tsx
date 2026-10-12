'use client'

import { useEffect } from 'react'
import { Check, CircleAlert, Info, LoaderCircle, TriangleAlert } from 'lucide-react'
import { EiaIconButton } from '@/components/eia'
import {
  Toast,
  ToastClose,
  ToastContent,
  ToastDescription,
  ToastPortal,
  ToastProvider,
  ToastTitle,
  ToastViewport,
  toast as manager,
  useToastManager,
} from '@/components/ui/toast'
import { markToasterReady } from '@/lib/toast'

/** type do toast (lib/toast.ts) → tom visual do DS (data-tone em .eia-toast). */
const TONE: Record<string, 'success' | 'danger' | 'warning' | 'info'> = {
  success: 'success',
  error: 'danger',
  warning: 'warning',
  info: 'info',
  loading: 'info',
}

const ICON = {
  success: Check,
  danger: CircleAlert,
  warning: TriangleAlert,
  info: Info,
} as const

function DisparaToastList() {
  const { toasts } = useToastManager()

  return (
    <ToastPortal>
      <ToastViewport className="eia-theme eia-toast-viewport" aria-label="Notificações">
        {toasts.map((item) => {
          const tone = item.type ? TONE[item.type] ?? 'info' : undefined
          const Icon = item.type === 'loading' ? LoaderCircle : tone ? ICON[tone] : null
          return (
            <Toast key={item.id} toast={item} className="eia-toast" data-tone={tone}>
              <ToastContent className="eia-toast-content">
                {Icon && (
                  <Icon
                    className={item.type === 'loading' ? 'eia-feedback-icon animate-spin' : 'eia-feedback-icon'}
                    aria-hidden="true"
                  />
                )}
                <div className="eia-toast-copy">
                  <ToastTitle className="eia-feedback-title" />
                  <ToastDescription className="eia-feedback-description" />
                </div>
                <ToastClose
                  aria-label="Fechar notificação"
                  render={<EiaIconButton label="Fechar notificação" size="sm" />}
                />
              </ToastContent>
            </Toast>
          )
        })}
      </ToastViewport>
    </ToastPortal>
  )
}

/**
 * Único provider inscrito no gerenciador global de toasts (lib/toast.ts).
 * Vai uma vez no layout raiz. O efeito deste componente roda depois do efeito
 * de inscrição do ToastProvider (filho), então a fila de lib/toast só é
 * liberada quando já há quem escute.
 */
export function DisparaToaster() {
  useEffect(() => {
    markToasterReady()
  }, [])

  return (
    <ToastProvider toastManager={manager} limit={3}>
      <DisparaToastList />
    </ToastProvider>
  )
}
