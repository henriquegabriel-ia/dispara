import { EiaPanel, EiaSkeleton } from '@/components/eia'
import { Page, PageActions, PageDescription, PageHeader, PageTitle } from '@/components/app/page'

/*
 * Esqueleto do painel inicial no DS Empreende IA V2.
 *
 * Reproduz o layout do DashboardView (métricas → volume de mensagens +
 * campanhas recentes) com EiaSkeleton sobre EiaPanel `dense`: o canvas do app é
 * chapado, então nada de vidro. As classes de grade ficam exportadas daqui e o
 * DashboardView usa as mesmas, para o esqueleto não descolar da tela real.
 *
 * - DashboardSkeletonContent: só o corpo; usado pelo loading.tsx do grupo
 *   (cabeçalho genérico) e pelo próprio DashboardView enquanto carrega.
 * - DashboardSkeleton: cabeçalho real + corpo; fallback do Suspense em
 *   app/(dashboard)/page.tsx.
 */

export const DASHBOARD_TITLE = 'Dashboard'
export const DASHBOARD_DESCRIPTION = 'Acompanhe envios, entregas e campanhas em andamento.'

/** Métricas: 1 coluna → 2 (a primeira ocupa a linha inteira) → 3 em telas largas. */
export const DASHBOARD_METRICS_GRID_CLASS =
  'grid grid-cols-1 gap-(--eia-space-4) sm:grid-cols-2 xl:grid-cols-3'
export const DASHBOARD_FIRST_METRIC_CLASS = 'sm:col-span-2 xl:col-span-1'

/** Volume (2/3) + campanhas recentes (1/3) lado a lado só com largura para a tabela. */
export const DASHBOARD_MAIN_GRID_CLASS = 'grid grid-cols-1 gap-(--eia-space-6) xl:grid-cols-3'
export const DASHBOARD_VOLUME_COLUMN_CLASS = 'flex min-w-0 flex-col gap-(--eia-space-4) xl:col-span-2'
export const DASHBOARD_COLUMN_CLASS = 'flex min-w-0 flex-col gap-(--eia-space-4)'

/** Linha de título de seção: altura de um controle `sm` (seletor/link à direita). */
export const DASHBOARD_SECTION_HEADER_CLASS =
  'flex min-h-(--eia-control-sm) flex-wrap items-center justify-between gap-(--eia-space-3)'
export const DASHBOARD_SECTION_TITLE_CLASS =
  'font-(family-name:--eia-font-display) text-(length:--eia-type-lead) font-(--eia-weight-semibold) leading-(--eia-line-control) tracking-[-0.035em] text-eia-text'

// Larguras fixas encolhem em telas estreitas sem estourar a coluna.
const FIT = { maxWidth: '100%' } as const
const CONTROL = { maxWidth: '100%', borderRadius: 'var(--eia-radius-control)' } as const
const SMALL_CONTROL = { maxWidth: '100%', borderRadius: 'var(--eia-radius-small)' } as const
const PILL = { borderRadius: 'var(--eia-radius-pill)' } as const

const METRIC_SLOTS = ['sent', 'delivery', 'active'] as const
const ROW_SLOTS = [0, 1, 2, 3, 4] as const

export interface DashboardSkeletonContentProps {
  /**
   * Texto anunciado ao leitor de tela (role="status"). Omita quando outro
   * esqueleto da página já anuncia o carregamento.
   */
  label?: string
}

/** Corpo do painel em carregamento, na mesma grade do DashboardView. */
export function DashboardSkeletonContent({ label }: DashboardSkeletonContentProps) {
  return (
    <>
      {/* Métricas (MetricBlock: rótulo, número de 48px, detalhe) */}
      <div className={DASHBOARD_METRICS_GRID_CLASS}>
        {METRIC_SLOTS.map((slot, index) => (
          <EiaPanel
            key={slot}
            material="dense"
            className={`flex flex-col ${index === 0 ? DASHBOARD_FIRST_METRIC_CLASS : ''}`}
          >
            <EiaSkeleton
              variant="text"
              width="9rem"
              label={index === 0 ? label : undefined}
              style={{ ...FIT, marginBlock: 3 }}
            />
            <EiaSkeleton width="7.5rem" height={44} style={{ ...FIT, marginTop: 22, marginBottom: 4 }} />
            <EiaSkeleton variant="text" width="13rem" style={{ ...FIT, marginTop: 13, marginBottom: 3 }} />
          </EiaPanel>
        ))}
      </div>

      <div className={DASHBOARD_MAIN_GRID_CLASS}>
        {/* Volume de mensagens: título + seletor de período, depois o EiaChart */}
        <div className={DASHBOARD_VOLUME_COLUMN_CLASS}>
          <div className={DASHBOARD_SECTION_HEADER_CLASS}>
            <EiaSkeleton variant="text" width="12rem" height={20} style={FIT} />
            <EiaSkeleton width="11rem" height={36} style={CONTROL} />
          </div>
          <EiaPanel material="dense" className="flex flex-1 flex-col gap-3.5">
            <EiaSkeleton variant="text" width="18rem" height={18} style={FIT} />
            <EiaSkeleton style={{ aspectRatio: '600 / 190', height: 'auto' }} />
            <div className="flex justify-between gap-4">
              <EiaSkeleton variant="text" width="5rem" />
              <EiaSkeleton variant="text" width="8rem" />
              <EiaSkeleton variant="text" width="5rem" />
            </div>
            <div className="flex gap-4 border-t border-eia-border-subtle pt-2.5">
              <EiaSkeleton variant="text" width="4rem" />
              <EiaSkeleton variant="text" width="10rem" style={FIT} />
            </div>
            <EiaSkeleton variant="text" width="14rem" style={FIT} />
            <EiaSkeleton height={44} style={CONTROL} />
            <EiaSkeleton variant="text" width="8rem" />
          </EiaPanel>
        </div>

        {/* Campanhas recentes: título + "Ver todas", depois a tabela */}
        <div className={DASHBOARD_COLUMN_CLASS}>
          <div className={DASHBOARD_SECTION_HEADER_CLASS}>
            <EiaSkeleton variant="text" width="11rem" height={20} style={FIT} />
            <EiaSkeleton width="6rem" height={36} style={SMALL_CONTROL} />
          </div>
          <EiaPanel material="dense" noPadding className="flex flex-1 flex-col overflow-hidden">
            <div className="flex h-[45px] items-center justify-between gap-4 border-b border-eia-border-subtle bg-eia-raised px-4">
              <EiaSkeleton variant="text" width="5rem" />
              <EiaSkeleton variant="text" width="3rem" />
            </div>
            {ROW_SLOTS.map((row) => (
              <div
                key={row}
                className="flex items-center justify-between gap-4 border-b border-eia-border-subtle p-4 last:border-b-0"
              >
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  <EiaSkeleton variant="text" width="9rem" style={FIT} />
                  <EiaSkeleton variant="text" width="6rem" style={FIT} />
                </div>
                <EiaSkeleton width={84} height={22} style={PILL} />
              </div>
            ))}
          </EiaPanel>
        </div>
      </div>
    </>
  )
}

/** Fallback do Suspense da página inicial: cabeçalho real + corpo em esqueleto. */
export function DashboardSkeleton() {
  return (
    <Page>
      <PageHeader>
        <div>
          <PageTitle>{DASHBOARD_TITLE}</PageTitle>
          <PageDescription>{DASHBOARD_DESCRIPTION}</PageDescription>
        </div>
        <PageActions>
          <EiaSkeleton width="10.5rem" height={44} style={CONTROL} />
        </PageActions>
      </PageHeader>
      <DashboardSkeletonContent label="Carregando painel…" />
    </Page>
  )
}
