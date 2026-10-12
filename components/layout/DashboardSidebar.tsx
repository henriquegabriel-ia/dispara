'use client'

import { memo, type Ref } from 'react'
import {
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  X,
  type LucideIcon,
} from 'lucide-react'
import { EiaBadge, EiaIconButton } from '@/components/eia'
import { EiaAvatar, EiaTooltip } from '@/components/eia/extended'
import { PrefetchLink } from '@/components/app/PrefetchLink'
import { ThemeToggle } from '@/components/app/theme-toggle'
import { cn } from '@/lib/utils'
import { useUnreadCount } from '@/hooks/useUnreadCount'

// =============================================================================
// TYPES
// =============================================================================

export interface NavItem {
  path: string
  label: string
  icon: LucideIcon
  badge?: string
  disabled?: boolean
  hidden?: boolean
}

export interface DashboardSidebarProps {
  pathname: string | null
  navItems: NavItem[]
  isSidebarExpanded: boolean
  isMobileMenuOpen: boolean
  isLoggingOut: boolean
  companyName: string | null
  /** Nome da marca (lib/branding.ts) */
  brandName?: string
  /** Logo da marca (lib/branding.ts) */
  brandLogoUrl?: string
  onToggleSidebar: (expanded: boolean) => void
  onCloseMobileMenu: () => void
  onLogout: () => void
  onPrefetchRoute: (path: string) => void
  /**
   * Botão "Fechar menu" da gaveta mobile: o shell move o foco para ele ao
   * abrir a gaveta (gestão de foco em DashboardShell).
   */
  mobileCloseButtonRef?: Ref<HTMLButtonElement>
}

/** id da gaveta de navegação (ExpandedSidebar), alvo do aria-controls do botão de menu. */
export const MOBILE_NAV_ID = 'dispara-mobile-nav'

// =============================================================================
// ESTILOS COMPARTILHADOS (tokens do DS V2)
// =============================================================================

/** Foco visível com o anel do DS (--eia-color-focus). */
const FOCUS_RING =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-eia-focus'

/** Estados de um item de navegação: ativo = superfície hover + texto forte. */
function navItemStateClass(isActive: boolean, isDisabled?: boolean) {
  if (isDisabled) return 'cursor-not-allowed text-eia-subtle opacity-50'
  if (isActive) return 'bg-eia-hover font-(--eia-weight-semibold) text-eia-text'
  return 'text-eia-muted hover:bg-eia-raised hover:text-eia-text'
}

/** Indicador esmeralda pontual do item ativo (barra de 3px à esquerda). */
function ActiveIndicator({ className }: { className?: string }) {
  return (
    <span
      className={cn('absolute top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-r-full bg-eia-accent', className)}
      aria-hidden="true"
    />
  )
}

const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION

// =============================================================================
// MARCA
// =============================================================================

const DEFAULT_LOGO = '/brand/logo.svg'
const DEFAULT_LOGO_LIGHT = '/brand/logo-light.svg'
const DEFAULT_MARK = '/brand/mark.svg'

function isCustomLogo(logoUrl?: string): logoUrl is string {
  return !!logoUrl && logoUrl !== DEFAULT_LOGO
}

/**
 * Wordmark do Dispara. O padrão troca por tema só com CSS (.eia-logo-auto do
 * DS, regras em styles/eia-light.css): logo.svg (texto claro) no escuro e
 * logo-light.svg (texto escuro) no claro — sem JS nem flash na hidratação.
 * A imagem oculta sai da árvore de acessibilidade (display: none), por isso
 * as duas levam o alt.
 */
const BrandWordmark = memo(function BrandWordmark({
  logoUrl,
  name,
  className,
}: {
  logoUrl?: string
  name?: string
  className: string
}) {
  const alt = name || 'Dispara'

  if (isCustomLogo(logoUrl)) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- SVG estático/URL arbitrária, sem otimização
      <img
        src={logoUrl}
        alt={alt}
        className={className}
        onError={(e) => {
          // Fallback para o logo padrão se a URL customizada falhar
          const img = e.currentTarget
          if (img.dataset.fallback !== 'true') {
            img.dataset.fallback = 'true'
            img.src = DEFAULT_LOGO
          }
        }}
      />
    )
  }

  return (
    <span className="eia-logo-auto">
      {/* eslint-disable-next-line @next/next/no-img-element -- SVG estático */}
      <img className={cn('eia-logo-for-dark', className)} src={DEFAULT_LOGO} alt={alt} />
      {/* eslint-disable-next-line @next/next/no-img-element -- SVG estático */}
      <img className={cn('eia-logo-for-light', className)} src={DEFAULT_LOGO_LIGHT} alt={alt} />
    </span>
  )
})

/**
 * Símbolo do Dispara para a navegação compacta (56px não comportam o
 * wordmark legível — guia "Uso do logo": símbolo na navegação compacta).
 */
function BrandMark({ logoUrl, name }: { logoUrl?: string; name?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- SVG estático
    <img
      src={isCustomLogo(logoUrl) ? logoUrl : DEFAULT_MARK}
      alt={name || 'Dispara'}
      width={32}
      height={32}
      className="h-8 w-8 rounded-eia-small object-contain"
    />
  )
}

/**
 * Endosso Empreende.IA com o logo oficial (nunca recriado com texto). Troca
 * por tema via .eia-logo-auto: eia-light.svg (wordmark branco) no escuro,
 * eia-dark.svg no claro. 120px de largura = piso recomendado pelo DS.
 */
function EiaEndorsement() {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span className="text-[11px] leading-none text-eia-subtle">um produto</span>
      <span className="eia-logo-auto">
        {/* eslint-disable-next-line @next/next/no-img-element -- SVG oficial do DS */}
        <img
          className="eia-logo-for-dark h-auto w-[120px]"
          src="/brand/eia-light.svg"
          alt="Empreende.IA"
          width={120}
          height={26}
        />
        {/* eslint-disable-next-line @next/next/no-img-element -- SVG oficial do DS */}
        <img
          className="eia-logo-for-light h-auto w-[120px]"
          src="/brand/eia-dark.svg"
          alt="Empreende.IA"
          width={120}
          height={26}
        />
      </span>
    </div>
  )
}

// =============================================================================
// INBOX BADGE (Isolado para evitar re-render do sidebar inteiro)
// =============================================================================

/**
 * Badge de contagem não lida do Inbox.
 * Consome useUnreadCount diretamente para evitar que mudanças na contagem
 * causem re-render de todo o sidebar.
 */
const InboxUnreadBadge = memo(function InboxUnreadBadge({
  variant = 'compact',
}: {
  variant?: 'compact' | 'expanded'
}) {
  const { count } = useUnreadCount()

  if (!count || count === 0) return null

  const displayCount = count > 99 ? '99+' : String(count)

  return (
    <EiaBadge
      tone="success"
      size="sm"
      className={cn(
        'tabular-nums',
        variant === 'compact' ? 'pointer-events-none absolute -right-2.5 -top-2' : 'ml-auto'
      )}
    >
      <span aria-hidden="true">{displayCount}</span>
      <span className="sr-only">{`${count} mensagens não lidas`}</span>
    </EiaBadge>
  )
})

// =============================================================================
// COMPACT SIDEBAR (Icon-only)
// =============================================================================

const CompactSidebar = memo(function CompactSidebar({
  pathname,
  navItems,
  isSidebarExpanded,
  isLoggingOut,
  brandName,
  brandLogoUrl,
  onToggleSidebar,
  onLogout,
  onPrefetchRoute,
}: Pick<
  DashboardSidebarProps,
  | 'pathname'
  | 'navItems'
  | 'isSidebarExpanded'
  | 'isLoggingOut'
  | 'brandName'
  | 'brandLogoUrl'
  | 'onToggleSidebar'
  | 'onLogout'
  | 'onPrefetchRoute'
>) {
  return (
    <aside
      className={cn(
        // lg:h-screen dá altura definida à coluna (a raiz do shell só tem
        // min-h-screen): a navegação rola por dentro e o rodapé fica visível.
        'hidden lg:flex fixed inset-y-0 left-0 z-50 w-14 lg:sticky lg:top-0 lg:h-screen',
        'border-r border-eia-border-subtle bg-eia-surface',
        isSidebarExpanded && 'lg:hidden'
      )}
      aria-label="Menu de navegação compacto"
    >
      <div className="flex h-full w-14 flex-col items-center">
        {/* Topo alinhado ao header (64px) */}
        <div className="flex h-16 w-full shrink-0 items-center justify-center border-b border-eia-border-subtle">
          <BrandMark logoUrl={brandLogoUrl} name={brandName} />
        </div>

        <div className="flex shrink-0 justify-center pt-2">
          <EiaTooltip content="Expandir menu" side="right">
            <EiaIconButton
              label="Expandir menu de navegação"
              size="sm"
              onClick={() => onToggleSidebar(true)}
            >
              <PanelLeftOpen size={18} />
            </EiaIconButton>
          </EiaTooltip>
        </div>

        <nav
          className="no-scrollbar flex w-full flex-1 flex-col items-center gap-1 overflow-y-auto py-3"
          aria-label="Menu principal"
        >
          {navItems.map((item) => {
            const isDisabled = item.disabled
            const isActive = pathname === item.path
            const tooltip = item.badge ? `${item.label} · ${item.badge}` : item.label
            const className = cn(
              'group relative flex h-9 w-9 shrink-0 items-center justify-center rounded-eia-small',
              'transition-colors duration-(--eia-motion-fast)',
              FOCUS_RING,
              navItemStateClass(isActive, isDisabled)
            )

            // O nome acessível vem do texto (sr-only) e não de aria-label, para
            // incluir a contagem de não lidas do badge do Inbox.
            const content = (
              <>
                {isActive && <ActiveIndicator className="-left-[10px]" />}
                <item.icon size={18} aria-hidden="true" />
                <span className="sr-only">{item.badge ? `${item.label} (${item.badge})` : item.label}</span>
                {item.path === '/inbox' && <InboxUnreadBadge variant="compact" />}
              </>
            )

            if (isDisabled) {
              return (
                <EiaTooltip key={item.path} content={tooltip} side="right">
                  <span className={className} aria-disabled="true">
                    {content}
                  </span>
                </EiaTooltip>
              )
            }

            return (
              <EiaTooltip key={item.path} content={tooltip} side="right">
                <PrefetchLink
                  href={item.path}
                  onMouseEnter={() => onPrefetchRoute(item.path)}
                  aria-current={isActive ? 'page' : undefined}
                  className={className}
                >
                  {content}
                </PrefetchLink>
              </EiaTooltip>
            )
          })}
        </nav>

        <div className="flex w-full shrink-0 flex-col items-center gap-1 border-t border-eia-border-subtle py-3">
          <ThemeToggle variant="compact" tooltipSide="right" />
          <EiaTooltip content="Sair da conta" side="right">
            {/* focusableWhenDisabled: durante o loading o botão fica com
                aria-disabled em vez de disabled nativo e não perde o foco. */}
            <EiaIconButton
              label={isLoggingOut ? 'Saindo…' : 'Sair da conta'}
              size="sm"
              loading={isLoggingOut}
              focusableWhenDisabled
              onClick={onLogout}
            >
              {isLoggingOut ? null : <LogOut size={18} />}
            </EiaIconButton>
          </EiaTooltip>
        </div>
      </div>
    </aside>
  )
})

// =============================================================================
// EXPANDED SIDEBAR (Full labels)
// =============================================================================

const ExpandedSidebar = memo(function ExpandedSidebar({
  pathname,
  navItems,
  isSidebarExpanded,
  isMobileMenuOpen,
  isLoggingOut,
  companyName,
  brandName,
  brandLogoUrl,
  onToggleSidebar,
  onCloseMobileMenu,
  onLogout,
  onPrefetchRoute,
  mobileCloseButtonRef,
}: DashboardSidebarProps) {
  const displayName = companyName || brandName || 'Dispara'

  return (
    <aside
      id={MOBILE_NAV_ID}
      className={cn(
        'fixed inset-y-0 left-0 z-50 w-56 border-r border-eia-border-subtle bg-eia-surface',
        // Tailwind v4: translate-x-* usa a propriedade `translate`, não `transform`.
        'duration-(--eia-motion-normal) ease-(--eia-motion-ease)',
        // visibility: ao FECHAR transiciona junto com o deslocamento (fica
        // visível até o fim e vira hidden) — a sidebar fora da tela não recebe
        // foco de teclado nem leitor de tela. Ao ABRIR muda na hora (só o
        // translate transiciona): com a transição, o 1º quadro ainda é hidden e
        // o focus() que o shell faz ao abrir a gaveta falharia.
        // Mobile (< lg): show only when menu is open
        isMobileMenuOpen
          ? 'visible translate-x-0 transition-[translate]'
          : 'invisible -translate-x-full transition-[translate,visibility]',
        // Desktop (lg+): controlled by isSidebarExpanded, overrides mobile class
        isSidebarExpanded
          ? 'lg:visible lg:translate-x-0 lg:transition-[translate]'
          : 'lg:invisible lg:-translate-x-full lg:transition-[translate,visibility]'
      )}
      aria-label="Menu de navegação expandido"
    >
      <div className="flex h-full flex-col">
        {/* Cabeçalho alinhado ao header (64px): wordmark + recolher/fechar.
            .eia-button define display sem @layer — a visibilidade responsiva
            fica num wrapper, não no className do EiaIconButton. */}
        <div className="flex h-16 shrink-0 items-center justify-between gap-2 border-b border-eia-border-subtle pl-4 pr-3">
          <BrandWordmark
            logoUrl={brandLogoUrl}
            name={brandName}
            className="h-8 w-auto max-w-[136px] object-contain"
          />
          <span className="hidden lg:flex">
            <EiaTooltip content="Recolher menu" side="right">
              <EiaIconButton
                label="Recolher menu de navegação"
                size="sm"
                onClick={() => onToggleSidebar(false)}
              >
                <PanelLeftClose size={18} />
              </EiaIconButton>
            </EiaTooltip>
          </span>
          <span className="flex lg:hidden">
            <EiaIconButton
              ref={mobileCloseButtonRef}
              label="Fechar menu"
              size="sm"
              onClick={onCloseMobileMenu}
            >
              <X size={18} />
            </EiaIconButton>
          </span>
        </div>

        <nav className="no-scrollbar flex-1 overflow-y-auto px-3 py-4" aria-label="Menu principal">
          {/* Ação primária: link com a aparência do EiaButton (mantém o
              prefetch do next/link). O wrapper flex + flex-1 estica o botão,
              já que .eia-button fixa width: fit-content sem @layer. */}
          <div className="flex">
            <PrefetchLink
              href="/campaigns/new"
              onClick={onCloseMobileMenu}
              className="eia-button flex-1"
              data-variant="primary"
              data-size="sm"
            >
              <span className="eia-button-icon" aria-hidden="true">
                <Plus size={16} />
              </span>
              <span className="eia-button-label">Criar campanha</span>
            </PrefetchLink>
          </div>

          <ul className="mt-5 flex flex-col gap-0.5" role="list">
            {navItems.map((item) => {
              const isDisabled = item.disabled
              const isActive = pathname === item.path
              const className = cn(
                'group relative flex h-9 items-center gap-3 rounded-eia-small px-3 text-sm',
                'transition-colors duration-(--eia-motion-fast)',
                FOCUS_RING,
                navItemStateClass(isActive, isDisabled)
              )

              // Inbox usa badge dinâmico, outros usam badge estático
              const badge =
                item.path === '/inbox' ? (
                  <InboxUnreadBadge variant="expanded" />
                ) : item.badge ? (
                  <EiaBadge tone="neutral" size="sm" className="ml-auto">
                    {item.badge}
                  </EiaBadge>
                ) : null

              const content = (
                <>
                  {isActive && <ActiveIndicator className="left-0" />}
                  <item.icon
                    size={18}
                    className={cn(
                      'shrink-0',
                      isActive ? 'text-eia-text' : 'text-eia-subtle group-hover:text-eia-text'
                    )}
                    aria-hidden="true"
                  />
                  <span className="truncate">{item.label}</span>
                  {badge}
                </>
              )

              if (isDisabled) {
                return (
                  <li key={item.path}>
                    <span className={className} aria-disabled="true">
                      {content}
                    </span>
                  </li>
                )
              }

              return (
                <li key={item.path}>
                  <PrefetchLink
                    href={item.path}
                    onClick={onCloseMobileMenu}
                    onMouseEnter={() => onPrefetchRoute(item.path)}
                    aria-current={isActive ? 'page' : undefined}
                    className={className}
                  >
                    {content}
                  </PrefetchLink>
                </li>
              )
            })}
          </ul>
        </nav>

        {/* Rodapé: tema + conta + endosso Empreende.IA */}
        <div className="shrink-0 border-t border-eia-border-subtle px-3 pb-4 pt-3">
          <ThemeToggle variant="segmented" />

          <div className="mt-3 flex items-center gap-2.5 pl-1">
            <span className="shrink-0" aria-hidden="true">
              <EiaAvatar name={displayName} initials={displayName.charAt(0).toUpperCase()} size="sm" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-(--eia-weight-semibold) text-eia-text">
                {displayName}
              </p>
              <p className="truncate text-xs text-eia-subtle">Administrador</p>
            </div>
            <EiaTooltip content="Sair da conta" side="top">
              <EiaIconButton
                label={isLoggingOut ? 'Saindo…' : 'Sair da conta'}
                size="sm"
                loading={isLoggingOut}
                focusableWhenDisabled
                onClick={onLogout}
              >
                {isLoggingOut ? null : <LogOut size={18} />}
              </EiaIconButton>
            </EiaTooltip>
          </div>

          <div className="mt-4 flex items-end justify-between gap-3 border-t border-eia-border-subtle pt-4">
            <EiaEndorsement />
            {APP_VERSION && (
              <span className="shrink-0 font-mono text-[10px] leading-none text-eia-subtle">
                v{APP_VERSION}
              </span>
            )}
          </div>
        </div>
      </div>
    </aside>
  )
})

// =============================================================================
// MAIN COMPONENT (exported)
// =============================================================================

/**
 * Dashboard Sidebar component - extracted from DashboardShell for isolation.
 * Memoized to prevent re-renders when parent state changes that don't affect sidebar.
 */
export const DashboardSidebar = memo(function DashboardSidebar(props: DashboardSidebarProps) {
  const {
    pathname,
    navItems,
    isSidebarExpanded,
    isLoggingOut,
    brandName,
    brandLogoUrl,
    onToggleSidebar,
    onLogout,
    onPrefetchRoute,
  } = props

  return (
    <>
      <CompactSidebar
        pathname={pathname}
        navItems={navItems}
        isSidebarExpanded={isSidebarExpanded}
        isLoggingOut={isLoggingOut}
        brandName={brandName}
        brandLogoUrl={brandLogoUrl}
        onToggleSidebar={onToggleSidebar}
        onLogout={onLogout}
        onPrefetchRoute={onPrefetchRoute}
      />
      <ExpandedSidebar {...props} />
    </>
  )
})

export default DashboardSidebar
