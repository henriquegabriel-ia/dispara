import { EiaPanel, EiaSkeleton } from '@/components/eia'
import { Page, PageActions, PageHeader } from '@/components/app/page'

/**
 * Carregamento do grupo (dashboard).
 *
 * Reproduz o painel inicial (métricas + gráfico + campanhas recentes), mas
 * também é o fallback das rotas do grupo sem loading.tsx próprio (inbox,
 * fluxos, templates…): por isso o cabeçalho é só esqueleto, sem título fixo.
 * Superfícies `dense` (sólidas): o canvas do app é chapado, sem vidro.
 * Sem aria-busy no contêiner: o EiaSkeleton com `label` já é a região de
 * status (role="status") e um ancestral ocupado silenciaria o anúncio.
 */

// Larguras fixas encolhem em telas estreitas sem estourar a coluna.
const FIT = { maxWidth: '100%' } as const
const CONTROL = { borderRadius: 'var(--eia-radius-control)' } as const
const PILL = { borderRadius: 'var(--eia-radius-pill)' } as const

export default function DashboardLoading() {
  return (
    <Page>
      <PageHeader>
        <div className="flex min-w-0 flex-col gap-3">
          <EiaSkeleton variant="text" label="Carregando página…" width="14rem" height={32} style={FIT} />
          <EiaSkeleton variant="text" width="22rem" style={FIT} />
        </div>
        <PageActions>
          <EiaSkeleton width="10rem" height={44} style={CONTROL} />
        </PageActions>
      </PageHeader>

      {/* Métricas: destaque em 2 colunas + 2 cartões */}
      <section className="grid grid-cols-1 gap-6 md:grid-cols-4">
        <EiaPanel material="dense" className="flex flex-col gap-4 md:col-span-2">
          <EiaSkeleton variant="text" width="8rem" style={FIT} />
          <EiaSkeleton variant="text" width="11rem" height={40} style={FIT} />
          <EiaSkeleton variant="text" width="9rem" style={FIT} />
        </EiaPanel>
        {[0, 1].map((card) => (
          <EiaPanel key={card} material="dense" className="flex flex-col gap-3">
            <EiaSkeleton width={40} height={40} />
            <EiaSkeleton variant="text" width="60%" />
            <EiaSkeleton variant="text" width="40%" height={28} />
          </EiaPanel>
        ))}
      </section>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
        {/* Gráfico de volume */}
        <EiaPanel material="dense" className="flex flex-col gap-8 lg:col-span-2">
          <div className="flex items-center justify-between gap-4">
            <EiaSkeleton variant="text" width="10rem" height={20} style={FIT} />
            <div className="flex shrink-0 gap-2">
              {[0, 1, 2].map((range) => (
                <EiaSkeleton key={range} width={48} height={30} style={PILL} />
              ))}
            </div>
          </div>
          <EiaSkeleton height={288} />
        </EiaPanel>

        {/* Campanhas recentes */}
        <EiaPanel material="dense" noPadding className="flex flex-col">
          <div className="flex items-center justify-between gap-4 border-b border-eia-border-subtle p-6">
            <EiaSkeleton variant="text" width="11rem" height={20} style={FIT} />
            <EiaSkeleton width={20} height={20} />
          </div>
          {[0, 1, 2, 3, 4].map((row) => (
            <div
              key={row}
              className="flex items-center justify-between gap-4 border-b border-eia-border-subtle px-6 py-4 last:border-b-0"
            >
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <EiaSkeleton variant="text" width="8rem" style={FIT} />
                <EiaSkeleton variant="text" width="5rem" style={FIT} />
              </div>
              <EiaSkeleton width={76} height={24} style={PILL} />
            </div>
          ))}
        </EiaPanel>
      </div>
    </Page>
  )
}
