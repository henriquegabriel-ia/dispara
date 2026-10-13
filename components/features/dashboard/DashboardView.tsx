'use client';

import * as React from 'react';
import Link from 'next/link';
import { ArrowRight, ChartArea, CircleAlert, Plus, RotateCw, Send } from 'lucide-react';

import {
  EiaAlert,
  EiaButton,
  EiaEmpty,
  EiaPanel,
  EiaSelect,
  EiaTable,
  EiaTableBody,
  EiaTableCell,
  EiaTableHead,
  EiaTableHeader,
  EiaTableRow,
  type EiaButtonSize,
} from '@/components/eia';
import { MetricBlock } from '@/components/eia/blocks';
import { EiaChart, type EiaChartSeries } from '@/components/eia/composites';
import { AppLink } from '@/components/app/AppLink';
import { Page, PageActions, PageDescription, PageHeader, PageTitle } from '@/components/app/page';
import { StatusBadge, type StatusBadgeStatus } from '@/components/app/status-badge';
import {
  DASHBOARD_COLUMN_CLASS,
  DASHBOARD_DESCRIPTION,
  DASHBOARD_FIRST_METRIC_CLASS,
  DASHBOARD_MAIN_GRID_CLASS,
  DASHBOARD_METRICS_GRID_CLASS,
  DASHBOARD_SECTION_HEADER_CLASS,
  DASHBOARD_SECTION_TITLE_CLASS,
  DASHBOARD_TITLE,
  DASHBOARD_VOLUME_COLUMN_CLASS,
  DashboardSkeletonContent,
} from '@/components/features/dashboard/DashboardSkeleton';
import { useIsHydrated } from '@/hooks/useIsHydrated';
import type { ChartDataPoint, DashboardStats } from '@/services/dashboardService';
import { CampaignStatus, type Campaign } from '@/types';

/*
 * Painel inicial no DS Empreende IA V2.
 *
 * Tela de produto: calma, material `dense` (sólido, o canvas é chapado),
 * esmeralda só na ação principal e nos dados do gráfico. Métricas em
 * MetricBlock (número tabular), volume diário em EiaChart (SVG do DS, eixo em
 * zero, tabela alternativa embutida) e campanhas recentes em EiaTable.
 * Números e datas sempre formatados com Intl em pt-BR.
 */

export interface DashboardViewProps {
  stats: DashboardStats;
  recentCampaigns: Campaign[];
  isLoading: boolean;
  /** A última busca (métricas ou campanhas recentes) falhou. */
  isError?: boolean;
  /** Há dados para mostrar (do servidor ou de uma busca anterior). */
  hasData?: boolean;
  /** Nova busca em andamento depois de uma falha. */
  isRetrying?: boolean;
  /** Busca os dados de novo. */
  onRetry?: () => void;
}

// --- Formatação pt-BR ---------------------------------------------------------

const COUNT_FORMAT = new Intl.NumberFormat('pt-BR');
const PERCENT_FORMAT = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });
/*
 * Data de criação das campanhas: o painel é renderizado no servidor (fuso UTC
 * na Vercel/Docker). O SSR e a hidratação usam o fuso de Brasília (mesmo texto
 * nos dois lados) e, depois de hidratar, o fuso do navegador.
 */
const DATE_OPTIONS: Intl.DateTimeFormatOptions = {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
};
const DATE_FORMAT_SERVER = new Intl.DateTimeFormat('pt-BR', {
  ...DATE_OPTIONS,
  timeZone: 'America/Sao_Paulo',
});
const DATE_FORMAT_LOCAL = new Intl.DateTimeFormat('pt-BR', DATE_OPTIONS);
// UTC nos dois lados: o rótulo do gráfico não depende do fuso de quem renderiza.
const DAY_LABEL_FORMAT = new Intl.DateTimeFormat('pt-BR', {
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
});

/**
 * Os totais chegam como texto: o serviço do cliente formata no idioma do
 * navegador e a server action em pt-BR. São inteiros, então basta tirar os
 * separadores para o mesmo número aparecer igual nos dois caminhos.
 */
function parseCount(value: string): number | null {
  const digits = value.replace(/\D/g, '');
  return digits ? Number(digits) : null;
}

function formatCount(value: string): string {
  const count = parseCount(value);
  return count === null ? value : COUNT_FORMAT.format(count);
}

/** "97%" → { value: "97", unit: "%" } (o MetricBlock desenha a unidade menor). */
function splitPercent(value: string): { value: string; unit?: string } {
  const rate = Number.parseFloat(value.replace(',', '.'));
  return Number.isFinite(rate) ? { value: PERCENT_FORMAT.format(rate), unit: '%' } : { value };
}

function describeFailures(value: string): string {
  const count = parseCount(value) ?? 0;
  if (count === 0) return 'nenhuma falha de envio';
  return `${COUNT_FORMAT.format(count)} ${count === 1 ? 'falha' : 'falhas'} de envio`;
}

/** "06/10" → "6 de out.". O ano fixo (bissexto) só valida o dia; ele não aparece. */
function formatDayLabel(name: string): string {
  const match = /^(\d{1,2})\/(\d{1,2})$/.exec(name);
  if (!match) return name;
  const date = new Date(Date.UTC(2000, Number(match[2]) - 1, Number(match[1])));
  return Number.isNaN(date.getTime()) ? name : DAY_LABEL_FORMAT.format(date);
}

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** "Criada em 6 de out. de 2026", sem divergência entre servidor e navegador. */
function CreatedAt({ date }: { date: Date }) {
  const isHydrated = useIsHydrated();
  const formatter = isHydrated ? DATE_FORMAT_LOCAL : DATE_FORMAT_SERVER;
  return <time dateTime={date.toISOString()}>Criada em {formatter.format(date)}</time>;
}

// --- Status de campanha -----------------------------------------------------

const CAMPAIGN_BADGE_STATUS: Record<CampaignStatus, StatusBadgeStatus> = {
  [CampaignStatus.COMPLETED]: 'completed',
  [CampaignStatus.SENDING]: 'sending',
  [CampaignStatus.FAILED]: 'failed',
  [CampaignStatus.DRAFT]: 'draft',
  [CampaignStatus.PAUSED]: 'paused',
  [CampaignStatus.SCHEDULED]: 'scheduled',
  [CampaignStatus.CANCELLED]: 'default',
};

const CAMPAIGN_STATUS_LABEL: Record<CampaignStatus, string> = {
  [CampaignStatus.COMPLETED]: 'Concluída',
  [CampaignStatus.SENDING]: 'Enviando',
  [CampaignStatus.FAILED]: 'Falhou',
  [CampaignStatus.DRAFT]: 'Rascunho',
  [CampaignStatus.PAUSED]: 'Pausada',
  [CampaignStatus.SCHEDULED]: 'Agendada',
  [CampaignStatus.CANCELLED]: 'Cancelada',
};

// --- Período do gráfico -------------------------------------------------------

const CHART_RANGES = ['7', '15', '30'] as const;
type ChartRange = (typeof CHART_RANGES)[number];

const CHART_RANGE_LABEL: Record<ChartRange, string> = {
  '7': 'últimos 7 dias',
  '15': 'últimos 15 dias',
  '30': 'últimos 30 dias',
};

const CHART_RANGE_OPTIONS = CHART_RANGES.map((range) => ({
  value: range,
  label: `Últimos ${range} dias`,
}));

const CHART_SERIES: EiaChartSeries[] = [{ key: 'sent', label: 'Enviadas' }];

function isChartRange(value: string): value is ChartRange {
  return (CHART_RANGES as readonly string[]).includes(value);
}

// --- Peças ------------------------------------------------------------------

interface RetryButtonProps {
  onRetry: () => void;
  isRetrying: boolean;
  size?: EiaButtonSize;
}

function RetryButton({ onRetry, isRetrying, size = 'md' }: RetryButtonProps) {
  return (
    <EiaButton
      variant="secondary"
      size={size}
      loading={isRetrying}
      focusableWhenDisabled
      leadingIcon={<RotateCw size={16} />}
      onClick={onRetry}
    >
      {isRetrying ? 'Tentando de novo…' : 'Tentar de novo'}
    </EiaButton>
  );
}

function DashboardMetrics({ stats }: { stats: DashboardStats }) {
  const titleId = React.useId();
  // `sent24h` é o total enviado de todas as campanhas (nome histórico do
  // contrato: o serviço e a server action somam tudo, não só 24h).
  // Sem envios a taxa não existe: "0%" pareceria falha de entrega.
  const hasSends = (parseCount(stats.sent24h) ?? 0) > 0;
  const deliveryRate: { value: React.ReactNode; unit?: string } = hasSends
    ? splitPercent(stats.deliveryRate)
    : {
        value: (
          <>
            <span aria-hidden="true">—</span>
            <span className="sr-only">Sem dados</span>
          </>
        ),
      };
  const deliveryDescription = hasSends
    ? `Entregues sobre enviadas · ${describeFailures(stats.failedMessages)}`
    : 'Aparece depois do primeiro envio';

  return (
    <section aria-labelledby={titleId}>
      <h2 id={titleId} className="sr-only">
        Resumo dos envios
      </h2>
      <div className={DASHBOARD_METRICS_GRID_CLASS}>
        <MetricBlock
          label="Mensagens enviadas"
          value={formatCount(stats.sent24h)}
          description="Total de todas as campanhas"
          className={`[overflow-wrap:anywhere] ${DASHBOARD_FIRST_METRIC_CLASS}`}
        />
        <MetricBlock
          label="Taxa de entrega"
          value={deliveryRate.value}
          unit={deliveryRate.unit}
          description={deliveryDescription}
          className="[overflow-wrap:anywhere]"
        />
        <MetricBlock
          label="Campanhas ativas"
          value={formatCount(stats.activeCampaigns)}
          description="Enviando ou agendadas agora"
          className="[overflow-wrap:anywhere]"
        />
      </div>
    </section>
  );
}

interface DashboardVolumeProps {
  chartData: ChartDataPoint[];
  range: ChartRange;
  onRangeChange: (range: ChartRange) => void;
}

function DashboardVolume({ chartData, range, onRangeChange }: DashboardVolumeProps) {
  const titleId = React.useId();
  const rangeLabel = CHART_RANGE_LABEL[range];
  const points = chartData.slice(-Number(range)).map((point) => ({
    label: formatDayLabel(point.name),
    sent: point.sent,
  }));
  const hasSends = points.some((point) => point.sent > 0);

  return (
    <section aria-labelledby={titleId} className={DASHBOARD_VOLUME_COLUMN_CLASS}>
      <div className={DASHBOARD_SECTION_HEADER_CLASS}>
        <h2 id={titleId} className={DASHBOARD_SECTION_TITLE_CLASS}>
          Volume de mensagens
        </h2>
        {/* O valor do seletor ("Últimos 7 dias") já se explica: rótulo só para leitor de tela. */}
        <div className="dispara-sr-label">
          <EiaSelect
            label="Período do gráfico"
            size="sm"
            className="w-44"
            value={range}
            onValueChange={(next) => {
              if (isChartRange(next)) onRangeChange(next);
            }}
            options={CHART_RANGE_OPTIONS}
          />
        </div>
      </div>

      {hasSends ? (
        // key: cada período começa a leitura do gráfico no primeiro dia.
        <EiaChart
          key={range}
          title={`Mensagens enviadas por dia, ${rangeLabel}`}
          type="area"
          unit="mensagens"
          data={points}
          series={CHART_SERIES}
        />
      ) : (
        <EiaPanel material="dense" className="flex flex-1 flex-col justify-center">
          <EiaEmpty
            icon={<ChartArea />}
            title={`Nenhuma mensagem enviada nos ${rangeLabel}`}
            description="Os envios aparecem aqui, dia a dia."
            action={
              range === '30' ? (
                <AppLink
                  href="/campaigns/new"
                  variant="secondary"
                  size="sm"
                  leadingIcon={<Plus size={16} />}
                >
                  Criar campanha
                </AppLink>
              ) : (
                <EiaButton variant="secondary" size="sm" onClick={() => onRangeChange('30')}>
                  Ver últimos 30 dias
                </EiaButton>
              )
            }
          />
        </EiaPanel>
      )}
    </section>
  );
}

interface DashboardRecentCampaignsProps {
  campaigns: Campaign[];
  /** A última busca falhou: a lista vazia não quer dizer que não há campanhas. */
  isError: boolean;
}

function DashboardRecentCampaigns({ campaigns, isError }: DashboardRecentCampaignsProps) {
  const titleId = React.useId();
  const isEmpty = campaigns.length === 0;

  return (
    <section aria-labelledby={titleId} className={DASHBOARD_COLUMN_CLASS}>
      <div className={DASHBOARD_SECTION_HEADER_CLASS}>
        <h2 id={titleId} className={DASHBOARD_SECTION_TITLE_CLASS}>
          Campanhas recentes
        </h2>
        {!isEmpty && (
          <AppLink
            href="/campaigns"
            variant="ghost"
            size="sm"
            trailingIcon={<ArrowRight size={16} />}
          >
            Ver todas<span className="sr-only"> as campanhas</span>
          </AppLink>
        )}
      </div>

      <EiaPanel material="dense" noPadding className="flex flex-1 flex-col overflow-hidden">
        {isEmpty && isError ? (
          <EiaEmpty
            className="my-auto"
            icon={<CircleAlert />}
            title="Não foi possível carregar as campanhas"
            // Este estado só aparece junto do aviso de erro do topo, que tem o botão.
            description="Use “Tentar de novo” no aviso acima."
          />
        ) : isEmpty ? (
          <EiaEmpty
            className="my-auto"
            icon={<Send />}
            title="Nenhuma campanha ainda"
            description="Crie a primeira campanha para acompanhar os envios aqui."
            action={
              <AppLink
                href="/campaigns/new"
                variant="secondary"
                size="sm"
                leadingIcon={<Plus size={16} />}
              >
                Criar campanha
              </AppLink>
            }
          />
        ) : (
          <EiaTable aria-labelledby={titleId}>
            <EiaTableHeader>
              <EiaTableRow>
                <EiaTableHead>Campanha</EiaTableHead>
                {/* .eia-table-head fixa text-align fora de @layer: alinhamento via style. */}
                <EiaTableHead style={{ textAlign: 'right' }}>Status</EiaTableHead>
              </EiaTableRow>
            </EiaTableHeader>
            <EiaTableBody>
              {campaigns.map((campaign) => {
                const createdAt = parseDate(campaign.createdAt);
                return (
                  <EiaTableRow key={campaign.id}>
                    <EiaTableCell className="whitespace-normal">
                      <Link
                        href={`/campaigns/${campaign.id}`}
                        className="rounded-eia-small font-(--eia-weight-medium) text-eia-text [overflow-wrap:anywhere] underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-eia-focus"
                      >
                        {campaign.name}
                      </Link>
                      <span className="mt-(--eia-space-1) block text-(length:--eia-type-caption) text-eia-subtle">
                        {createdAt ? (
                          <CreatedAt date={createdAt} />
                        ) : (
                          'Sem data de criação'
                        )}
                      </span>
                    </EiaTableCell>
                    <EiaTableCell style={{ textAlign: 'right' }}>
                      <StatusBadge status={CAMPAIGN_BADGE_STATUS[campaign.status] ?? 'default'} size="sm" showDot>
                        {CAMPAIGN_STATUS_LABEL[campaign.status] ?? campaign.status}
                      </StatusBadge>
                    </EiaTableCell>
                  </EiaTableRow>
                );
              })}
            </EiaTableBody>
          </EiaTable>
        )}
      </EiaPanel>
    </section>
  );
}

// --- Tela ---------------------------------------------------------------------

export function DashboardView({
  stats,
  recentCampaigns,
  isLoading,
  isError = false,
  hasData = true,
  isRetrying = false,
  onRetry,
}: DashboardViewProps) {
  const [range, setRange] = React.useState<ChartRange>('7');
  // Sem nada para mostrar: um único estado de erro no lugar do painel.
  const loadFailed = isError && !hasData && !isLoading;

  return (
    <Page>
      <PageHeader>
        <div>
          <PageTitle>{DASHBOARD_TITLE}</PageTitle>
          <PageDescription>{DASHBOARD_DESCRIPTION}</PageDescription>
        </div>
        <PageActions>
          <AppLink href="/campaigns/new" leadingIcon={<Plus size={16} />}>
            Criar campanha
          </AppLink>
        </PageActions>
      </PageHeader>

      {isLoading ? (
        <DashboardSkeletonContent label="Carregando dados do painel…" />
      ) : loadFailed ? (
        <EiaPanel material="dense">
          <EiaEmpty
            icon={<CircleAlert />}
            title="Não foi possível carregar o painel"
            description="Verifique a conexão e tente de novo."
            action={onRetry && <RetryButton onRetry={onRetry} isRetrying={isRetrying} />}
          />
        </EiaPanel>
      ) : (
        <>
          {isError && (
            <EiaAlert
              tone="warning"
              size="compact"
              title="Não foi possível atualizar o painel"
              action={
                onRetry && <RetryButton size="sm" onRetry={onRetry} isRetrying={isRetrying} />
              }
            >
              Os números abaixo podem estar desatualizados. Verifique a conexão e tente de novo.
            </EiaAlert>
          )}

          <DashboardMetrics stats={stats} />

          <div className={DASHBOARD_MAIN_GRID_CLASS}>
            <DashboardVolume chartData={stats.chartData ?? []} range={range} onRangeChange={setRange} />
            <DashboardRecentCampaigns campaigns={recentCampaigns} isError={isError} />
          </div>
        </>
      )}
    </Page>
  );
}
