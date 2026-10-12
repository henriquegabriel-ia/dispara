/**
 * Toast do Dispara sobre o toast do DS Empreende IA V2.
 *
 * Mesma API que o app usava do sonner (toast.success/error/warning/info/
 * message/loading/dismiss/promise, opções description/duration/id), em cima
 * do gerenciador global da Base UI (`toast` de components/ui/toast.tsx). O
 * visual é o do DS: components/app/DisparaToaster renderiza o markup
 * `eia-toast` e é o ÚNICO provider inscrito nesse gerenciador.
 *
 * Funciona fora de componentes React (hooks, services): o gerenciador é um
 * emissor de eventos. Como ele não guarda eventos emitidos antes de o provider
 * se inscrever, os toasts ficam numa fila até DisparaToaster chamar
 * markToasterReady().
 */

import type { ReactNode } from 'react'
import { toast as manager } from '@/components/ui/toast'

export type ToastType = 'success' | 'error' | 'warning' | 'info' | 'loading'

export interface ToastOptions {
  description?: ReactNode
  /** ms; padrão 5000. `Infinity` mantém o toast até ser fechado. */
  duration?: number
  /** Mesmo id = atualiza o toast existente em vez de empilhar outro. */
  id?: string | number
}

type PromiseMessages<T> = {
  loading: ReactNode
  success: ReactNode | ((value: T) => ReactNode)
  error: ReactNode | ((error: unknown) => ReactNode)
}

const DEFAULT_DURATION = 5000

let ready = false
let sequence = 0
const pending: Array<() => void> = []

function run(fn: () => void) {
  if (ready) fn()
  else pending.push(fn)
}

/** Chamado pelo DisparaToaster depois que o provider se inscreveu no gerenciador. */
export function markToasterReady() {
  ready = true
  for (const fn of pending.splice(0)) fn()
}

/** Só para testes: volta ao estado inicial (fila vazia, provider ausente). */
export function resetToastQueueForTests() {
  ready = false
  sequence = 0
  pending.length = 0
}

function timeoutFor(type: ToastType | undefined, duration: number | undefined): number {
  if (type === 'loading') return 0
  if (duration === undefined) return DEFAULT_DURATION
  return Number.isFinite(duration) ? duration : 0
}

function show(type: ToastType | undefined, title: ReactNode, options: ToastOptions = {}): string {
  const id = options.id !== undefined ? String(options.id) : `toast-${++sequence}`
  run(() => {
    manager.add({
      id,
      title,
      description: options.description,
      type,
      timeout: timeoutFor(type, options.duration),
      priority: type === 'error' || type === 'warning' ? 'high' : 'low',
    })
  })
  return id
}

export const toast = {
  success: (title: ReactNode, options?: ToastOptions) => show('success', title, options),
  error: (title: ReactNode, options?: ToastOptions) => show('error', title, options),
  warning: (title: ReactNode, options?: ToastOptions) => show('warning', title, options),
  info: (title: ReactNode, options?: ToastOptions) => show('info', title, options),
  /** Neutro, sem ícone de estado. */
  message: (title: ReactNode, options?: ToastOptions) => show(undefined, title, options),
  /** Fica aberto até virar outro toast (mesmo id) ou ser fechado. */
  loading: (title: ReactNode, options?: ToastOptions) => show('loading', title, options),
  dismiss: (id?: string | number) => {
    run(() => manager.close(id === undefined ? undefined : String(id)))
  },
  promise: <T,>(promise: Promise<T>, messages: PromiseMessages<T>): Promise<T> => {
    const id = show('loading', messages.loading)
    promise.then(
      (value) => {
        const title = typeof messages.success === 'function' ? messages.success(value) : messages.success
        show('success', title, { id })
      },
      (error: unknown) => {
        const title = typeof messages.error === 'function' ? messages.error(error) : messages.error
        show('error', title, { id })
      },
    )
    return promise
  },
}
