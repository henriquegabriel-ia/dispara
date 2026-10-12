'use client'

import { Moon, Sun } from 'lucide-react'
import { EiaIconButton } from '@/components/eia'
import { EiaTooltip } from '@/components/eia/extended'
import { useEiaTheme, type EiaThemePreference } from '@/components/eia/theme'
import { cn } from '@/lib/utils'

interface ThemeToggleProps {
  /**
   * compact: um botão de ícone que alterna claro/escuro (sidebar recolhida)
   * segmented: grupo Escuro / Claro / Sistema (sidebar expandida)
   */
  variant?: 'compact' | 'segmented'
  className?: string
  /** compact: lado do tooltip em relação ao botão */
  tooltipSide?: 'top' | 'bottom' | 'left' | 'right'
}

const THEME_OPTIONS: ReadonlyArray<{ value: EiaThemePreference; label: string }> = [
  { value: 'dark', label: 'Escuro' },
  { value: 'light', label: 'Claro' },
  { value: 'system', label: 'Sistema' },
] as const

/**
 * Controle de tema do DS Empreende IA V2 (preferência em
 * localStorage['empreende-ia-theme'], aplicada em html[data-eia-theme]).
 *
 * useEiaTheme() lê o tema por useSyncExternalStore com snapshot de servidor
 * 'dark' (o padrão do DS): a hidratação usa o mesmo valor do SSR e o estado
 * real entra logo depois — sem placeholder de "mounted".
 */
export function ThemeToggle({ variant = 'segmented', className, tooltipSide = 'right' }: ThemeToggleProps) {
  const { theme, preference, setTheme } = useEiaTheme()

  if (variant === 'compact') {
    const isDark = theme === 'dark'
    const label = isDark ? 'Ativar tema claro' : 'Ativar tema escuro'

    return (
      <EiaTooltip content={label} side={tooltipSide}>
        <EiaIconButton
          label={label}
          size="sm"
          variant="ghost"
          className={className}
          onClick={() => setTheme(isDark ? 'light' : 'dark')}
        >
          {isDark ? <Sun size={18} /> : <Moon size={18} />}
        </EiaIconButton>
      </EiaTooltip>
    )
  }

  // Segmentado: rótulos sem ícone para caber os três na largura da sidebar
  // (224px). O item ativo usa superfície neutra — esmeralda fica para a ação.
  return (
    <div
      role="group"
      aria-label="Tema da interface"
      className={cn(
        'flex w-full items-center gap-0.5 rounded-eia-small border border-eia-border-subtle bg-eia-bg p-0.5',
        className
      )}
    >
      {THEME_OPTIONS.map((option) => {
        const isActive = preference === option.value
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={isActive}
            onClick={() => setTheme(option.value)}
            className={cn(
              'flex h-8 min-w-0 flex-1 items-center justify-center rounded-[calc(var(--eia-radius-small)-2px)] px-1 text-xs',
              'transition-colors duration-(--eia-motion-fast)',
              'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-eia-focus',
              isActive
                ? 'bg-eia-hover font-(--eia-weight-semibold) text-eia-text'
                : 'font-(--eia-weight-medium) text-eia-muted hover:text-eia-text'
            )}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

export default ThemeToggle
