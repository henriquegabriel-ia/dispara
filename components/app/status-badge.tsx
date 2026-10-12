import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import {
  Check,
  CircleAlert,
  CircleDashed,
  CircleX,
  Clock,
  Info,
  LoaderCircle,
  Pause,
  PencilLine,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react"

import { EiaBadge } from "@/components/eia"
import { cn } from "@/lib/utils"

/**
 * StatusBadge — badge semântico para status de campanhas, contatos e
 * integrações, sobre o EiaBadge do DS Empreende IA V2.
 *
 * O DS tem quatro tons (neutral, success, warning, danger) e nenhuma segunda
 * cor decorativa: rascunho, agendada e enviando são neutros e o ÍCONE
 * diferencia os estados. Cor nunca é o único sinal — o texto (children) está
 * sempre presente e o ícone é decorativo (aria-hidden).
 *
 * - Campanha: draft, scheduled, sending, completed, paused, failed
 * - Genérico: success, error, warning, info, processing, default
 */
type StatusBadgeStatus =
  | "success"
  | "error"
  | "warning"
  | "info"
  | "processing"
  | "default"
  | "draft"
  | "scheduled"
  | "sending"
  | "completed"
  | "paused"
  | "failed"

type StatusBadgeTone = "neutral" | "success" | "warning" | "danger"

interface StatusVisual {
  tone: StatusBadgeTone
  /** Ícone que distingue o estado sem depender da cor */
  icon?: LucideIcon
  /** Ícone em rotação (estados em andamento); respeita movimento reduzido */
  spin?: boolean
}

const statusVisuals: Record<StatusBadgeStatus, StatusVisual> = {
  // Genéricos
  success: { tone: "success", icon: Check },
  error: { tone: "danger", icon: CircleAlert },
  warning: { tone: "warning", icon: TriangleAlert },
  info: { tone: "neutral", icon: Info },
  processing: { tone: "neutral", icon: LoaderCircle, spin: true },
  default: { tone: "neutral" },

  // Campanha (Dispara)
  draft: { tone: "neutral", icon: PencilLine },
  scheduled: { tone: "neutral", icon: Clock },
  sending: { tone: "neutral", icon: LoaderCircle, spin: true },
  completed: { tone: "success", icon: Check },
  paused: { tone: "warning", icon: Pause },
  failed: { tone: "danger", icon: CircleX },
}

/**
 * Mantido por compatibilidade de API. O visual do badge vem do EiaBadge
 * (`.eia-badge[data-tone][data-size]`); estas variantes só tipam as props e
 * não geram classes.
 */
const statusBadgeVariants = cva("", {
  variants: {
    status: {
      success: "",
      error: "",
      warning: "",
      info: "",
      processing: "",
      default: "",
      draft: "",
      scheduled: "",
      sending: "",
      completed: "",
      paused: "",
      failed: "",
    } satisfies Record<StatusBadgeStatus, string>,
    size: {
      sm: "",
      md: "",
      lg: "",
    },
    withDot: {
      true: "",
      false: "",
    },
  },
  defaultVariants: {
    status: "default",
    size: "md",
    withDot: false,
  },
})

export interface StatusBadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof statusBadgeVariants> {
  /**
   * Força um indicador visual mesmo em status sem ícone próprio (`default`
   * ganha um círculo tracejado). Os demais status sempre exibem o ícone.
   */
  showDot?: boolean
}

/** Tom do EiaBadge correspondente ao status. */
export function getStatusBadgeTone(
  status: StatusBadgeStatus | null | undefined
): StatusBadgeTone {
  return statusVisuals[status ?? "default"].tone
}

/**
 * StatusBadge para exibir status de campanhas e operações.
 *
 * @example
 * ```tsx
 * <StatusBadge status="sending">Enviando</StatusBadge>
 * <StatusBadge status="completed">Concluída</StatusBadge>
 * <StatusBadge status="error">Falhou</StatusBadge>
 * <StatusBadge status="default" showDot>Não configurado</StatusBadge>
 * ```
 */
function StatusBadge({
  className,
  status,
  size,
  showDot = false,
  withDot: _withDot,
  children,
  ...props
}: StatusBadgeProps) {
  const visual = statusVisuals[status ?? "default"]
  const Icon = visual.icon ?? (showDot ? CircleDashed : undefined)
  // O EiaBadge só tem sm|md: `lg` usa o tamanho padrão.
  const badgeSize = size === "sm" ? "sm" : "md"

  return (
    <EiaBadge
      data-slot="status-badge"
      data-status={status ?? "default"}
      tone={visual.tone}
      size={badgeSize}
      className={className}
      {...props}
    >
      {Icon && (
        <Icon
          aria-hidden="true"
          className={cn("shrink-0", visual.spin && "motion-safe:animate-spin")}
        />
      )}
      {children}
    </EiaBadge>
  )
}

/**
 * Helper para mapear o enum CampaignStatus para o status do badge.
 */
export const campaignStatusMap = {
  DRAFT: "draft",
  SCHEDULED: "scheduled",
  SENDING: "sending",
  COMPLETED: "completed",
  PAUSED: "paused",
  FAILED: "failed",
} as const

/**
 * Helper para obter o rótulo em português do status.
 */
export const statusLabels = {
  draft: "Rascunho",
  scheduled: "Agendada",
  sending: "Enviando",
  completed: "Concluída",
  paused: "Pausada",
  failed: "Falhou",
  success: "Sucesso",
  error: "Erro",
  warning: "Atenção",
  info: "Informação",
  processing: "Processando",
  default: "Indefinido",
} as const

export { StatusBadge, statusBadgeVariants, type StatusBadgeStatus }
