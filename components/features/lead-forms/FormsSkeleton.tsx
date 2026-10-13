import { EiaPanel, EiaSkeleton } from '@/components/eia'
import { Page, PageActions, PageDescription, PageHeader, PageTitle } from '@/components/app/page'

/**
 * Esqueleto dos cartões de formulário (mesma estrutura do FormCard: nome +
 * status, tag, link e ações). Um único anúncio de status para o grupo; os
 * blocos em si ficam escondidos do leitor de tela.
 */
export function FormCardSkeletonList({ count = 3 }: { count?: number }) {
  return (
    <div role="status" className="space-y-3">
      <span className="sr-only">Carregando formulários…</span>
      {Array.from({ length: count }, (_, i) => (
        <EiaPanel key={i} material="dense" aria-hidden="true">
          <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
            <div className="min-w-0 flex-1 basis-64 space-y-3">
              <div className="flex items-center gap-2">
                <EiaSkeleton variant="text" width="45%" />
                <EiaSkeleton width={52} height={20} style={{ borderRadius: 'var(--eia-radius-pill)' }} />
              </div>
              <EiaSkeleton variant="text" width="35%" />
              <EiaSkeleton variant="text" width="70%" />
            </div>
            <div className="flex gap-1">
              {Array.from({ length: 4 }, (_, j) => (
                <EiaSkeleton key={j} width={44} height={44} />
              ))}
            </div>
          </div>
        </EiaPanel>
      ))}
    </div>
  )
}

/** Fallback de Suspense da página /forms: cabeçalho real + cartões em esqueleto. */
export function FormsSkeleton() {
  return (
    <Page>
      <PageHeader>
        <div>
          <PageTitle>Formulários</PageTitle>
          <PageDescription>Crie um link público para captar contatos e aplicar uma tag automaticamente.</PageDescription>
        </div>
        <PageActions>
          <EiaSkeleton width={176} height={44} style={{ borderRadius: 'var(--eia-radius-control)' }} />
        </PageActions>
      </PageHeader>

      <div className="space-y-4">
        <div className="space-y-2" aria-hidden="true">
          <EiaSkeleton variant="text" width={180} />
          <EiaSkeleton variant="text" width={280} />
        </div>
        <FormCardSkeletonList count={4} />
      </div>
    </Page>
  )
}
