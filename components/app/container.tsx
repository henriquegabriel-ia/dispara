import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/**
 * Container — superfície do Dispara no DS Empreende IA V2.
 *
 * Reproduz o material `dense` do EiaPanel (plano opaco, borda sutil, raio de
 * painel) com tokens --eia-* em utilitários Tailwind. Não usa a classe
 * `.eia-panel`: o eia.css não está em @layer, então as regras do componente
 * venceriam o `className` dos ~50 consumidores (padding, borda, fundo) e o
 * `containerVariants` aplicado direto em `<details>`.
 *
 * Por que só sólido: o canvas do app é chapado (--eia-color-bg). Vidro
 * (blur + translúcido) sem fundo com variação real vira sujeira, então a
 * variante `glass` também cai no plano opaco.
 *
 * Variantes (API preservada):
 * - default / surface / glass: material dense (dados, tabelas, agrupamentos)
 * - elevated: dense com borda padrão e a sombra de painel (destaque)
 * - subtle: área rebaixada dentro de outra superfície (canvas + borda sutil)
 */
const containerVariants = cva(
  [
    "transition-[border-color,box-shadow,background-color]",
    "duration-(--eia-motion-fast) ease-(--eia-motion-ease)",
  ].join(" "),
  {
    variants: {
      variant: {
        default: [
          "rounded-(--eia-radius-panel)",
          "bg-(--eia-material-dense)",
          "border border-eia-border-subtle",
        ].join(" "),
        elevated: [
          "rounded-(--eia-radius-panel)",
          "bg-(--eia-material-dense)",
          "border border-eia-border",
          "shadow-(--eia-shadow-panel)",
        ].join(" "),
        glass: [
          "rounded-(--eia-radius-panel)",
          "bg-(--eia-material-dense)",
          "border border-eia-border-subtle",
        ].join(" "),
        surface: [
          "rounded-(--eia-radius-panel)",
          "bg-(--eia-material-dense)",
          "border border-eia-border-subtle",
        ].join(" "),
        subtle: [
          "rounded-(--eia-radius-control)",
          "bg-eia-bg",
          "border border-eia-border-subtle",
        ].join(" "),
      },
      padding: {
        none: "",
        sm: "p-(--eia-space-3)",
        md: "p-(--eia-space-4)",
        lg: "p-(--eia-space-6)",
        xl: "p-(--eia-space-8)",
      },
      hover: {
        // Mesmo retorno do EiaPanel `hoverable`: borda de acento + sombra de overlay.
        true: "hover:border-(--eia-border-accent) hover:shadow-(--eia-shadow-overlay)",
        false: "",
      },
    },
    defaultVariants: {
      variant: "default",
      padding: "md",
      hover: false,
    },
  }
)

export interface ContainerProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof containerVariants> {}

/** Material do DS correspondente a cada variante (exposto em `data-material`). */
const materialByVariant = {
  default: "dense",
  elevated: "dense",
  glass: "dense",
  surface: "dense",
  subtle: "dense",
} as const

/**
 * Container genérico com a superfície do DS.
 *
 * @example
 * ```tsx
 * // Container padrão
 * <Container>Conteúdo aqui</Container>
 *
 * // Container clicável
 * <Container hover>Card clicável</Container>
 *
 * // Área rebaixada dentro de um painel
 * <Container variant="subtle" padding="sm">Métrica</Container>
 * ```
 */
function Container({
  className,
  variant,
  padding,
  hover,
  ...props
}: ContainerProps) {
  return (
    <div
      data-slot="container"
      data-variant={variant ?? "default"}
      data-material={materialByVariant[variant ?? "default"]}
      className={cn(containerVariants({ variant, padding, hover }), className)}
      {...props}
    />
  )
}

export { Container, containerVariants }
