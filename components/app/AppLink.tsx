import * as React from 'react'
import Link from 'next/link'

import { cn } from '@/lib/utils'

/*
 * AppLink — navegação interna com visual de botão do DS sem perder o next/link.
 *
 * O EiaLink do DS renderiza <a> puro (sem prefetch nem navegação client-side).
 * Aqui o <Link> recebe as mesmas classes/atributos do EiaButton
 * (`.eia-button[data-variant][data-size]`) e a mesma estrutura de filhos
 * (`.eia-button-icon`, `.eia-button-label`, `.eia-button-trailing`), então o CSS
 * do DS (eia.css + eia-light.css) aplica cores, foco visível, hover e tamanhos.
 *
 * Navegação ≠ ação: use AppLink para ir a outra rota e EiaButton para executar.
 */

export type AppLinkVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
export type AppLinkSize = 'sm' | 'md' | 'lg'

export type AppLinkProps = Omit<React.ComponentProps<typeof Link>, 'children'> & {
  /** Variante visual do botão do DS (padrão: primary, como o EiaButton) */
  variant?: AppLinkVariant
  /** sm = 36px, md = 44px, lg = 52px de altura mínima */
  size?: AppLinkSize
  /** Ícone decorativo antes do rótulo (Lucide, aria-hidden) */
  leadingIcon?: React.ReactNode
  /** Ícone decorativo depois do rótulo (Lucide, aria-hidden) */
  trailingIcon?: React.ReactNode
  children?: React.ReactNode
}

export function AppLink({
  variant = 'primary',
  size = 'md',
  leadingIcon,
  trailingIcon,
  className,
  children,
  ...props
}: AppLinkProps) {
  return (
    <Link
      {...props}
      className={cn('eia-button', className)}
      data-variant={variant}
      data-size={size}
    >
      {leadingIcon && (
        <span className="eia-button-icon" aria-hidden="true">
          {leadingIcon}
        </span>
      )}
      <span className="eia-button-label">{children}</span>
      {trailingIcon && (
        <span className="eia-button-icon eia-button-trailing" aria-hidden="true">
          {trailingIcon}
        </span>
      )}
    </Link>
  )
}

export default AppLink
