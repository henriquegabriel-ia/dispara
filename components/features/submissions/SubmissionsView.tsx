'use client'

import React from 'react'
import { CircleAlert, Download, Inbox, RotateCw, Search, SearchX } from 'lucide-react'
import {
  EiaAlert,
  EiaButton,
  EiaEmpty,
  EiaField,
  EiaInput,
  EiaLink,
  EiaPanel,
  EiaSkeleton,
  EiaTable,
  EiaTableBody,
  EiaTableCell,
  EiaTableHead,
  EiaTableHeader,
  EiaTableRow,
} from '@/components/eia'
import { EiaPagination } from '@/components/eia/extended'
import { AppLink } from '@/components/app/AppLink'
import { Page, PageActions, PageDescription, PageHeader, PageTitle } from '@/components/app/page'
import { useIsHydrated } from '@/hooks/useIsHydrated'
import { SubmissionsController } from '@/hooks/useSubmissions'
import { FlowSubmission } from '@/services/submissionsService'

interface SubmissionsViewProps {
  controller: SubmissionsController
  title?: string
  description?: string
  campaignId?: string
  flowId?: string
}

/*
 * Formatação pt-BR. Números são determinísticos entre servidor e navegador;
 * datas dependem do fuso, então o SSR e a hidratação usam o fuso de Brasília
 * (mesmo texto nos dois lados) e, depois de hidratar, o fuso do navegador.
 */
const NUMBER_FORMAT = new Intl.NumberFormat('pt-BR')
const DATE_TIME_OPTIONS: Intl.DateTimeFormatOptions = {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
}
const DATE_TIME_SERVER = new Intl.DateTimeFormat('pt-BR', {
  ...DATE_TIME_OPTIONS,
  timeZone: 'America/Sao_Paulo',
})
const DATE_TIME_LOCAL = new Intl.DateTimeFormat('pt-BR', DATE_TIME_OPTIONS)

/*
 * Alinhamento das células: o eia.css (sem @layer) fixa vertical-align: middle
 * em .eia-table-cell e vence utilitários; linhas com várias respostas leem
 * melhor alinhadas ao topo, então o ajuste vai inline.
 */
const CELL_TOP: React.CSSProperties = { verticalAlign: 'top' }

function pluralizeSubmissions(count: number): string {
  return `${NUMBER_FORMAT.format(count)} ${count === 1 ? 'submissão' : 'submissões'}`
}

function formatFieldLabel(key: string): string {
  // Converte snake_case para Title Case
  return key
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

function formatFieldValue(value: unknown): string {
  if (value === null || value === undefined) return '-'
  if (typeof value === 'boolean') return value ? 'Sim' : 'Não'
  if (Array.isArray(value)) return value.join(', ')
  return String(value)
}

function SubmissionDate({ value }: { value: string }) {
  const isHydrated = useIsHydrated()
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return <span className="text-eia-subtle">Data indisponível</span>
  }
  const formatter = isHydrated ? DATE_TIME_LOCAL : DATE_TIME_SERVER
  return (
    <time dateTime={value} className="whitespace-nowrap tabular-nums">
      {formatter.format(date)}
    </time>
  )
}

interface SubmissionRowProps {
  submission: FlowSubmission
  extractFormFields: (s: FlowSubmission) => Record<string, unknown>
  formatPhone: (phone: string) => string
}

function SubmissionRow({ submission, extractFormFields, formatPhone }: SubmissionRowProps) {
  const fieldEntries = Object.entries(extractFormFields(submission))
  const contactName = submission.contact?.name
  const contactEmail = submission.contact?.email
  const campaignName = submission.campaign?.name
  const phone = formatPhone(submission.from_phone)

  return (
    <EiaTableRow>
      <EiaTableCell style={CELL_TOP} className="whitespace-normal">
        <div className="flex min-w-[11rem] max-w-[16rem] flex-col gap-(--eia-space-1)">
          {/* Nome do contato (se disponível) ou telefone */}
          <span className="font-(--eia-weight-semibold) text-eia-text">{contactName || phone}</span>
          {contactName && <span className="whitespace-nowrap text-eia-muted tabular-nums">{phone}</span>}
          {contactEmail && <span className="break-words text-eia-subtle">{contactEmail}</span>}
        </div>
      </EiaTableCell>
      <EiaTableCell style={CELL_TOP} className="whitespace-normal">
        {fieldEntries.length > 0 ? (
          <dl className="grid min-w-[16rem] max-w-[34rem] grid-cols-[minmax(6rem,auto)_1fr] gap-x-(--eia-space-4) gap-y-(--eia-space-1)">
            {fieldEntries.map(([key, value]) => (
              <React.Fragment key={key}>
                <dt className="text-(length:--eia-type-label) text-eia-muted">{formatFieldLabel(key)}</dt>
                <dd className="break-words text-eia-text">{formatFieldValue(value)}</dd>
              </React.Fragment>
            ))}
          </dl>
        ) : (
          <span className="text-eia-subtle">Sem dados do formulário</span>
        )}
      </EiaTableCell>
      <EiaTableCell style={CELL_TOP} className="whitespace-normal">
        {campaignName ? (
          <span className="block min-w-[8rem] text-eia-text">{campaignName}</span>
        ) : (
          <span className="text-eia-subtle">Sem campanha</span>
        )}
      </EiaTableCell>
      <EiaTableCell style={CELL_TOP} className="text-eia-muted">
        <SubmissionDate value={submission.created_at} />
      </EiaTableCell>
    </EiaTableRow>
  )
}

const TABLE_COLUMNS = ['Contato', 'Respostas', 'Campanha', 'Recebida em'] as const

/** Esqueleto com a mesma grade da tabela (sem salto de layout ao carregar). */
function LoadingRows() {
  return (
    <>
      {[0, 1, 2, 3, 4].map((i) => (
        <EiaTableRow key={i}>
          <EiaTableCell style={CELL_TOP}>
            <div className="flex flex-col gap-(--eia-space-2)">
              <EiaSkeleton variant="text" width="9rem" label={i === 0 ? 'Carregando submissões' : undefined} />
              <EiaSkeleton variant="text" width="7rem" />
            </div>
          </EiaTableCell>
          <EiaTableCell style={CELL_TOP}>
            <div className="flex flex-col gap-(--eia-space-2)">
              <EiaSkeleton variant="text" width="16rem" />
              <EiaSkeleton variant="text" width="12rem" />
            </div>
          </EiaTableCell>
          <EiaTableCell style={CELL_TOP}>
            <EiaSkeleton variant="text" width="7rem" />
          </EiaTableCell>
          <EiaTableCell style={CELL_TOP}>
            <EiaSkeleton variant="text" width="9rem" />
          </EiaTableCell>
        </EiaTableRow>
      ))}
    </>
  )
}

export function SubmissionsView({
  controller,
  title = 'Submissões',
  description = 'Respostas dos formulários MiniApp',
  campaignId,
  flowId,
}: SubmissionsViewProps) {
  const {
    submissions,
    total,
    search,
    setSearch,
    page,
    setPage,
    limit,
    totalPages,
    isLoading,
    isError,
    refetch,
    extractFormFields,
    formatPhone,
  } = controller

  const searchId = React.useId()
  const [isRetrying, setIsRetrying] = React.useState(false)

  const isFiltered = Boolean(campaignId || flowId)
  const trimmedSearch = search.trim()

  // Monta URL de exportação com filtros atuais
  const exportUrl = React.useMemo(() => {
    const params = new URLSearchParams()
    if (campaignId) params.set('campaignId', campaignId)
    if (flowId) params.set('flowId', flowId)
    if (search.trim()) params.set('search', search.trim())
    const queryString = params.toString()
    return `/api/submissions/export.csv${queryString ? `?${queryString}` : ''}`
  }, [campaignId, flowId, search])

  // Nova busca (ou limpar a busca) volta à primeira página: senão o offset da
  // página atual se aplica ao filtro e a lista vem vazia com total > 0.
  const changeSearch = (value: string) => {
    setSearch(value)
    setPage(0)
  }

  const retry = () => {
    setIsRetrying(true)
    void refetch().finally(() => setIsRetrying(false))
  }

  const retryButton = (
    <EiaButton
      variant="secondary"
      size="sm"
      loading={isRetrying}
      leadingIcon={<RotateCw size={16} />}
      onClick={retry}
    >
      {isRetrying ? 'Tentando de novo…' : 'Tentar de novo'}
    </EiaButton>
  )

  const hasPagination = !isLoading && totalPages > 1
  const rangeStart = page * limit + 1
  const rangeEnd = Math.min((page + 1) * limit, total)

  // Erro sem nada para mostrar vira estado de erro; com dados em tela, aviso acima da tabela.
  const showErrorState = isError && !isLoading && submissions.length === 0
  const showEmptyState = !isLoading && !isError && submissions.length === 0

  return (
    <Page>
      <PageHeader>
        <div>
          <PageTitle>{title}</PageTitle>
          <PageDescription>{description}</PageDescription>
        </div>
        <PageActions>
          {isFiltered && (
            <AppLink href="/submissions" variant="ghost">
              Ver todas as submissões
            </AppLink>
          )}
          {total > 0 && (
            <EiaLink href={exportUrl} download variant="secondary">
              <span className="eia-button-icon" aria-hidden="true">
                <Download size={16} />
              </span>
              <span className="eia-button-label">Exportar CSV</span>
            </EiaLink>
          )}
        </PageActions>
      </PageHeader>

      {/* Busca (só por telefone, como a API) e total */}
      <div className="flex flex-col gap-(--eia-space-3) sm:flex-row sm:items-center sm:justify-between">
        <EiaField
          label="Buscar por telefone"
          htmlFor={searchId}
          className="dispara-sr-label w-full sm:max-w-sm"
        >
          <EiaInput
            type="search"
            inputMode="tel"
            autoComplete="off"
            placeholder="Buscar por telefone"
            leadingIcon={<Search />}
            value={search}
            onChange={(e) => changeSearch(e.target.value)}
          />
        </EiaField>
        {/* Região viva sempre montada: anuncia o novo total depois de cada busca. */}
        <p role="status" className="text-(length:--eia-type-control) text-eia-muted">
          {isLoading ? 'Carregando…' : showErrorState ? '' : pluralizeSubmissions(total)}
        </p>
      </div>

      {isError && submissions.length > 0 && (
        <EiaAlert tone="warning" title="Não foi possível atualizar a lista" action={retryButton}>
          As submissões abaixo podem estar desatualizadas. Tente de novo em instantes.
        </EiaAlert>
      )}

      {showErrorState ? (
        <EiaPanel material="dense">
          <EiaEmpty
            icon={<CircleAlert />}
            title="Não foi possível carregar as submissões"
            description="Confira sua conexão e tente de novo. Se o problema continuar, recarregue a página."
            action={retryButton}
          />
        </EiaPanel>
      ) : showEmptyState ? (
        <EiaPanel material="dense">
          {trimmedSearch ? (
            <EiaEmpty
              icon={<SearchX />}
              title="Nenhuma submissão com esse telefone"
              description="Confira o número digitado ou limpe a busca para ver todas as respostas."
              action={
                <EiaButton variant="secondary" size="sm" onClick={() => changeSearch('')}>
                  Limpar busca
                </EiaButton>
              }
            />
          ) : (
            <EiaEmpty
              icon={<Inbox />}
              title="Nenhuma submissão ainda"
              description="As respostas aparecem aqui quando os leads preencherem seus formulários MiniApp."
              action={
                <AppLink href="/templates?tab=flows" variant="secondary" size="sm">
                  Ver MiniApps
                </AppLink>
              }
            />
          )}
        </EiaPanel>
      ) : (
        <EiaPanel material="dense" noPadding>
          {/*
           * Rolagem horizontal própria em telas estreitas: a região focável é a
           * que rola (o contêiner interno do EiaTable fica sem overflow), então
           * as setas do teclado funcionam depois de focar a tabela. Ela também
           * recorta o cabeçalho da tabela nos cantos do painel (raio interno =
           * raio do painel menos a borda); o painel fica sem overflow-hidden
           * para não cortar o anel de foco.
           */}
          <div
            role="region"
            tabIndex={0}
            aria-label="Submissões. Role horizontalmente para ver todas as colunas."
            aria-busy={isLoading || undefined}
            className={`overflow-x-auto focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-eia-focus [&>[data-slot=table-container]]:overflow-visible ${
              hasPagination
                ? 'rounded-t-[calc(var(--eia-radius-panel)-1px)]'
                : 'rounded-[calc(var(--eia-radius-panel)-1px)]'
            }`}
          >
            <EiaTable className="min-w-[48rem]" aria-label="Submissões dos formulários MiniApp">
              <EiaTableHeader>
                <EiaTableRow>
                  {TABLE_COLUMNS.map((column) => (
                    <EiaTableHead key={column}>{column}</EiaTableHead>
                  ))}
                </EiaTableRow>
              </EiaTableHeader>
              <EiaTableBody>
                {isLoading ? (
                  <LoadingRows />
                ) : (
                  submissions.map((submission) => (
                    <SubmissionRow
                      key={submission.id}
                      submission={submission}
                      extractFormFields={extractFormFields}
                      formatPhone={formatPhone}
                    />
                  ))
                )}
              </EiaTableBody>
            </EiaTable>
          </div>

          {hasPagination && (
            <div className="flex flex-col gap-(--eia-space-3) px-(--eia-space-4) py-(--eia-space-3) sm:flex-row sm:items-center sm:justify-between">
              <p className="text-(length:--eia-type-label) text-eia-muted tabular-nums">
                Mostrando {NUMBER_FORMAT.format(rangeStart)}–{NUMBER_FORMAT.format(rangeEnd)} de{' '}
                {NUMBER_FORMAT.format(total)}
              </p>
              <EiaPagination
                page={page + 1}
                totalPages={totalPages}
                onPageChange={(next) => setPage(next - 1)}
                label="Paginação das submissões"
              />
            </div>
          )}
        </EiaPanel>
      )}
    </Page>
  )
}
