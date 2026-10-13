'use client'

import { useSyncExternalStore } from 'react'

const subscribeNoop = () => () => {}

/**
 * true só depois da hidratação (o snapshot de servidor é false).
 *
 * Serve para textos que dependem do ambiente, como datas no fuso do navegador:
 * o SSR e a hidratação renderizam a versão determinística e, logo depois, o
 * cliente troca pela local. Em navegação no cliente (sem hidratação) já
 * começa em true. Evita `suppressHydrationWarning`, que no React 19 mantém o
 * texto do servidor para sempre.
 */
export function useIsHydrated(): boolean {
  return useSyncExternalStore(
    subscribeNoop,
    () => true,
    () => false,
  )
}
