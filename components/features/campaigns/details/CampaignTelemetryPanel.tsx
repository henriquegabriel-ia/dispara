'use client';

import React from 'react';
import { Container } from '@/components/ui/container';
import { StatusBadge } from '@/components/ui/status-badge';
import { CampaignTelemetryPanelProps } from './types';

export const CampaignTelemetryPanel: React.FC<CampaignTelemetryPanelProps> = ({
  telemetry,
}) => {
  return (
    <Container variant="glass" padding="lg" className="mt-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-white font-bold">Debug - Telemetria de latencia</h3>
          <p className="text-xs text-slate-500">
            Best-effort. Util para entender se o atraso esta no broadcast, no realtime do DB ou no refetch.
          </p>
        </div>
        <StatusBadge status="warning" size="sm">experimental</StatusBadge>
      </div>

      <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Container variant="subtle" padding="sm">
          <div className="text-slate-500 text-xs">Broadcast - UI</div>
          {telemetry.broadcast ? (
            <div className="mt-2 text-xs text-slate-300 space-y-1">
              <div>
                server-client: <span className="font-mono text-slate-200">{Math.round(telemetry.broadcast.serverToClientMs)}ms</span>
              </div>
              <div>
                client-paint: <span className="font-mono text-slate-200">{Math.round(telemetry.broadcast.handlerToPaintMs)}ms</span>
              </div>
              <div>
                total: <span className="font-mono text-slate-200">{Math.round(telemetry.broadcast.serverToPaintMs)}ms</span>
              </div>
              <div className="pt-1 text-[11px] text-slate-500">
                trace: <span className="font-mono">{telemetry.broadcast.traceId || '—'}</span> - seq:{' '}
                <span className="font-mono">{telemetry.broadcast.seq}</span>
              </div>
            </div>
          ) : (
            <div className="mt-2 text-xs text-slate-500">Aguardando evento...</div>
          )}
        </Container>

        <Container variant="subtle" padding="sm">
          <div className="text-slate-500 text-xs">DB realtime - UI</div>
          {telemetry.dbChange ? (
            <div className="mt-2 text-xs text-slate-300 space-y-1">
              <div>
                commit-client: <span className="font-mono text-slate-200">{Math.round(telemetry.dbChange.commitToClientMs)}ms</span>
              </div>
              <div>
                client-paint: <span className="font-mono text-slate-200">{Math.round(telemetry.dbChange.handlerToPaintMs)}ms</span>
              </div>
              <div>
                total: <span className="font-mono text-slate-200">{Math.round(telemetry.dbChange.commitToPaintMs)}ms</span>
              </div>
              <div className="pt-1 text-[11px] text-slate-500">
                {telemetry.dbChange.table} - {telemetry.dbChange.eventType}
              </div>
            </div>
          ) : (
            <div className="mt-2 text-xs text-slate-500">Aguardando mudanca...</div>
          )}
        </Container>

        <Container variant="subtle" padding="sm">
          <div className="text-slate-500 text-xs">Refetch (React Query)</div>
          {telemetry.refetch ? (
            <div className="mt-2 text-xs text-slate-300 space-y-1">
              <div>
                duracao: <span className="font-mono text-slate-200">{Math.round(telemetry.refetch.durationMs ?? 0)}ms</span>
              </div>
              <div className="pt-1 text-[11px] text-slate-500">
                motivo: <span className="font-mono">{telemetry.refetch.reason || '—'}</span>
              </div>
            </div>
          ) : (
            <div className="mt-2 text-xs text-slate-500">Sem refetch recente</div>
          )}
        </Container>
      </div>
    </Container>
  );
};
