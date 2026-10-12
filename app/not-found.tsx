import type { Metadata } from 'next'
import Link from 'next/link'
import { House, SearchX } from 'lucide-react'
import { EiaEmpty, EiaPanel } from '@/components/eia'
import { BRAND } from '@/lib/branding'

export const metadata: Metadata = {
  title: `Página não encontrada · ${BRAND.name}`,
}

/**
 * 404 de todo o app (URL sem rota e notFound() sem not-found mais próximo).
 * Renderiza só dentro do layout raiz, fora do shell do painel: ocupa a tela.
 * Superfície sólida (`dense`): o fundo é chapado, sem vidro.
 */
export default function NotFound() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-eia-bg px-4 py-12 text-eia-text">
      <h1 className="eia-sr-only">Erro 404</h1>
      <EiaPanel material="dense" className="w-full max-w-md">
        <EiaEmpty
          icon={<SearchX />}
          title="Página não encontrada"
          description="O endereço pode ter mudado ou a página foi removida. Confira o link ou volte ao início."
          action={
            <Link href="/" className="eia-button" data-variant="primary" data-size="md">
              <span className="eia-button-icon" aria-hidden="true">
                <House />
              </span>
              <span className="eia-button-label">Voltar ao início</span>
            </Link>
          }
        />
      </EiaPanel>
    </main>
  )
}
