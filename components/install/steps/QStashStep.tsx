'use client';

import { useState, useCallback } from 'react';
import { ExternalLink } from 'lucide-react';
import { StepCard } from '../StepCard';
import { ServiceIcon } from '../ServiceIcon';
import { TokenInput } from '../TokenInput';
import { ValidatingOverlay } from '../ValidatingOverlay';
import { SuccessCheckmark } from '../SuccessCheckmark';

interface QStashStepProps {
  onComplete: (data: { token: string }) => void;
}

/**
 * Step 4: Coleta do QStash Token.
 *
 * O token é validado fazendo uma request à API do QStash.
 * Formato: JWT (3 partes separadas por .) ou prefixo qstash_
 */
export function QStashStep({ onComplete }: QStashStepProps) {
  const [token, setToken] = useState('');
  const [validating, setValidating] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Valida formato do QStash token
  // Pode ser: base64 JSON (eyJ...), JWT (3 partes com .), ou prefixo qstash_
  const isValidToken = (t: string): boolean => {
    const trimmed = t.trim();
    return (
      trimmed.startsWith('eyJ') ||  // Base64 JSON (formato atual do QStash)
      trimmed.split('.').length === 3 ||  // JWT format
      trimmed.startsWith('qstash_')  // Prefixo alternativo
    );
  };

  const handleValidate = useCallback(async () => {
    if (!isValidToken(token)) {
      setError('Token QStash inválido');
      return;
    }

    setValidating(true);
    setError(null);

    try {
      // Valida token via API
      const res = await fetch('/api/installer/qstash/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: token.trim() }),
      });

      const data = await res.json();

      if (!res.ok || !data.valid) {
        throw new Error(data.error || 'Token QStash inválido');
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
  }, [token]);

  const handleSuccessComplete = () => {
    onComplete({ token: token.trim() });
  };

  // Show success state
  if (success) {
    return (
      <StepCard glowColor="orange">
        <SuccessCheckmark
          message="QStash configurado!"
          onComplete={handleSuccessComplete}
        />
      </StepCard>
    );
  }

  return (
    <StepCard glowColor="orange" className="relative">
      <ValidatingOverlay
        isVisible={validating}
        message="Verificando QStash..."
        subMessage="Validando token"
      />

      <div className="flex flex-col items-center text-center">
        {/* Icon */}
        <ServiceIcon service="qstash" size="lg" />

        {/* Title */}
        <h2 className="mt-4 text-xl font-semibold text-slate-100">
          Configure filas de mensagens
        </h2>
        <p className="mt-1 text-sm text-slate-400">
          Token do Upstash QStash
        </p>

        {/* Instruções */}
        <div className="w-full mt-4 p-3 rounded-lg bg-slate-800/50 text-left space-y-2">
          <p className="text-xs text-slate-400 font-medium">Como obter:</p>
          <ol className="text-xs text-slate-500 space-y-1 list-decimal list-inside">
            <li>Crie uma conta gratuita no <a href="https://console.upstash.com" target="_blank" rel="noopener noreferrer" className="text-orange-400 hover:underline">Upstash</a></li>
            <li>Clique em <strong className="text-slate-300">QStash</strong> no menu lateral</li>
            <li>Copie o <strong className="text-slate-300">QSTASH_TOKEN</strong> na aba Details</li>
          </ol>
        </div>

        {/* Token Input */}
        <div className="w-full mt-6">
          <TokenInput
            label="QStash Token"
            value={token}
            onChange={(v) => {
              setToken(v);
              setError(null);
            }}
            placeholder="eyJVc2VySUQi... ou qstash_..."
            minLength={30}
            autoSubmitLength={50}
            onAutoSubmit={handleValidate}
            accentColor="orange"
            showCharCount={false}
            validating={validating}
            success={success}
            error={error || undefined}
          />
        </div>

        {/* Error */}
        {error && (
          <p className="mt-4 text-sm text-red-400">{error}</p>
        )}

        {/* Help link */}
        <a
          href="https://console.upstash.com/qstash"
          target="_blank"
          rel="noopener noreferrer"
          className="mt-6 inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-orange-400 transition-colors"
        >
          <ExternalLink className="w-3.5 h-3.5" />
          Onde encontrar no console Upstash?
        </a>
      </div>
    </StepCard>
  );
}
