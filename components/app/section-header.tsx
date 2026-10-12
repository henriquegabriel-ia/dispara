import * as React from "react"
import { type LucideIcon } from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * SectionHeader — cabeçalho de seção com indicador lateral.
 *
 * Usado para organizar seções em páginas de configuração e formulários. Tela de
 * produto no DS Empreende IA V2 pede calma: esmeralda só pontual (ação, item
 * ativo, indicador de estado) e nada de faixa decorativa repetida. Por isso o
 * indicador e o ícone são neutros por padrão, e cor fica para estado real.
 *
 * Tons (prop `color`, API preservada):
 * - neutral (padrão) / info / brand: neutro — `brand` e `info` ficam por
 *   compatibilidade e caem no neutro (o DS não tem azul nem esmeralda
 *   decorativo);
 * - warning: aviso do DS — só para estado real que pede atenção (ex.:
 *   configuração incompleta);
 * - error: perigo do DS — só para estado real (ex.: configuração inválida).
 *
 * @example
 * ```tsx
 * <SectionHeader
 *   title="Meta App (opcional)"
 *   description="Habilita validação forte do token"
 *   icon={Settings}
 * />
 *
 * <SectionHeader title="Credenciais" color={isInvalid ? "error" : "neutral"} />
 *
 * <SectionHeader title="Configurações avançadas" showIndicator={false} />
 *
 * <SectionHeader
 *   title="Webhooks"
 *   icon={Webhook}
 *   actions={<EiaButton size="sm">Configurar webhook</EiaButton>}
 * />
 * ```
 */

/** Cor do indicador lateral por tom: neutro, salvo estado real (aviso/erro). */
const indicatorColors = {
  brand: "bg-eia-border-control",
  warning: "bg-eia-warning",
  info: "bg-eia-border-control",
  error: "bg-eia-danger",
  neutral: "bg-eia-border-control",
} as const

/** Cor do ícone por tom: texto secundário, salvo estado real (aviso/erro). */
const iconColors = {
  brand: "text-eia-muted",
  warning: "text-eia-warning",
  info: "text-eia-muted",
  error: "text-eia-danger",
  neutral: "text-eia-muted",
} as const

type IndicatorColor = keyof typeof indicatorColors

export interface SectionHeaderProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Título da seção */
  title: string
  /** Descrição opcional (pode ser string ou ReactNode para formatação inline) */
  description?: React.ReactNode
  /** Tom do indicador e do ícone (padrão `neutral`; cor só para aviso/erro real) */
  color?: IndicatorColor
  /** Se deve mostrar o indicador lateral */
  showIndicator?: boolean
  /** Ícone opcional (Lucide, 20px, decorativo) */
  icon?: LucideIcon
  /** Ações à direita (botões etc.) */
  actions?: React.ReactNode
  /** Badge ou tag após o título */
  badge?: React.ReactNode
}

function SectionHeader({
  title,
  description,
  color = "neutral",
  showIndicator = true,
  icon: Icon,
  actions,
  badge,
  className,
  ...props
}: SectionHeaderProps) {
  return (
    <div
      data-slot="section-header"
      data-tone={color}
      // flex-wrap: em telas estreitas as ações descem para a linha de baixo em
      // vez de espremer o título (o conteúdo pede ao menos 12rem antes de quebrar).
      className={cn("flex flex-wrap items-start gap-(--eia-space-3)", className)}
      {...props}
    >
      {/* Indicador lateral */}
      {showIndicator && (
        <div
          className={cn(
            "w-1 self-stretch shrink-0 rounded-(--eia-radius-pill)",
            indicatorColors[color]
          )}
          aria-hidden="true"
        />
      )}

      {/* Ícone */}
      {Icon && (
        <div className={cn("mt-0.5 shrink-0", iconColors[color])} aria-hidden="true">
          <Icon size={20} />
        </div>
      )}

      {/* Conteúdo */}
      <div className="min-w-0 flex-1 basis-48">
        <div className="flex flex-wrap items-center gap-(--eia-space-2)">
          <h3 className="font-(family-name:--eia-font-display) text-(length:--eia-type-lead) font-(--eia-weight-semibold) leading-(--eia-line-control) tracking-[-0.035em] text-eia-text">
            {title}
          </h3>
          {badge}
        </div>
        {description && (
          <p className="mt-(--eia-space-1) text-(length:--eia-type-control) leading-(--eia-line-body) text-eia-muted">
            {description}
          </p>
        )}
      </div>

      {/* Ações */}
      {actions && (
        <div className="flex shrink-0 items-center gap-(--eia-space-2)">{actions}</div>
      )}
    </div>
  )
}

/**
 * SectionContent — wrapper para o conteúdo da seção, alinhado após o indicador.
 */
function SectionContent({
  className,
  hasIndicator = true,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { hasIndicator?: boolean }) {
  return (
    <div
      data-slot="section-content"
      className={cn(
        "mt-(--eia-space-4)",
        hasIndicator && "pl-(--eia-space-4)", // alinha com o conteúdo após o indicador
        className
      )}
      {...props}
    >
      {children}
    </div>
  )
}

/**
 * Section — seção completa (header + conteúdo).
 */
function Section({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLElement>) {
  return (
    <section
      data-slot="section"
      className={cn("space-y-(--eia-space-4)", className)}
      {...props}
    >
      {children}
    </section>
  )
}

export { SectionHeader, SectionContent, Section, type IndicatorColor }
