import { EiaSkeleton } from '@/components/eia'
import { Page, PageActions, PageHeader } from '@/components/app/page'
import { DashboardSkeletonContent } from '@/components/features/dashboard/DashboardSkeleton'

/**
 * Carregamento do grupo (dashboard).
 *
 * O corpo é o mesmo esqueleto do painel inicial (DashboardSkeletonContent:
 * métricas + volume de mensagens + campanhas recentes), para a troca com o
 * fallback do Suspense da página não pular de layout. Este arquivo também é o
 * fallback das rotas do grupo sem loading.tsx próprio (inbox, fluxos,
 * templates…): por isso o cabeçalho é só esqueleto, sem título fixo.
 * Sem aria-busy no contêiner: o EiaSkeleton com `label` já é a região de
 * status (role="status") e um ancestral ocupado silenciaria o anúncio — por
 * isso também só o cabeçalho anuncia, e o corpo vai sem `label`.
 */

// Larguras fixas encolhem em telas estreitas sem estourar a coluna.
const FIT = { maxWidth: '100%' } as const
const CONTROL = { maxWidth: '100%', borderRadius: 'var(--eia-radius-control)' } as const

export default function DashboardLoading() {
  return (
    <Page>
      <PageHeader>
        <div className="flex min-w-0 flex-col gap-3">
          <EiaSkeleton variant="text" label="Carregando página…" width="14rem" height={32} style={FIT} />
          <EiaSkeleton variant="text" width="22rem" style={FIT} />
        </div>
        <PageActions>
          <EiaSkeleton width="10.5rem" height={44} style={CONTROL} />
        </PageActions>
      </PageHeader>

      <DashboardSkeletonContent />
    </Page>
  )
}
