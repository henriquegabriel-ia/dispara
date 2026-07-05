'use client';

import React from 'react';
import { ArrowRight, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { StepHeader } from './StepHeader';

interface AddWhatsAppStepProps {
  onNext: () => void;
  onBack: () => void;
  stepNumber: number;
  totalSteps: number;
}

export function AddWhatsAppStep({ onNext, onBack, stepNumber, totalSteps }: AddWhatsAppStepProps) {
  return (
    <div className="space-y-6">
      <StepHeader
        stepNumber={stepNumber}
        totalSteps={totalSteps}
        title="Adicionar WhatsApp ao App"
        onBack={onBack}
      />

      {/* Instruções */}
      <div className="space-y-3">
        <div className="flex items-start gap-3 p-3 rounded-lg bg-slate-800/50">
          <span className="w-6 h-6 rounded-full bg-primary-500/20 text-primary-500 flex items-center justify-center text-sm font-medium flex-shrink-0">1</span>
          <p className="text-slate-300">
            No painel do app, vá em <strong className="text-white">"Adicionar Produtos"</strong>
          </p>
        </div>

        <div className="flex items-start gap-3 p-3 rounded-lg bg-slate-800/50">
          <span className="w-6 h-6 rounded-full bg-primary-500/20 text-primary-500 flex items-center justify-center text-sm font-medium flex-shrink-0">2</span>
          <p className="text-slate-300">
            Encontre <strong className="text-white">"WhatsApp"</strong> e clique <strong className="text-white">"Configurar"</strong>
          </p>
        </div>

        <div className="flex items-start gap-3 p-3 rounded-lg bg-slate-800/50">
          <span className="w-6 h-6 rounded-full bg-primary-500/20 text-primary-500 flex items-center justify-center text-sm font-medium flex-shrink-0">3</span>
          <p className="text-slate-300">
            Vá em <strong className="text-white">"API Setup"</strong> no menu lateral
          </p>
        </div>

        <div className="flex items-start gap-3 p-3 rounded-lg bg-slate-800/50">
          <span className="w-6 h-6 rounded-full bg-primary-500/20 text-primary-500 flex items-center justify-center text-sm font-medium flex-shrink-0">4</span>
          <p className="text-slate-300">
            Clique em <strong className="text-white">"Add phone number"</strong>
          </p>
        </div>

        <div className="flex items-start gap-3 p-3 rounded-lg bg-slate-800/50">
          <span className="w-6 h-6 rounded-full bg-primary-500/20 text-primary-500 flex items-center justify-center text-sm font-medium flex-shrink-0">5</span>
          <p className="text-slate-300">
            Siga o processo de verificação do seu número<br />
            <span className="text-slate-500">(você receberá SMS ou ligação com código)</span>
          </p>
        </div>
      </div>

      {/* Aviso importante */}
      <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20">
        <div className="flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-500 mt-0.5 flex-shrink-0" />
          <div>
            <p className="font-medium text-amber-200 mb-1">Se pedir para escolher tipo de número:</p>
            <p className="text-sm text-amber-200/80">
              Selecione <strong>"Add your own phone number"</strong>
              <br />
              <span className="text-amber-200/60">(NÃO selecione "test number" - ele é muito limitado)</span>
            </p>
          </div>
        </div>
      </div>

      {/* Ações */}
      <div className="flex justify-end pt-2">
        <Button onClick={onNext}>
          Número configurado
          <ArrowRight className="w-4 h-4 ml-2" />
        </Button>
      </div>
    </div>
  );
}
