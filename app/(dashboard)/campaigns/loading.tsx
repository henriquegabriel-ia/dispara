import { EiaPanel, EiaSkeleton } from '@/components/eia'
import { Page, PageHeader } from '@/components/app/page'

/**
 * Carregamento de /campaigns: cabeçalho, barra de filtros e tabela.
 * Também cobre /campaigns/new e /campaigns/[id] (sem loading.tsx próprio),
 * por isso o título fica em esqueleto. No celular a lista vira cartões:
 * as colunas do meio somem e sobram nome + status.
 * Sem aria-busy no contêiner: o EiaSkeleton com `label` já é a região de
 * status (role="status") e um ancestral ocupado silenciaria o anúncio.
 */

const FIT = { maxWidth: '100%' } as const
const CONTROL = { borderRadius: 'var(--eia-radius-control)' } as const
const PILL = { borderRadius: 'var(--eia-radius-pill)' } as const

// Nome (2fr), Status, Destinatários, Entrega, Envio, Criado em, Ações.
// Sem `grid` aqui: o cabeçalho usa `hidden md:grid` e as linhas, `grid`.
const ROW_COLUMNS =
  'grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-6 md:grid-cols-[minmax(0,2fr)_repeat(5,minmax(0,1fr))_6.5rem]'
const MIDDLE_COLUMNS = ['4rem', '6rem', '3.5rem', '5rem'] as const

export default function CampaignsLoading() {
  return (
    <Page>
      <PageHeader>
        <div className="flex min-w-0 flex-col gap-3">
          <EiaSkeleton variant="text" label="Carregando campanhas…" width="12rem" height={32} style={FIT} />
          <EiaSkeleton variant="text" width="22rem" style={FIT} />
        </div>
      </PageHeader>

      {/* Busca + atualizar, status, pasta e tags */}
      <EiaPanel
        material="dense"
        className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"
      >
        <div className="w-full sm:w-96">
          <EiaSkeleton height={44} style={PILL} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <EiaSkeleton width={44} height={44} style={CONTROL} />
          <EiaSkeleton width="9rem" height={44} style={CONTROL} />
          <EiaSkeleton width="8rem" height={44} style={CONTROL} />
          <EiaSkeleton width="7rem" height={44} style={CONTROL} />
        </div>
      </EiaPanel>

      {/* Tabela de campanhas */}
      <EiaPanel material="dense" noPadding className="overflow-hidden">
        <div className={`hidden md:grid ${ROW_COLUMNS} border-b border-eia-border-subtle py-4`}>
          <EiaSkeleton variant="text" width="3rem" />
          {MIDDLE_COLUMNS.map((_, column) => (
            <EiaSkeleton key={column} variant="text" width="4.5rem" style={FIT} />
          ))}
          <EiaSkeleton variant="text" width="4rem" style={FIT} />
          <EiaSkeleton variant="text" width="3rem" className="justify-self-end" />
        </div>
        {[0, 1, 2, 3, 4, 5].map((row) => (
          <div key={row} className={`grid ${ROW_COLUMNS} border-b border-eia-border-subtle py-5 last:border-b-0`}>
            <div className="flex min-w-0 flex-col gap-2">
              <EiaSkeleton variant="text" width="11rem" style={FIT} />
              <EiaSkeleton variant="text" width="6rem" style={FIT} />
            </div>
            <EiaSkeleton width={84} height={24} style={PILL} />
            {MIDDLE_COLUMNS.map((width, column) => (
              <div key={column} className="hidden md:block">
                <EiaSkeleton variant="text" width={width} style={FIT} />
              </div>
            ))}
            <div className="hidden justify-end gap-1 md:flex">
              {[0, 1, 2].map((action) => (
                <EiaSkeleton key={action} width={30} height={30} />
              ))}
            </div>
          </div>
        ))}
      </EiaPanel>
    </Page>
  )
}
