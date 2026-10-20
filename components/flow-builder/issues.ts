"use client";

// Pendências do fluxo exibidas na tela (header, cards e Publicar).
//   - lintFlow: o que faria o fluxo não funcionar depois de publicado (gatilho sem
//     palavra-chave, condição sem valor, variáveis do template vazias…);
//   - compileFlow: o que o compilador recusa (passo vazio, tipo "Em breve"…).
// O autosave continua gravando o rascunho; só o Publicar é bloqueado.

import { useMemo } from "react";
import { compileFlow, FlowCompileError } from "@/lib/builder/flow/compile";
import { lintFlow, type TreeIssue } from "@/lib/builder/flow/tree-validate";
import type { Flow } from "@/lib/builder/flow/types";
import { useFlowBuilderStore } from "./store";

export type FlowIssue = TreeIssue;

export function collectFlowIssues(flow: Flow): FlowIssue[] {
  const issues: FlowIssue[] = lintFlow(flow);
  try {
    compileFlow(flow);
  } catch (error) {
    if (error instanceof FlowCompileError) {
      // O lint já explica o passo (mensagem mais acionável): não duplica.
      const covered = issues.some((i) => i.stepId === error.stepId);
      if (!covered) issues.push({ stepId: error.stepId, message: error.message });
    } else {
      issues.push({
        stepId: null,
        message: "Não foi possível montar o fluxo. Revise os passos e tente de novo.",
      });
    }
  }
  return issues;
}

/** Pendências do fluxo aberto no builder (recalcula a cada mudança da árvore). */
export function useFlowIssues(): FlowIssue[] {
  const flow = useFlowBuilderStore((s) => s.flow);
  return useMemo(() => (flow ? collectFlowIssues(flow) : []), [flow]);
}
