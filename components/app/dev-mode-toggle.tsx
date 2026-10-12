'use client'

import { Code2 } from 'lucide-react'
import { EiaIconButton } from '@/components/eia'
import { EiaTooltip } from '@/components/eia/extended'
import { useDevMode } from '@/components/providers/DevModeProvider'

interface DevModeToggleProps {
  /** Classe CSS adicional */
  className?: string
}

/** Rótulo fixo: o tooltip mostra exatamente o nome acessível (Label in Name). */
const DEV_MODE_LABEL = 'Modo desenvolvedor'

/**
 * Toggle para ativar/desativar o Modo Desenvolvedor
 * Exibe ferramentas de debug e painéis avançados quando ativo.
 * Botão de alternância: nome fixo e o estado em aria-pressed.
 */
export function DevModeToggle({ className = '' }: DevModeToggleProps) {
  const { isDevMode, toggleDevMode } = useDevMode()

  return (
    <EiaTooltip content={DEV_MODE_LABEL} side="bottom">
      <EiaIconButton
        label={DEV_MODE_LABEL}
        aria-pressed={isDevMode}
        size="sm"
        // Ativo: superfície secundária + ícone em esmeralda (indicador pontual).
        variant={isDevMode ? 'secondary' : 'ghost'}
        className={className || undefined}
        onClick={toggleDevMode}
      >
        <Code2 size={18} className={isDevMode ? 'text-eia-accent-text' : undefined} />
      </EiaIconButton>
    </EiaTooltip>
  )
}
