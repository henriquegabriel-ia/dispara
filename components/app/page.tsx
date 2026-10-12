import * as React from 'react'

import { cn } from '@/lib/utils'

/*
 * Estrutura de página do Dispara no DS Empreende IA V2.
 *
 * Tela de produto pede calma: sem eyebrow, sem faixa decorativa, título com a
 * tipografia de título do DS e descrição em corpo neutro. Os valores vêm dos
 * tokens --eia-* (escala de espaço, tipo, peso, entrelinha e tracking) por
 * utilitários Tailwind em camada: o className do consumidor continua vencendo
 * (tailwind-merge resolve o conflito), ao contrário das classes .eia-*.
 */

/**
 * Container principal de página: ritmo vertical de 2rem (--eia-space-8).
 */
export function Page({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('space-y-(--eia-space-8)', className)} {...props} />
}

/**
 * Header da página com título e ações.
 * Layout responsivo: coluna em mobile, linha em desktop.
 */
export function PageHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'flex flex-col gap-(--eia-space-4) sm:flex-row sm:items-end sm:justify-between',
        className,
      )}
      {...props}
    />
  )
}

/**
 * Título da página: --eia-type-title, peso semibold (650), entrelinha 1,12 e
 * tracking negativo da marca (--eia-tracking-tight).
 */
export function PageTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h1
      className={cn(
        'font-(family-name:--eia-font-display) text-(length:--eia-type-title) font-(--eia-weight-semibold) leading-(--eia-line-tight) tracking-(--eia-tracking-tight) text-eia-text',
        className,
      )}
      {...props}
    />
  )
}

/**
 * Descrição da página: corpo (--eia-type-body, entrelinha 1,65) em texto
 * secundário, com largura de leitura confortável.
 */
export function PageDescription({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p
      className={cn(
        'mt-(--eia-space-2) max-w-prose text-(length:--eia-type-body) leading-(--eia-line-body) text-eia-muted',
        className,
      )}
      {...props}
    />
  )
}

/**
 * Container para ações da página (botões, filtros). Abaixo de `sm` quebra
 * linha em vez de gerar rolagem horizontal; no desktop mantém a linha única
 * (quem quiser quebra também ali passa `flex-wrap`).
 */
export function PageActions({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('flex items-center gap-(--eia-space-3) max-sm:flex-wrap', className)}
      {...props}
    />
  )
}

/**
 * Seção dentro da página: ritmo vertical de 1rem (--eia-space-4).
 */
export function PageSection({ className, ...props }: React.HTMLAttributes<HTMLElement>) {
  return <section className={cn('space-y-(--eia-space-4)', className)} {...props} />
}
