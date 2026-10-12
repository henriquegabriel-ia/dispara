'use client'

import React from 'react'
import { ArrowLeft } from 'lucide-react'

import { EiaAlert, EiaButton } from '@/components/eia'

export interface LimitWarningProps {
  /** Number of recipients selected */
  recipientCount: number
  /** Current daily limit */
  currentLimit: number
  /** Display variant: 'detailed' shows stats and solutions, 'compact' shows minimal info */
  variant?: 'detailed' | 'compact'
  /** Callback to show upgrade modal (for detailed variant) */
  onShowUpgradeModal?: () => void
  /** Callback to go back (for compact variant) */
  onGoBack?: () => void
  /** Custom back button text */
  backButtonText?: string
}

const formatNumber = (value: number) => value.toLocaleString('pt-BR')

/**
 * Aviso exibido quando a quantidade de destinatários passa do limite diário,
 * sobre o EiaAlert (tom danger: bloqueia o disparo).
 *
 * @example
 * // Detalhado (etapa de público)
 * <LimitWarning
 *   recipientCount={1500}
 *   currentLimit={1000}
 *   variant="detailed"
 *   onShowUpgradeModal={() => setShowUpgrade(true)}
 * />
 *
 * @example
 * // Compacto (etapa de revisão)
 * <LimitWarning
 *   recipientCount={1500}
 *   currentLimit={1000}
 *   variant="compact"
 *   onGoBack={() => setStep(2)}
 * />
 */
export function LimitWarning({
  recipientCount,
  currentLimit,
  variant = 'detailed',
  onShowUpgradeModal,
  onGoBack,
  backButtonText = 'Voltar e ajustar destinatários',
}: LimitWarningProps) {
  const exceeded = recipientCount - currentLimit
  const campaignsNeeded = currentLimit > 0 ? Math.ceil(recipientCount / currentLimit) : 0

  const strong = (value: number) => (
    <strong className="font-(--eia-weight-semibold) text-eia-text tabular-nums">
      {formatNumber(value)}
    </strong>
  )

  // Compacto — informação mínima na etapa de revisão
  if (variant === 'compact') {
    return (
      <EiaAlert
        tone="danger"
        size="compact"
        title="Não é possível disparar"
        action={
          onGoBack && (
            <EiaButton
              variant="secondary"
              size="sm"
              leadingIcon={<ArrowLeft />}
              onClick={onGoBack}
            >
              {backButtonText}
            </EiaButton>
          )
        }
      >
        Você selecionou {strong(recipientCount)} contatos, mas seu limite é de{' '}
        {strong(currentLimit)} mensagens por dia.
      </EiaAlert>
    )
  }

  // Detalhado — números e caminhos possíveis na etapa de público
  return (
    <EiaAlert tone="danger" title="Limite diário excedido">
      <p>
        Você selecionou {strong(recipientCount)} contatos, mas seu limite atual é de{' '}
        {strong(currentLimit)} mensagens por dia.
      </p>

      <dl className="mt-(--eia-space-3) grid grid-cols-3 divide-x divide-eia-border-subtle rounded-(--eia-radius-small) border border-eia-border-subtle text-center">
        <div className="px-(--eia-space-2) py-(--eia-space-3)">
          <dt className="text-(length:--eia-type-caption) text-eia-subtle">Selecionados</dt>
          <dd className="mt-(--eia-space-1) text-(length:--eia-type-lead) font-(--eia-weight-semibold) text-eia-text tabular-nums">
            {formatNumber(recipientCount)}
          </dd>
        </div>
        <div className="px-(--eia-space-2) py-(--eia-space-3)">
          <dt className="text-(length:--eia-type-caption) text-eia-subtle">Limite por dia</dt>
          <dd className="mt-(--eia-space-1) text-(length:--eia-type-lead) font-(--eia-weight-semibold) text-eia-text tabular-nums">
            {formatNumber(currentLimit)}
          </dd>
        </div>
        <div className="px-(--eia-space-2) py-(--eia-space-3)">
          <dt className="text-(length:--eia-type-caption) text-eia-subtle">Excedente</dt>
          <dd className="mt-(--eia-space-1) text-(length:--eia-type-lead) font-(--eia-weight-semibold) text-eia-danger tabular-nums">
            +{formatNumber(exceeded)}
          </dd>
        </div>
      </dl>

      <p className="mt-(--eia-space-3) font-(--eia-weight-semibold) text-eia-text">
        O que você pode fazer
      </p>
      <ol className="mt-(--eia-space-1) list-decimal space-y-(--eia-space-1) pl-(--eia-space-5)">
        <li>
          Reduza a seleção para no máximo {strong(currentLimit)} contatos.
        </li>
        {campaignsNeeded > 1 && (
          <li>Divida o envio em {formatNumber(campaignsNeeded)} campanhas menores.</li>
        )}
      </ol>

      {onShowUpgradeModal && (
        <div className="mt-(--eia-space-3)">
          <EiaButton variant="secondary" size="sm" onClick={onShowUpgradeModal}>
            Ver como aumentar o limite
          </EiaButton>
        </div>
      )}
    </EiaAlert>
  )
}
