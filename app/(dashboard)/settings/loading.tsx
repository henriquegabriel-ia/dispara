import { EiaPanel, EiaSkeleton } from '@/components/eia'
import { Page, PageHeader } from '@/components/app/page'

/**
 * Carregamento de /settings: seções de formulário à esquerda e o painel de
 * uso à direita (empilha abaixo de xl). Também cobre as subrotas
 * (/settings/ai, /attendants, /performance…), por isso o título fica em
 * esqueleto.
 * Sem aria-busy no contêiner: o EiaSkeleton com `label` já é a região de
 * status (role="status") e um ancestral ocupado silenciaria o anúncio.
 */

const FIT = { maxWidth: '100%' } as const
const CONTROL = { borderRadius: 'var(--eia-radius-control)' } as const

export default function SettingsLoading() {
  return (
    <Page>
      <PageHeader>
        <div className="flex min-w-0 flex-col gap-3">
          <EiaSkeleton variant="text" label="Carregando configurações…" width="13rem" height={32} style={FIT} />
          <EiaSkeleton variant="text" width="24rem" style={FIT} />
        </div>
      </PageHeader>

      <div className="flex flex-col gap-8 xl:flex-row">
        {/* Seções: título, descrição, dois campos e a ação de salvar */}
        <div className="flex min-w-0 flex-1 flex-col gap-6 xl:max-w-3xl">
          {[0, 1, 2].map((section) => (
            <EiaPanel key={section} material="dense" className="flex flex-col gap-6">
              <div className="flex flex-col gap-3">
                <EiaSkeleton variant="text" width="12rem" height={20} style={FIT} />
                <EiaSkeleton variant="text" width="26rem" style={FIT} />
              </div>
              <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                {[0, 1].map((field) => (
                  <div key={field} className="flex flex-col gap-2">
                    <EiaSkeleton variant="text" width="7rem" style={FIT} />
                    <EiaSkeleton height={44} style={CONTROL} />
                  </div>
                ))}
              </div>
              <div className="flex justify-end">
                <EiaSkeleton width="8.5rem" height={44} style={CONTROL} />
              </div>
            </EiaPanel>
          ))}
        </div>

        {/* Painel de uso */}
        <div className="w-full shrink-0 xl:w-80">
          <EiaPanel material="dense" className="flex flex-col gap-5">
            <div className="flex items-center justify-between gap-4">
              <EiaSkeleton variant="text" width="8rem" height={20} style={FIT} />
              <EiaSkeleton width={36} height={36} style={CONTROL} />
            </div>
            {[0, 1, 2].map((meter) => (
              <div key={meter} className="flex flex-col gap-3">
                <div className="flex items-center justify-between gap-4">
                  <EiaSkeleton variant="text" width="7rem" style={FIT} />
                  <EiaSkeleton variant="text" width="3rem" />
                </div>
                <EiaSkeleton height={8} style={{ minHeight: 8, borderRadius: 'var(--eia-radius-pill)' }} />
              </div>
            ))}
          </EiaPanel>
        </div>
      </div>
    </Page>
  )
}
