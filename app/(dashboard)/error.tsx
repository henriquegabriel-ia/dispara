'use client'

import { useEffect, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { CircleAlert, House, RotateCw } from 'lucide-react'
import { EiaButton, EiaEmpty, EiaPanel } from '@/components/eia'

interface DashboardErrorProps {
  error: Error & { digest?: string }
  reset: () => void
}

/**
 * Erro de renderização numa rota do painel. Fica dentro do shell (menu e
 * cabeçalho continuam funcionando) e nunca mostra mensagem nem stack: só o
 * código (digest), que localiza o erro nos logs do servidor.
 *
 * Mesma composição do ErrorBoundary (EiaPanel `dense` + EiaEmpty) e não o
 * EiaState: ele fixa o material `panel` (vidro), e o canvas do shell é
 * chapado; além disso o EiaState desenha o ícone Info num estado de erro.
 */
export default function DashboardError({ error, reset }: DashboardErrorProps) {
  const router = useRouter()
  const [isRetrying, startRetry] = useTransition()

  useEffect(() => {
    console.error('Falha ao renderizar a página do painel', error.digest ? { digest: error.digest } : error)
  }, [error])

  // reset() sozinho só re-renderiza no cliente; refresh() busca de novo o
  // conteúdo do servidor (erros de Server Component).
  const retry = () =>
    startRetry(() => {
      router.refresh()
      reset()
    })

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col py-12">
      <h1 className="eia-sr-only">Erro ao abrir a página</h1>
      <EiaPanel material="dense">
        <EiaEmpty
          icon={<CircleAlert />}
          title="Não foi possível abrir esta página"
          description="Tente de novo. Se o problema continuar, volte ao início e abra a página outra vez."
          action={
            <div className="flex flex-col items-center gap-4">
              <div className="flex flex-wrap justify-center gap-3">
                <EiaButton
                  onClick={retry}
                  loading={isRetrying}
                  focusableWhenDisabled
                  leadingIcon={<RotateCw />}
                >
                  {isRetrying ? 'Tentando de novo…' : 'Tentar de novo'}
                </EiaButton>
                <Link href="/" className="eia-button" data-variant="secondary" data-size="md">
                  <span className="eia-button-icon" aria-hidden="true">
                    <House />
                  </span>
                  <span className="eia-button-label">Voltar ao início</span>
                </Link>
              </div>
              {error.digest && (
                <p className="text-xs text-eia-subtle">
                  Código do erro: <code className="font-mono">{error.digest}</code>
                </p>
              )}
            </div>
          }
        />
      </EiaPanel>
    </div>
  )
}
