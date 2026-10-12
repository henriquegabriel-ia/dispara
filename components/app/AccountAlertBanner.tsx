'use client'

import { CircleX, CreditCard, ShieldAlert, TriangleAlert, type LucideIcon } from 'lucide-react'
import Link from 'next/link'

import { EiaAlert, type EiaAlertTone } from '@/components/eia'
import { useAccountAlerts } from '@/hooks/useAccountAlerts'
import { cn } from '@/lib/utils'

/*
 * Banner do alerta de conta mais relevante, sobre o EiaAlert do DS.
 *
 * Tom por tipo (o DS tem info/success/warning/danger e nenhuma segunda cor):
 * pagamento e autenticação bloqueiam o envio (danger); limite de taxa e avisos
 * da integração com a Meta pedem atenção (warning); template e sistema são
 * informativos (info, neutro). O ícone por tipo e o título em texto garantem
 * que a cor não seja o único sinal.
 */

const alertIcons: Record<string, LucideIcon> = {
  payment: CreditCard,
  auth: ShieldAlert,
  rate_limit: TriangleAlert,
  template: TriangleAlert,
  system: TriangleAlert,
  meta_integration: TriangleAlert,
  recipient: TriangleAlert,
  media: TriangleAlert,
  unknown: CircleX,
}

const alertTones: Record<string, EiaAlertTone> = {
  payment: 'danger',
  auth: 'danger',
  rate_limit: 'warning',
  template: 'info',
  system: 'info',
  meta_integration: 'warning',
  default: 'danger',
}

const alertTitles: Record<string, string> = {
  payment: 'Problema de pagamento',
  auth: 'Erro de autenticação',
  rate_limit: 'Limite de taxa excedido',
  template: 'Problema com template',
  system: 'Erro do sistema',
  meta_integration: 'Integração com a Meta',
}

interface AccountAlertBannerProps {
  className?: string
}

export function AccountAlertBanner({ className = '' }: AccountAlertBannerProps) {
  const { criticalAlert: critical, alerts, dismiss, isDismissing } = useAccountAlerts()
  // Avisos da integração com a Meta (type 'meta_integration': assinatura do webhook,
  // chaves dos Flows — ver lib/meta-integration-alerts.ts) só aparecem quando NÃO há
  // alerta crítico (pagamento/auth): nunca escondem um alerta real da Meta.
  const criticalAlert = critical ?? alerts.find((a) => a.type === 'meta_integration') ?? null

  if (!criticalAlert) {
    return null
  }

  const alertType = criticalAlert.type || 'default'
  const Icon = alertIcons[alertType] || TriangleAlert

  const isPossibleMetaLock = alertType === 'auth' && criticalAlert.code === 131031
  // Bloqueio NÃO confirmado: atenção, não erro.
  const tone: EiaAlertTone = isPossibleMetaLock
    ? 'warning'
    : alertTones[alertType] || alertTones.default

  // Parse details if JSON
  let actionText: string | null = null
  try {
    if (criticalAlert.details) {
      const details = JSON.parse(criticalAlert.details)
      actionText = details.action || null
    }
  } catch {
    // Not JSON, ignore
  }

  const displayTitle = isPossibleMetaLock
    ? 'Possível bloqueio na Meta (não confirmado)'
    : alertTitles[alertType] || 'Alerta'

  const displayMessage = isPossibleMetaLock
    ? 'Detectamos um erro 131031 em tentativas recentes. Isso pode indicar bloqueio, mas também pode ser um sinal histórico/intermitente. Confirme o status atual no Diagnóstico da Meta.'
    : criticalAlert.message

  const displayActionText = isPossibleMetaLock
    ? 'Abra “Diagnósticos da Meta” para checar o Health Status e seguir o passo a passo recomendado.'
    : actionText

  const showDiagnosticsLink = isPossibleMetaLock || alertType === 'meta_integration'

  return (
    <EiaAlert
      tone={tone}
      title={displayTitle}
      icon={<Icon />}
      className={cn('mb-(--eia-space-4)', className)}
      onDismiss={() => {
        if (!isDismissing) dismiss(criticalAlert.id)
      }}
      dismissLabel="Dispensar alerta"
    >
      <p>{displayMessage}</p>

      {displayActionText && <p className="mt-(--eia-space-2)">{displayActionText}</p>}

      {showDiagnosticsLink && (
        <p className="mt-(--eia-space-2)">
          {/* next/link com o visual do EiaLink (mantém o prefetch da rota interna) */}
          <Link href="/settings/meta-diagnostics" className="eia-link" data-variant="default">
            Abrir Diagnósticos da Meta
          </Link>
        </p>
      )}

      {criticalAlert.code && (
        <p className="mt-(--eia-space-2) text-(length:--eia-type-caption) text-eia-subtle tabular-nums">
          Código do erro: {criticalAlert.code}
        </p>
      )}
    </EiaAlert>
  )
}
