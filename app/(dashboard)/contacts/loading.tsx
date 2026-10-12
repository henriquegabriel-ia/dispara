import { EiaPanel, EiaSkeleton } from '@/components/eia'
import { Page, PageActions, PageHeader } from '@/components/app/page'

/**
 * Carregamento de /contacts: cabeçalho com ações, métricas e a tabela que
 * ocupa o resto da altura (o layout da rota usa altura cheia com rolagem
 * interna, então a página é uma coluna flex com a tabela em flex-1).
 * Sem aria-busy no contêiner: o EiaSkeleton com `label` já é a região de
 * status (role="status") e um ancestral ocupado silenciaria o anúncio.
 */

const FIT = { maxWidth: '100%' } as const
const CONTROL = { borderRadius: 'var(--eia-radius-control)' } as const
const PILL = { borderRadius: 'var(--eia-radius-pill)' } as const

export default function ContactsLoading() {
  return (
    <Page className="flex h-full min-h-0 flex-col">
      <PageHeader>
        <div className="flex min-w-0 flex-col gap-3">
          <EiaSkeleton variant="text" label="Carregando contatos…" width="10rem" height={32} style={FIT} />
          <EiaSkeleton variant="text" width="16rem" style={FIT} />
        </div>
        {/* Importar (ícone), Campos personalizados, Novo contato */}
        <PageActions className="flex-wrap justify-start sm:justify-end">
          <EiaSkeleton width={44} height={44} style={CONTROL} />
          <EiaSkeleton width="12rem" height={44} style={CONTROL} />
          <EiaSkeleton width="9.5rem" height={44} style={CONTROL} />
        </PageActions>
      </PageHeader>

      {/* Métricas: destaque em 2 colunas + 2 cartões */}
      <section className="grid grid-cols-1 gap-6 md:grid-cols-4">
        <EiaPanel material="dense" className="flex flex-col gap-4 md:col-span-2">
          <EiaSkeleton variant="text" width="8rem" style={FIT} />
          <EiaSkeleton variant="text" width="10rem" height={40} style={FIT} />
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

      {/* Filtros, linhas e paginação */}
      <EiaPanel material="dense" noPadding className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-eia-border-subtle p-4 sm:flex-row">
          <div className="min-w-0 flex-1">
            <EiaSkeleton height={44} style={PILL} />
          </div>
          <div className="flex gap-3">
            <EiaSkeleton width="8rem" height={44} style={CONTROL} />
            <EiaSkeleton width={44} height={44} style={CONTROL} />
          </div>
        </div>
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {[0, 1, 2, 3, 4, 5, 6].map((row) => (
            <div
              key={row}
              className="flex items-center gap-4 border-b border-eia-border-subtle px-4 py-3 last:border-b-0"
            >
              <EiaSkeleton width={18} height={18} />
              <EiaSkeleton variant="circle" width={36} height={36} />
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <EiaSkeleton variant="text" width="10rem" style={FIT} />
                <EiaSkeleton variant="text" width="7rem" style={FIT} />
              </div>
              <div className="hidden md:block">
                <EiaSkeleton width={72} height={24} style={PILL} />
              </div>
              <div className="hidden lg:block">
                <EiaSkeleton variant="text" width="6rem" />
              </div>
            </div>
          ))}
        </div>
        <div className="flex justify-center gap-2 border-t border-eia-border-subtle p-4">
          {[0, 1, 2, 3, 4].map((page) => (
            <EiaSkeleton key={page} width={36} height={36} />
          ))}
        </div>
      </EiaPanel>
    </Page>
  )
}
