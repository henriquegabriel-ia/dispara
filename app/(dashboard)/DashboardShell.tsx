'use client'

import { useEffect, useState, useCallback, useMemo, useRef, type Ref } from 'react'
import { cn } from '@/lib/utils'
import { usePathname, useRouter } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
    Bot,
    LayoutDashboard,
    MessageSquare,
    Users,
    Settings,
    Menu,
    FileText,
    MessageCircle,
    SquareKanban,
    Workflow,
    Headset,
} from 'lucide-react'
import React from 'react'
import { HealthStatus } from '@/lib/health-check'
import { getPageWidthClass, PageLayoutProvider, usePageLayout } from '@/components/providers/PageLayoutProvider'
import { campaignService } from '@/services/campaignService'
import { contactService } from '@/services/contactService'
import { templateService } from '@/services/templateService'
import { settingsService } from '@/services/settingsService'
import { saveMetaAppConfigWithFeedback } from '@/components/shared/save-meta-app-config'
import { dashboardService } from '@/services/dashboardService'
import { useUnreadCount } from '@/hooks/useUnreadCount'
import { AccountAlertBanner } from '@/components/app/AccountAlertBanner'
import { WebhookAlertBanner } from '@/components/shared/WebhookAlertBanner'
import { DashboardSidebar, MOBILE_NAV_ID, type NavItem } from '@/components/layout/DashboardSidebar'
import { DevModeToggle } from '@/components/app/dev-mode-toggle'
import { EiaIconButton } from '@/components/eia'
import { EiaBreadcrumb } from '@/components/eia/extended'
import { useDevMode } from '@/components/providers/DevModeProvider'
import {
    OnboardingModal,
    OnboardingChecklist,
    ChecklistMiniBadge,
    OnboardingOverlay,
    TutorialsSheet,
    useOnboardingProgress,
    type OnboardingStep,
} from '@/components/features/onboarding'
import {
    SuccessBanner,
    CredentialsModal,
    GuidedTour,
    useGuidedTour,
} from '@/components/features/setup'
import { useOnboardingStatus } from '@/hooks/useOnboardingStatus'
import { BRAND } from '@/lib/branding'
import { logoutAndRedirect } from '@/lib/logout-client'

export function DashboardShell({
    children,
    initialAuthStatus,
    initialHealthStatus
}: {
    children: React.ReactNode
    initialAuthStatus?: any
    initialHealthStatus?: HealthStatus | null
}) {
    const pathname = usePathname()
    const router = useRouter()
    const queryClient = useQueryClient()
    const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)
    const [isLoggingOut, setIsLoggingOut] = useState(false)
    const [isSidebarExpanded, setIsSidebarExpanded] = useState(false)

    // Read sidebar preference from localStorage on mount
    useEffect(() => {
        if (typeof window === 'undefined') return
        const isCollapsed = window.localStorage.getItem('app-sidebar-collapsed') === 'true'
        setIsSidebarExpanded(!isCollapsed)
    }, [])

    const updateSidebarExpanded = useCallback((value: boolean) => {
        setIsSidebarExpanded(value)
        if (typeof window === 'undefined') return
        window.localStorage.setItem('app-sidebar-collapsed', value ? 'false' : 'true')
    }, [])

    // Onboarding dispensável: o usuário pode fechar o modal e usar o sistema
    // sem completar o fluxo (dispensa persistida no navegador).
    const [onboardingDismissed, setOnboardingDismissed] = useState(false)
    useEffect(() => {
        if (typeof window === 'undefined') return
        setOnboardingDismissed(window.localStorage.getItem('dispara_onboarding_dismissed') === '1')
    }, [])
    const dismissOnboarding = useCallback(() => {
        setOnboardingDismissed(true)
        if (typeof window === 'undefined') return
        window.localStorage.setItem('dispara_onboarding_dismissed', '1')
    }, [])

    // Enable real-time toast notifications for global events
    // This shows toasts when campaigns complete, new contacts are added, etc.
    const { useRealtimeNotifications } = require('@/hooks/useRealtimeNotifications')
    useRealtimeNotifications({ enabled: true })

    // T069: Unread count for inbox badge in sidebar
    const { count: unreadCount } = useUnreadCount()

    // Dev mode for hiding dev-only nav items
    const { isDevMode } = useDevMode()

    // WhatsApp onboarding progress hook (localStorage - apenas estado de UI)
    // NOTA: A decisão de mostrar o modal vem do banco (isOnboardingCompletedInDb)
    const {
        progress: onboardingProgress,
        shouldShowChecklist,
        completeOnboarding,
    } = useOnboardingProgress()

    // Estado para forçar abertura do modal em um step específico (ex: vindo do checklist)
    const [forceModalStep, setForceModalStep] = useState<OnboardingStep | undefined>()

    // Estado para o novo modal de credenciais simplificado
    const [showCredentialsModal, setShowCredentialsModal] = useState(false)

    // Estado para mostrar banner de sucesso após conexão
    const [showSuccessBanner, setShowSuccessBanner] = useState(false)

    // Estado para mostrar tour guiado após primeira conexão
    const [showGuidedTour, setShowGuidedTour] = useState(false)
    const guidedTour = useGuidedTour()

    // Onboarding status - usa hook dedicado com fallback em localStorage
    // IMPORTANTE: O hook garante que o modal NUNCA aparece se:
    // 1. O banco já marcou como completo (fonte da verdade)
    // 2. OU o localStorage tem o flag (fallback para erros de rede)
    // 3. OU houve erro na API (assume completo para não incomodar)
    const { 
        isCompleted: isOnboardingCompletedInDb, 
        isLoading: isOnboardingStatusLoading,
        markComplete: markOnboardingCompleteInDb,
        refetch: refetchOnboardingStatus,
    } = useOnboardingStatus()

    const { data: authStatus } = useQuery({
        queryKey: ['authStatus'],
        queryFn: async () => {
            const response = await fetch('/api/auth/status')
            if (!response.ok) throw new Error('Failed to fetch auth status')
            return response.json()
        },
        initialData: initialAuthStatus ?? undefined,
        staleTime: 5 * 60 * 1000,
        refetchOnMount: false,
        refetchOnWindowFocus: false,
    })

    const companyName = authStatus?.company?.name || initialAuthStatus?.company?.name

    // Logout handler: revoga a sessão, limpa o cache do service worker e navega com
    // reload completo (descarta Router Cache e React Query) — lib/logout-client.ts.
    const handleLogout = useCallback(async () => {
        setIsLoggingOut(true)
        try {
            await logoutAndRedirect()
        } finally {
            setIsLoggingOut(false)
        }
    }, [])

    // Prefetch data on hover for faster page loads
    const prefetchRoute = useCallback((path: string) => {
        switch (path) {
            case '/':
                queryClient.prefetchQuery({
                    queryKey: ['dashboardStats'],
                    queryFn: dashboardService.getStats,
                    staleTime: 15000,
                })
                queryClient.prefetchQuery({
                    queryKey: ['recentCampaigns'],
                    queryFn: dashboardService.getRecentCampaigns,
                    staleTime: 15000,
                })
                break
            case '/campaigns':
                queryClient.prefetchQuery({
                    queryKey: ['campaigns', { page: 1, search: '', status: 'All' }],
                    queryFn: () => campaignService.list({ limit: 20, offset: 0, search: '', status: 'All' }),
                    staleTime: 15000,
                })
                break
            case '/templates':
                queryClient.prefetchQuery({
                    queryKey: ['templates'],
                    queryFn: templateService.getAll,
                    staleTime: Infinity,
                })
                break
            case '/contacts':
                queryClient.prefetchQuery({
                    queryKey: ['contacts', { page: 1, search: '', status: 'ALL', tag: 'ALL' }],
                    queryFn: () => contactService.list({ limit: 10, offset: 0, search: '', status: 'ALL', tag: 'ALL' }),
                    staleTime: 30000,
                })
                break
            case '/settings':
                queryClient.prefetchQuery({
                    queryKey: ['systemStatus'],
                    queryFn: async () => {
                        const response = await fetch('/api/system')
                        if (!response.ok) throw new Error('Failed to fetch system status')
                        return response.json()
                    },
                    staleTime: 60000,
                })
                queryClient.prefetchQuery({
                    queryKey: ['settings'],
                    queryFn: settingsService.get,
                    staleTime: 60000,
                })
                break
        }
    }, [queryClient])

    // Health check query for onboarding
    // IMPORTANTE: Não dar throw em erro para evitar race condition que desmonta componentes
    const { data: healthStatus, refetch: refetchHealth, isFetching: isHealthFetching } = useQuery<HealthStatus>({
        queryKey: ['healthStatus'],
        queryFn: async () => {
            // Usa cache-busting para garantir dados frescos após invalidação
            const response = await fetch('/api/health', {
                cache: 'no-store', // Bypassa cache HTTP
            })
            if (!response.ok) {
                console.warn('[Health] Request failed with status:', response.status)
                // Não lançar erro - retorna null e mantém dados anteriores via staleTime
                return null as unknown as HealthStatus
            }
            return response.json()
        },
        initialData: initialHealthStatus ?? undefined,
        staleTime: 5 * 60 * 1000,
        gcTime: 10 * 60 * 1000,
        retry: 1, // Só tenta 1 vez extra em caso de falha
        retryDelay: 1000,
        refetchInterval: (query) => {
            const data = query.state.data
            const isSetupComplete = data &&
                data.services.database?.status === 'ok'
            return isSetupComplete ? false : 30000 // Polling a cada 30s se não estiver configurado
        },
    })

    // Banco fora → overlay. Vale também para o payload público de /api/health
    // (sessão não validável porque o banco caiu): ele traz services.database.status.
    const needsSetup = !!healthStatus &&
        healthStatus.services.database?.status !== 'ok'

    // WhatsApp/webhook só são confiáveis no payload completo (dono); o público não os checa.
    const fullHealthStatus = healthStatus?.scope === 'public' ? undefined : healthStatus

    // Determina se WhatsApp está conectado
    const isWhatsAppConnected = fullHealthStatus?.services.whatsapp?.status === 'ok'

    // Determina se webhook está configurado
    const isWebhookConfigured = fullHealthStatus?.services.webhook?.status === 'ok'

    // Determina se precisa configurar webhook (WhatsApp conectado mas webhook não)
    const needsWebhookSetup = isWhatsAppConnected && !isWebhookConfigured && fullHealthStatus !== undefined


    // Handler para salvar credenciais (NÃO marca como completo - o usuário ainda precisa configurar webhook)
    const handleSaveCredentials = useCallback(async (credentials: {
        phoneNumberId: string
        businessAccountId: string
        accessToken: string
        metaAppId: string
        metaAppSecret?: string
    }) => {
        // Salva as credenciais no servidor
        await settingsService.save({
            phoneNumberId: credentials.phoneNumberId,
            businessAccountId: credentials.businessAccountId,
            accessToken: credentials.accessToken,
            isConnected: false, // será atualizado pelo save
            displayPhoneNumber: '',
            verifiedName: '',
            testContact: undefined,
        })

        // Salva Meta App ID e Secret separadamente (se fornecido). Não bloqueia o
        // onboarding, mas um App Secret recusado (ou não validado) vira toast — antes
        // o erro sumia no console e o App ID também ficava sem salvar.
        if (credentials.metaAppId?.trim()) {
            await saveMetaAppConfigWithFeedback({
                appId: credentials.metaAppId.trim(),
                appSecret: credentials.metaAppSecret?.trim() || '',
            })
        }

        // Revalida o health status e queries relacionadas
        refetchHealth()
        queryClient.invalidateQueries({ queryKey: ['settings'] })
        queryClient.invalidateQueries({ queryKey: ['allSettings'] })
        queryClient.invalidateQueries({ queryKey: ['metaAppConfig'] })
        queryClient.invalidateQueries({ queryKey: ['account-limits'] })

        // Sincroniza templates automaticamente em background (não bloqueia o usuário)
        templateService.sync().then((count) => {
            console.log(`[Onboarding] Templates sincronizados automaticamente: ${count}`)
            queryClient.invalidateQueries({ queryKey: ['templates'] })
        }).catch((err) => {
            // Falha silenciosa - usuário pode sincronizar manualmente depois
            console.warn('[Onboarding] Falha ao sincronizar templates:', err)
        })
    }, [refetchHealth, queryClient])

    // Handler para marcar onboarding como completo (chamado quando o usuário finaliza TODO o fluxo)
    const handleMarkOnboardingComplete = useCallback(async () => {
        // Marca o onboarding como completo no localStorage (para compatibilidade)
        completeOnboarding()
        
        // Marca no banco + localStorage + invalida queries (tudo pelo hook)
        await markOnboardingCompleteInDb()
    }, [completeOnboarding, markOnboardingCompleteInDb])

    // Handler para quando credenciais são conectadas com sucesso (novo fluxo Dashboard-First)
    const handleCredentialsSuccess = useCallback(() => {
        setShowSuccessBanner(true)
        refetchHealth()
        queryClient.invalidateQueries({ queryKey: ['settings'] })
        queryClient.invalidateQueries({ queryKey: ['allSettings'] })
        // Marca onboarding como completo automaticamente no novo fluxo
        handleMarkOnboardingComplete()
        // Inicia tour guiado se for a primeira vez
        if (guidedTour.shouldShow) {
            // Pequeno delay para o banner de sucesso aparecer primeiro
            setTimeout(() => {
                setShowSuccessBanner(false)
                setShowGuidedTour(true)
            }, 2000)
        }
    }, [refetchHealth, queryClient, handleMarkOnboardingComplete, guidedTour.shouldShow])

    // Handler para abrir tutorial de como obter credenciais
    const handleHelpClick = useCallback(() => {
        setShowCredentialsModal(false)
        setForceModalStep('requirements')
    }, [])

    // Sidebar callback - DEVE estar antes de qualquer early return
    const handleCloseMobileMenu = useCallback(() => setIsMobileMenuOpen(false), [])

    // Gaveta de navegação mobile (ExpandedSidebar aberta pelo OpenMenuButton).
    // Enquanto aberta: o foco entra no "Fechar menu" da gaveta, o conteúdo
    // principal fica `inert` (o Tab não escapa para o que está sob o scrim),
    // Escape fecha de qualquer ponto e, ao chegar no breakpoint lg (onde a
    // gaveta deixa de ser mobile), ela fecha para não deixar o conteúdo inerte.
    // Ao fechar, o foco volta ao botão de menu se estava na gaveta ou se perdeu.
    // DEVE ficar antes do early return de needsSetup (ordem dos hooks).
    const openMenuButtonRef = useRef<HTMLButtonElement>(null)
    const mobileCloseButtonRef = useRef<HTMLButtonElement>(null)
    const wasMobileMenuOpenRef = useRef(false)
    useEffect(() => {
        if (!isMobileMenuOpen) {
            if (!wasMobileMenuOpenRef.current) return
            wasMobileMenuOpenRef.current = false
            const active = document.activeElement
            const drawer = document.getElementById(MOBILE_NAV_ID)
            if (!active || active === document.body || drawer?.contains(active)) {
                openMenuButtonRef.current?.focus()
            }
            return
        }

        wasMobileMenuOpenRef.current = true
        mobileCloseButtonRef.current?.focus()

        const handleKeyDown = (event: KeyboardEvent) => {
            // defaultPrevented: Escape já consumido por outra camada (popup aberto por cima).
            if (event.key !== 'Escape' || event.defaultPrevented) return
            event.preventDefault()
            handleCloseMobileMenu()
        }
        // lg do Tailwind v4 (64rem): a partir dele a gaveta é a sidebar do desktop.
        const desktopQuery = window.matchMedia('(min-width: 64rem)')
        const handleBreakpoint = () => {
            if (desktopQuery.matches) handleCloseMobileMenu()
        }
        document.addEventListener('keydown', handleKeyDown)
        desktopQuery.addEventListener('change', handleBreakpoint)
        return () => {
            document.removeEventListener('keydown', handleKeyDown)
            desktopQuery.removeEventListener('change', handleBreakpoint)
        }
    }, [isMobileMenuOpen, handleCloseMobileMenu])

    // Memoize navItems to prevent recreation on every render
    // T069: Include dynamic unread badge for inbox
    const navItems = useMemo(() => [
        { path: '/', label: 'Dashboard', icon: LayoutDashboard },
        { path: '/campaigns', label: 'Campanhas', icon: MessageSquare },
        { path: '/inbox', label: 'Inbox', icon: MessageCircle }, // Badge dinâmico renderizado no DashboardSidebar
        { path: '/workflows', label: 'Workflow', icon: Workflow, badge: 'Beta' },
        { path: '/conversations', label: 'Conversas', icon: MessageCircle, hidden: true },
        { path: '/templates', label: 'Templates', icon: FileText },
        { path: '/contacts', label: 'Contatos', icon: Users },
        { path: '/crm', label: 'CRM', icon: SquareKanban, badge: 'Novo' },
        { path: '/attendants', label: 'Atendentes', icon: Headset, badge: 'Novo' },
        // Bot (e não Sparkles): o DS V2 proíbe Sparkles como símbolo de IA
        { path: '/settings/ai', label: 'IA', icon: Bot },
        { path: '/settings', label: 'Configurações', icon: Settings },
    ].filter(item => !item.hidden), [isDevMode])

    const getPageTitle = (path: string) => {
        if (path === '/') return 'Dashboard'
        if (path === '/campaigns') return 'Campanhas'
        if (path.startsWith('/campaigns/new')) return 'Nova Campanha'
        if (path.startsWith('/campaigns/')) return 'Detalhes da Campanha'
        if (path === '/workflows') return 'Workflows'
        if (path === '/inbox') return 'Inbox'
        if (path.startsWith('/inbox/')) return 'Conversa'
        if (path === '/conversations') return 'Conversas'
        if (path.startsWith('/conversations/')) return 'Conversa'
        if (path.startsWith('/builder')) return 'Workflow'
        if (path === '/flows') return 'MiniApps'
        if (path === '/flows/builder') return 'MiniApp Builder'
        if (path.startsWith('/flows/builder/')) return 'Editor de MiniApp'
        if (path === '/templates') return 'Templates'
        if (path.startsWith('/contacts')) return 'Contatos'
        if (path.startsWith('/crm')) return 'CRM'
        if (path.startsWith('/submissions')) return 'Submissões'
        if (path === '/settings/ai') return 'Central de IA'
        if (path === '/settings/ai/agents') return 'Agentes IA'
        if (path.startsWith('/settings')) return 'Configurações'
        return 'App'
    }

    // Props da sidebar, memoizadas para evitar re-render do DashboardSidebar.
    // DEVE ficar antes do early return de needsSetup: quando o setup termina na
    // sessão (needsSetup true → false), um hook a mais depois do return quebraria
    // a ordem dos hooks ("Rendered more hooks than during the previous render").
    const sidebarProps = useMemo(() => ({
        pathname,
        navItems: navItems as NavItem[],
        isSidebarExpanded,
        isMobileMenuOpen,
        isLoggingOut,
        companyName: companyName || null,
        brandName: BRAND.name,
        brandLogoUrl: BRAND.logoUrl,
        onToggleSidebar: updateSidebarExpanded,
        onCloseMobileMenu: handleCloseMobileMenu,
        onLogout: handleLogout,
        onPrefetchRoute: prefetchRoute,
        mobileCloseButtonRef,
    }), [
        pathname,
        navItems,
        isSidebarExpanded,
        isMobileMenuOpen,
        isLoggingOut,
        companyName,
        updateSidebarExpanded,
        handleCloseMobileMenu,
        handleLogout,
        prefetchRoute,
    ])

    // Show onboarding overlay if setup is needed
    if (needsSetup) {
        return (
            <OnboardingOverlay
                health={healthStatus || null}
                isLoading={isHealthFetching}
                onRefresh={() => refetchHealth()}
            />
        )
    }

    // Determina se deve mostrar o modal de onboarding do WhatsApp
    // Mostra quando: infra OK E onboarding não marcado como completo no banco
    // Só mostra modal de onboarding após carregar status do banco (evita flash)
    // O usuário pode FECHAR o modal e usar o sistema (reabre pelo menu de ajuda).
    const showWhatsAppOnboarding = !needsSetup && !isOnboardingStatusLoading && !isOnboardingCompletedInDb && !onboardingDismissed

    // Se WhatsApp já conectado mas onboarding não completo, força ir para step de webhook
    const onboardingForceStep = isWhatsAppConnected && !isOnboardingCompletedInDb
        ? 'configure-webhook' as const
        : undefined

    const isBuilderRoute = pathname?.startsWith('/builder') ?? false
    const pageTitle = getPageTitle(pathname || '/')
    const isInboxRoute = pathname?.startsWith('/inbox') ?? false

    // Abre o menu mobile: a gaveta é a ExpandedSidebar, então garante o estado expandido.
    const openMobileMenu = () => {
        updateSidebarExpanded(true)
        setIsMobileMenuOpen(true)
    }

    if (isBuilderRoute) {
        return (
            <PageLayoutProvider>
                <div
                    className={SHELL_ROOT_CLASS}
                    style={{ "--builder-sidebar-width": "56px" } as React.CSSProperties}
                >
                    <DashboardSidebar {...sidebarProps} />
                    {/* ExpandedSidebar é fixed (223px) e sobrepõe o conteúdo — o padding
                        precisa acompanhar o estado, senão o header do builder fica
                        escondido embaixo da sidebar (título/voltar cortados). */}
                    <div
                        className={cn(
                            'flex-1 min-w-0',
                            CONTENT_PADDING_TRANSITION,
                            isSidebarExpanded ? 'lg:pl-56' : 'lg:pl-14'
                        )}
                    >
                        {children}
                    </div>
                </div>
            </PageLayoutProvider>
        )
    }

    // Inbox route - full-bleed layout without header for native feel
    if (isInboxRoute) {
        return (
            <PageLayoutProvider>
                <div className={SHELL_ROOT_CLASS}>
                    {isMobileMenuOpen && <MobileNavScrim onClose={handleCloseMobileMenu} />}

                    <DashboardSidebar {...sidebarProps} />

                    {/* Main Content - no header on desktop, compact mobile header */}
                    {/* CompactSidebar is lg:static (in flow), ExpandedSidebar is fixed (needs padding) */}
                    {/* inert com a gaveta mobile aberta: conteúdo sob o scrim fora do Tab */}
                    <div
                        inert={isMobileMenuOpen}
                        className={cn(
                            "flex-1 flex flex-col min-w-0 h-screen overflow-hidden",
                            CONTENT_PADDING_TRANSITION,
                            isSidebarExpanded && "lg:pl-56"
                        )}
                    >
                        {/* Header mobile: superfície sólida (sem vidro sobre fundo chapado) */}
                        <header className={cn(HEADER_CLASS, 'px-4 lg:hidden')}>
                            <div className="flex min-w-0 items-center gap-2">
                                <OpenMenuButton
                                    ref={openMenuButtonRef}
                                    expanded={isMobileMenuOpen}
                                    onClick={openMobileMenu}
                                />
                                <span className="truncate text-sm font-(--eia-weight-semibold) text-eia-text">Inbox</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <DevModeToggle />
                            </div>
                        </header>
                        <PageContentShell>
                            {children}
                        </PageContentShell>
                    </div>
                </div>
            </PageLayoutProvider>
        )
    }

    return (
        <PageLayoutProvider>
            <div className={SHELL_ROOT_CLASS}>
            {isMobileMenuOpen && <MobileNavScrim onClose={handleCloseMobileMenu} />}

            {/* Sidebar - extracted component with memoization */}
            <DashboardSidebar {...sidebarProps} />

            {/* Main Content - padding only when expanded (ExpandedSidebar is fixed).
                inert com a gaveta mobile aberta: conteúdo sob o scrim fora do Tab. */}
            <div
                inert={isMobileMenuOpen}
                className={cn(
                    "flex-1 flex flex-col min-w-0 h-screen overflow-hidden",
                    CONTENT_PADDING_TRANSITION,
                    isSidebarExpanded && "lg:pl-56"
                )}
            >
                {/* Header: superfície sólida do canvas + borda inferior sutil (64px,
                    alinhado ao topo da sidebar). Sem vidro: o fundo é chapado. */}
                <header className={cn(HEADER_CLASS, 'sticky top-0 z-30 px-6 lg:px-10')}>
                    <div className="flex min-w-0 items-center gap-3">
                        <span className="flex lg:hidden">
                            <OpenMenuButton
                                ref={openMenuButtonRef}
                                expanded={isMobileMenuOpen}
                                onClick={openMobileMenu}
                            />
                        </span>

                        {/* Mobile: só o título da página; md+: breadcrumb do DS */}
                        <span className="truncate text-sm font-(--eia-weight-semibold) text-eia-text md:hidden">
                            {pageTitle}
                        </span>
                        <div className="hidden min-w-0 md:block">
                            <EiaBreadcrumb items={[{ label: BRAND.name }, { label: pageTitle }]} />
                        </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                        <ChecklistMiniBadge isOnboardingCompletedInDb={isOnboardingCompletedInDb} />

                        {/* Tutoriais de Configuração */}
                        <TutorialsSheet
                            onOpenStep={(step) => setForceModalStep(step)}
                        />

                        <DevModeToggle />
                        {/* Notificações: escondido até implementação real */}
                    </div>
                </header>

                {/* WhatsApp Onboarding Modal */}
                {showWhatsAppOnboarding && (
                    <OnboardingModal
                        isConnected={!!isWhatsAppConnected}
                        onSaveCredentials={handleSaveCredentials}
                        onMarkComplete={handleMarkOnboardingComplete}
                        forceStep={onboardingForceStep}
                        onClose={dismissOnboarding}
                    />
                )}

                {/* Modal de Tutorial (menu de ajuda) */}
                {forceModalStep && (
                    <OnboardingModal
                        isConnected={!!isWhatsAppConnected}
                        onSaveCredentials={handleSaveCredentials}
                        onMarkComplete={handleMarkOnboardingComplete}
                        forceStep={forceModalStep}
                        onClose={() => setForceModalStep(undefined)}
                        tutorialMode={true}
                    />
                )}

                {/* NOVO: Modal de credenciais simplificado (Dashboard-First) */}
                <CredentialsModal
                    open={showCredentialsModal}
                    onOpenChange={setShowCredentialsModal}
                    onSuccess={handleCredentialsSuccess}
                    onHelpClick={handleHelpClick}
                />

                {/* NOVO: Tour guiado pós-conexão (Dashboard-First) */}
                {showGuidedTour && (
                    <GuidedTour
                        onComplete={() => {
                            setShowGuidedTour(false)
                            guidedTour.markAsCompleted()
                        }}
                        onSkip={() => {
                            setShowGuidedTour(false)
                            guidedTour.markAsCompleted()
                        }}
                    />
                )}

                {/* Webhook Alert Banner - mostra se webhook não configurado */}
                <WebhookAlertBanner />

                {/* Page Content */}
                <PageContentShell>
                    {/* SuccessBanner - mostra após conectar WhatsApp */}
                    {pathname === '/' && showSuccessBanner && isWhatsAppConnected && (
                        <SuccessBanner
                            onSendTest={() => {
                                setShowSuccessBanner(false)
                                router.push('/campaigns/new')
                            }}
                        />
                    )}


                    {/* Onboarding Checklist LEGADO - mantido para transição */}
                    {/* Mostra se: onboarding completo (banco OU localStorage) E não dismissado E não minimizado E novo checklist não ativo */}
                    {pathname === '/' && !isOnboardingCompletedInDb && !isOnboardingStatusLoading && (shouldShowChecklist) && !onboardingProgress.isChecklistMinimized && !onboardingProgress.isChecklistDismissed && fullHealthStatus && (
                        <div className="mb-6">
                            <OnboardingChecklist
                                healthStatus={fullHealthStatus}
                                onNavigate={(path) => router.push(path)}
                                onOpenStep={setForceModalStep}
                            />
                        </div>
                    )}
                    {children}
                </PageContentShell>
            </div>
        </div>
        </PageLayoutProvider>
    )
}

/** Raiz do shell: canvas do DS (--eia-color-bg) e seleção no token do DS (--eia-color-selection). */
const SHELL_ROOT_CLASS =
    'flex min-h-screen bg-eia-bg font-sans text-eia-text selection:bg-[var(--eia-color-selection)]'

/** O padding do conteúdo acompanha a sidebar com o mesmo movimento do DS. */
const CONTENT_PADDING_TRANSITION =
    'transition-[padding] duration-(--eia-motion-normal) ease-(--eia-motion-ease)'

/** Header do shell: 64px, superfície sólida e borda inferior sutil. */
const HEADER_CLASS =
    'flex h-16 shrink-0 items-center justify-between gap-4 border-b border-eia-border-subtle bg-eia-bg'

/**
 * Botão de abrir o menu mobile. Quem chama controla a visibilidade num
 * wrapper: .eia-button define display sem @layer e venceria lg:hidden.
 * aria-expanded/aria-controls ligam o botão à gaveta (ExpandedSidebar); o ref
 * recebe o foco de volta quando a gaveta fecha.
 */
function OpenMenuButton({
    ref,
    expanded,
    onClick,
}: {
    ref?: Ref<HTMLButtonElement>
    expanded: boolean
    onClick: () => void
}) {
    return (
        <EiaIconButton
            ref={ref}
            label="Abrir menu de navegação"
            size="sm"
            aria-expanded={expanded}
            aria-controls={MOBILE_NAV_ID}
            onClick={onClick}
        >
            <Menu size={20} />
        </EiaIconButton>
    )
}

/**
 * Scrim do menu mobile: material de scrim do DS, sem blur sobre fundo chapado.
 * Só para o clique/toque fora; fica fora da árvore de acessibilidade e do Tab
 * (Escape e o botão "Fechar menu" da gaveta cobrem o teclado).
 */
function MobileNavScrim({ onClose }: { onClose: () => void }) {
    return (
        <div
            aria-hidden="true"
            className="fixed inset-0 z-40 bg-[var(--eia-material-scrim)] lg:hidden"
            onClick={onClose}
        />
    )
}

function PageContentShell({ children }: { children: React.ReactNode }) {
    const layout = usePageLayout()

    const mainOverflowClass = layout.overflow === 'hidden' ? 'overflow-hidden' : 'overflow-auto'
    const mainPaddingClass = layout.padded ? 'p-6 lg:p-10' : ''
    const wrapperWidthClass = getPageWidthClass(layout.width)
    const wrapperHeightClass = layout.height === 'full' ? 'h-full' : ''

    return (
        <main className={`flex-1 ${mainOverflowClass} ${mainPaddingClass}`.trim()}>
            <div className={`${wrapperWidthClass} ${wrapperHeightClass}`.trim()}>
                {layout.showAccountAlerts && <AccountAlertBanner />}
                {children}
            </div>
        </main>
    )
}
