'use client'

/**
 * Error Boundary Component
 *
 * Captura erros em componentes filhos e exibe uma UI de fallback no padrão de
 * estado de erro do DS Empreende IA V2 (EiaPanel + EiaEmpty, como o EiaState).
 */

import React, { Component, type ErrorInfo, type ReactNode } from 'react'
import { Bug, CircleAlert, House, RefreshCw, RotateCcw } from 'lucide-react'

import { EiaButton, EiaEmpty, EiaPanel } from '@/components/eia'

interface ErrorBoundaryProps {
  children: ReactNode
  fallback?: ReactNode
  onError?: (error: Error, errorInfo: ErrorInfo) => void
}

interface ErrorBoundaryState {
  hasError: boolean
  error: Error | null
  errorInfo: ErrorInfo | null
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  /**
   * Cria um Error Boundary para capturar exceções em tempo de renderização dos filhos.
   *
   * @param props Propriedades do componente (children, fallback opcional e callback `onError`).
   */
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false, error: null, errorInfo: null }
  }

  /**
   * Atualiza o estado quando um erro acontece em algum componente descendente.
   *
   * @param error Erro lançado durante renderização/commit.
   * @returns Um parcial do estado, marcando `hasError` e guardando o erro.
   */
  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error }
  }

  /**
   * Hook do React chamado após capturar um erro em um componente filho.
   *
   * @param error Erro capturado.
   * @param errorInfo Informações adicionais (component stack).
   * @returns Nada.
   */
  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    this.setState({ errorInfo })
    this.props.onError?.(error, errorInfo)

    // Log para monitoramento
    console.error('ErrorBoundary caught an error:', {
      error: error.message,
      stack: error.stack,
      componentStack: errorInfo.componentStack,
    })
  }

  /**
   * Reseta o estado do boundary e tenta renderizar novamente os filhos.
   *
   * @returns Nada.
   */
  handleReset = (): void => {
    this.setState({ hasError: false, error: null, errorInfo: null })
  }

  /**
   * Recarrega a página atual.
   *
   * @returns Nada.
   */
  handleReload = (): void => {
    window.location.reload()
  }

  /**
   * Redireciona para a home (`/`) com recarga completa (estado limpo após o erro).
   *
   * @returns Nada.
   */
  handleGoHome = (): void => {
    window.location.href = '/'
  }

  /**
   * Renderiza os filhos normalmente ou a UI de fallback quando `hasError`.
   *
   * Material `dense` (e não o `panel` fixo do EiaState): o canvas do app é
   * chapado e vidro sem fundo com variação real não se sustenta.
   *
   * @returns Elemento React com children ou fallback.
   */
  render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback
      }

      return (
        <div className="flex min-h-100 items-center justify-center p-(--eia-space-8)">
          <EiaPanel material="dense" role="alert" className="w-full max-w-lg">
            <EiaEmpty
              icon={<CircleAlert />}
              title="Não foi possível exibir esta área"
              description="Ocorreu um erro inesperado. Tente de novo; se continuar, recarregue a página ou volte ao início."
              action={
                <div className="flex flex-wrap justify-center gap-(--eia-space-3)">
                  <EiaButton leadingIcon={<RefreshCw />} onClick={this.handleReload}>
                    Recarregar página
                  </EiaButton>
                  <EiaButton
                    variant="secondary"
                    leadingIcon={<RotateCcw />}
                    onClick={this.handleReset}
                  >
                    Tentar de novo
                  </EiaButton>
                  <EiaButton variant="ghost" leadingIcon={<House />} onClick={this.handleGoHome}>
                    Voltar ao início
                  </EiaButton>
                </div>
              }
            />

            {/* Detalhes do erro (somente em desenvolvimento) */}
            {process.env.NODE_ENV === 'development' && this.state.error && (
              <details className="mt-(--eia-space-2) text-left">
                <summary className="flex cursor-pointer items-center gap-(--eia-space-2) rounded-(--eia-radius-small) text-(length:--eia-type-label) text-eia-subtle hover:text-eia-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-eia-focus">
                  <Bug className="size-4" aria-hidden="true" />
                  Detalhes do erro (somente em desenvolvimento)
                </summary>
                <div className="mt-(--eia-space-3) overflow-auto rounded-(--eia-radius-control) border border-eia-border-subtle bg-eia-code p-(--eia-space-4)">
                  <p className="mb-(--eia-space-2) font-mono text-(length:--eia-type-label) text-eia-danger">
                    {this.state.error.message}
                  </p>
                  {this.state.error.stack && (
                    <pre className="whitespace-pre-wrap font-mono text-(length:--eia-type-caption) text-eia-code-text">
                      {this.state.error.stack}
                    </pre>
                  )}
                  {this.state.errorInfo?.componentStack && (
                    <pre className="mt-(--eia-space-4) whitespace-pre-wrap border-t border-eia-border-subtle pt-(--eia-space-4) font-mono text-(length:--eia-type-caption) text-eia-code-text">
                      {this.state.errorInfo.componentStack}
                    </pre>
                  )}
                </div>
              </details>
            )}
          </EiaPanel>
        </div>
      )
    }

    return this.props.children
  }
}

/**
 * Error Boundary de alto nível para envolver páginas inteiras.
 *
 * Útil para evitar que uma exceção em qualquer componente da página derrube
 * toda a navegação; permite também plugar monitoramento (ex.: Sentry).
 *
 * @param props Propriedades do componente.
 * @param props.children Conteúdo da página.
 * @returns Componente {@link ErrorBoundary} envolvendo `children`.
 */
export function PageErrorBoundary({ children }: { children: ReactNode }) {
  return (
    <ErrorBoundary
      onError={(error, errorInfo) => {
        // Aqui poderia enviar para serviço de monitoramento como Sentry
        console.error('Page error:', error, errorInfo)
      }}
    >
      {children}
    </ErrorBoundary>
  )
}

export default ErrorBoundary
