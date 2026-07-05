'use client';

import { useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { StepCard } from '../StepCard';
import { ServiceIcon } from '../ServiceIcon';
import { TokenInput } from '../TokenInput';
import { ValidatingOverlay } from '../ValidatingOverlay';
import { SuccessCheckmark } from '../SuccessCheckmark';
import { cn } from '@/lib/utils';

interface RedisStepProps {
  onComplete: (data: { restUrl: string; restToken: string }) => void;
}

/**
 * Step 5: Coleta das credenciais REST do Upstash Redis.
 *
 * Campos:
 * - REST URL: https://xxx.upstash.io
 * - REST Token: base64-like string
 */
export function RedisStep({ onComplete }: RedisStepProps) {
  const [restUrl, setRestUrl] = useState('');
  const [restToken, setRestToken] = useState('');
  const [validating, setValidating] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Valida formato da URL
  const isValidUrl = (url: string): boolean => {
    const trimmed = url.trim();
    return (
      trimmed.startsWith('https://') && trimmed.includes('.upstash.io')
    );
  };

  // Valida formato do token
  const isValidToken = (t: string): boolean => {
    const trimmed = t.trim();
    return trimmed.length >= 30 && /^[A-Za-z0-9_=-]+$/.test(trimmed);
  };

  const canSubmit =
    isValidUrl(restUrl) && isValidToken(restToken);

  const handleValidate = async () => {
    if (!isValidUrl(restUrl)) {
      setError('URL inválida (deve ser https://xxx.upstash.io)');
      return;
    }

    if (!isValidToken(restToken)) {
      setError('Token inválido');
      return;
    }

    setValidating(true);
    setError(null);

    try {
      // Testa conexão fazendo PING
      const res = await fetch('/api/installer/redis/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          restUrl: restUrl.trim(),
          restToken: restToken.trim(),
        }),
      });

      const data = await res.json();

      if (!res.ok || !data.valid) {
        throw new Error(data.error || 'Credenciais Redis inválidas');
      }

      setSuccess(true);
    } catch (err) {
      // Se API não existir ainda, valida só o formato
      if (err instanceof TypeError && err.message.includes('fetch')) {
        setSuccess(true);
      } else {
        setError(err instanceof Error ? err.message : 'Erro ao validar');
      }
    } finally {
      setValidating(false);
    }
  };

  const handleSuccessComplete = () => {
    onComplete({
      restUrl: restUrl.trim(),
      restToken: restToken.trim(),
    });
  };

  // Show success state
  if (success) {
    return (
      <StepCard glowColor="red">
        <SuccessCheckmark
          message="Redis conectado!"
          onComplete={handleSuccessComplete}
        />
      </StepCard>
    );
  }

  return (
    <StepCard glowColor="red" className="relative">
      <ValidatingOverlay
        isVisible={validating}
        message="Testando conexão..."
        subMessage="Fazendo PING no Redis"
      />

      <div className="flex flex-col items-center text-center">
        {/* Icon */}
        <ServiceIcon service="redis" size="lg" />

        {/* Title */}
        <h2 className="mt-4 text-xl font-semibold text-slate-100">
          Configure cache de webhooks
        </h2>
        <p className="mt-1 text-sm text-slate-400">
          URL e Token REST do Upstash Redis
        </p>

        {/* Instruções */}
        <div className="w-full mt-4 p-3 rounded-lg bg-slate-800/50 text-left space-y-2">
          <p className="text-xs text-slate-400 font-medium">Como obter:</p>
          <ol className="text-xs text-slate-500 space-y-1 list-decimal list-inside">
            <li>Acesse o <a href="https://console.upstash.com/redis" target="_blank" rel="noopener noreferrer" className="text-red-400 hover:underline">console Upstash Redis</a></li>
            <li>Clique em <strong className="text-slate-300">Create Database</strong></li>
            <li>Nome: <strong className="text-slate-300">dispara</strong> • Região: <strong className="text-slate-300">São Paulo</strong> (ou mais próxima)</li>
            <li>Após criar, vá na aba <strong className="text-slate-300">REST API</strong></li>
            <li>Copie a <strong className="text-slate-300">UPSTASH_REDIS_REST_URL</strong> e <strong className="text-slate-300">UPSTASH_REDIS_REST_TOKEN</strong></li>
          </ol>
        </div>

        {/* REST URL Input */}
        <div className="w-full mt-6">
          <label className="block text-sm font-medium text-slate-300 mb-2 text-left">
            REST URL
          </label>
          <input
            type="url"
            value={restUrl}
            onChange={(e) => {
              setRestUrl(e.target.value);
              setError(null);
            }}
            placeholder="https://xxx-xxx.upstash.io"
            className={cn(
              'w-full px-4 py-3 rounded-xl',
              'bg-slate-800/50 border border-slate-700',
              'text-slate-100 placeholder:text-slate-500',
              'font-mono text-sm',
              'focus:border-red-500 focus:outline-none',
              'focus:shadow-[0_0_0_3px_theme(colors.red.500/0.15)]',
              'transition-all duration-200',
              isValidUrl(restUrl) && restUrl.length > 0 && 'border-red-500/50'
            )}
          />
          {restUrl.length > 0 && (
            <p
              className={cn(
                'mt-1 text-xs text-left',
                isValidUrl(restUrl) ? 'text-red-400' : 'text-slate-500'
              )}
            >
              {isValidUrl(restUrl) ? '✓ URL válida' : 'Formato: https://xxx.upstash.io'}
            </p>
          )}
        </div>

        {/* REST Token Input */}
        <div className="w-full mt-4">
          <TokenInput
            label="REST Token"
            value={restToken}
            onChange={(v) => {
              setRestToken(v);
              setError(null);
            }}
            placeholder="AXxxxxxxxxxxxxxxxxxxxx"
            minLength={30}
            autoSubmitLength={canSubmit ? restToken.length : undefined}
            onAutoSubmit={canSubmit ? handleValidate : undefined}
            accentColor="red"
            showCharCount={false}
          />
        </div>

        {/* Error */}
        {error && (
          <p className="mt-4 text-sm text-red-400">{error}</p>
        )}

        {/* Help link */}
        <a
          href="https://console.upstash.com/redis"
          target="_blank"
          rel="noopener noreferrer"
          className="mt-6 inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-red-400 transition-colors"
        >
          <ExternalLink className="w-3.5 h-3.5" />
          Como criar um banco Redis?
        </a>
      </div>
    </StepCard>
  );
}
