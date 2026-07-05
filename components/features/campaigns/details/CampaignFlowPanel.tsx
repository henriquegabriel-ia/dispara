'use client';

import React, { useEffect, useState } from 'react';
import { FormInput, ArrowUpRight, Users, Percent } from 'lucide-react';
import { PrefetchLink } from '@/components/ui/PrefetchLink';
import { getSupabaseBrowser } from '@/lib/supabase';
import type { Campaign } from '@/types';

interface CampaignFlowPanelProps {
  campaign: Campaign;
}

/**
 * Painel de métricas do Flow/MiniApp
 * Exibe informações sobre submissões de formulário quando a campanha usa um Flow
 * Com Realtime para atualização automática do contador
 */
export const CampaignFlowPanel: React.FC<CampaignFlowPanelProps> = ({ campaign }) => {
  const [submissionsCount, setSubmissionsCount] = useState(campaign.submissionsCount ?? 0);
  const [isLive, setIsLive] = useState(false);

  // Só exibe se a campanha tem Flow
  if (!campaign.flowId) return null;

  const recipients = campaign.recipients ?? 0;

  // Calcula taxa de conversão (submissões / destinatários)
  const conversionRate = recipients > 0
    ? ((submissionsCount / recipients) * 100).toFixed(1)
    : '0.0';

  // Realtime subscription para novas submissões
  useEffect(() => {
    const supabaseClient = getSupabaseBrowser();
    if (!supabaseClient) return;

    const channel = supabaseClient
      .channel(`flow_submissions:campaign:${campaign.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'flow_submissions',
          filter: `campaign_id=eq.${campaign.id}`,
        },
        () => {
          setSubmissionsCount((prev) => prev + 1);
        }
      )
      .subscribe((status) => {
        setIsLive(status === 'SUBSCRIBED');
      });

    return () => {
      supabaseClient.removeChannel(channel);
    };
  }, [campaign.id]);

  // Sync com prop quando mudar
  useEffect(() => {
    if (typeof campaign.submissionsCount === 'number') {
      setSubmissionsCount(campaign.submissionsCount);
    }
  }, [campaign.submissionsCount]);

  return (
    <div className="bg-[var(--ds-bg-elevated)] border border-[var(--ds-border-subtle)] rounded-xl p-6 mt-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-primary-500/20 flex items-center justify-center">
            <FormInput size={20} className="text-primary-400" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-white">MiniApp / Flow</h3>
              {isLive && (
                <span className="inline-flex items-center gap-1.5 text-xs text-primary-400">
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-primary-500" />
                  Ao vivo
                </span>
              )}
            </div>
            <p className="text-sm text-slate-400">{campaign.flowName || 'Formulário interativo'}</p>
          </div>
        </div>

        <PrefetchLink
          href={`/submissions?campaignId=${encodeURIComponent(campaign.id)}`}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-primary-600 hover:bg-primary-500 text-white rounded-lg transition-colors"
        >
          Ver Submissões <ArrowUpRight size={14} />
        </PrefetchLink>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {/* Submissões */}
        <div className="bg-slate-800/50 border border-[var(--ds-border-subtle)] rounded-lg p-4">
          <div className="flex items-center gap-2 text-slate-400 text-xs uppercase tracking-wide mb-2">
            <Users size={14} />
            Respostas
          </div>
          <div className="text-2xl font-bold text-white">
            {submissionsCount.toLocaleString('pt-BR')}
          </div>
          <p className="text-xs text-slate-500 mt-1">
            {submissionsCount === 1 ? 'pessoa respondeu' : 'pessoas responderam'}
          </p>
        </div>

        {/* Taxa de Conversão */}
        <div className="bg-slate-800/50 border border-[var(--ds-border-subtle)] rounded-lg p-4">
          <div className="flex items-center gap-2 text-slate-400 text-xs uppercase tracking-wide mb-2">
            <Percent size={14} />
            Taxa de Resposta
          </div>
          <div className="text-2xl font-bold text-white">
            {conversionRate}%
          </div>
          <p className="text-xs text-slate-500 mt-1">
            de {recipients.toLocaleString('pt-BR')} destinatários
          </p>
        </div>
      </div>

      {/* Dica quando não há submissões */}
      {submissionsCount === 0 && (
        <p className="text-xs text-slate-500 mt-4 text-center">
          Aguardando respostas do formulário...
        </p>
      )}
    </div>
  );
};
