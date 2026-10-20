import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizePhoneNumber } from "@/lib/phone-formatter";
import { persistDelayWait } from "@/lib/builder/workflow-enrollments";

/**
 * Bordas do executor (/execute, /resume, webhook do builder): o que fazer com o
 * resultado de executeWorkflow — persistir a espera durável quando pausou num
 * Aguardar/janela, e deixar workflow_runs com um status coerente.
 */
export type ExecutionShape = {
  success?: boolean;
  paused?: boolean;
  wait?: {
    kind: string;
    reason?: string;
    resumeNodeIds: string[];
    resumeInMs: number;
  };
  variables?: Record<string, unknown>;
  resolvedNodeIds?: string[];
  outputs?: Record<string, unknown>;
  results?: unknown;
  error?: string;
};

export type ExecutionStatus = "waiting" | "success" | "failed";

async function failRun(
  supabase: SupabaseClient,
  executionId: string,
  error: string
): Promise<void> {
  await supabase
    .from("workflow_runs")
    .update({
      status: "failed",
      error,
      finished_at: new Date().toISOString(),
    })
    .eq("id", executionId);
}

export async function settleExecution(
  supabase: SupabaseClient,
  params: {
    workflowId: string;
    versionId: string;
    executionId: string;
    /** telefone do contato (para retomar a espera) */
    phoneRaw: string;
    execution: ExecutionShape;
    fallbackVariables?: Record<string, unknown>;
    logPrefix?: string;
  }
): Promise<ExecutionStatus> {
  const { execution, executionId } = params;
  const prefix = params.logPrefix ?? "[builder]";

  if (execution.paused && execution.wait?.kind === "delay") {
    const phone = normalizePhoneNumber(String(params.phoneRaw || ""));
    if (!phone) {
      // Pausou mas sem telefone pra retomar: seria um buraco silencioso
      // (run 'waiting' pra sempre). Falha visível.
      console.error(`${prefix} Delay pausou sem telefone de retomada — marcando run como failed.`);
      await failRun(supabase, executionId, "Delay sem telefone de retomada");
      return "failed";
    }
    const waitKind = execution.wait.reason === "window" ? "window" : "delay";
    const persisted = await persistDelayWait(supabase, {
      workflowId: params.workflowId,
      versionId: params.versionId,
      phone,
      runId: executionId,
      resumeNodeIds: execution.wait.resumeNodeIds,
      resumeAt: new Date(Date.now() + (execution.wait.resumeInMs || 0)).toISOString(),
      variables: execution.variables ?? params.fallbackVariables ?? {},
      resolvedNodeIds: execution.resolvedNodeIds ?? [],
      outputs: execution.outputs ?? {},
      waitKind,
    });
    if (!persisted) {
      // Sem enrollment o cron nunca retoma: a run não pode ficar "waiting".
      console.error(`${prefix} Falha ao gravar a espera — marcando run como failed.`);
      await failRun(
        supabase,
        executionId,
        "Não foi possível gravar a espera (Aguardar): o contato não seria retomado"
      );
      return "failed";
    }
    // Run em espera (não deixar 'running' órfão — igual ao ask-question).
    await supabase
      .from("workflow_runs")
      .update({
        status: "waiting",
        output: { status: "waiting", waitKind },
        finished_at: null,
      })
      .eq("id", executionId);
    return "waiting";
  }

  if (execution.paused) return "waiting"; // Perguntar: o executor já marcou a run
  return execution.success ? "success" : "failed";
}

/**
 * A continuação (retomada do Aguardar ou resposta do Perguntar) terminou de
 * assumir o fluxo: a run que pausou deixa de ficar "waiting" para sempre.
 */
export async function closeContinuedRun(
  supabase: SupabaseClient,
  runId: string | null | undefined,
  continuedBy: string
): Promise<void> {
  if (!runId || runId === continuedBy) return;
  await supabase
    .from("workflow_runs")
    .update({
      status: "success",
      output: { status: "continued", continuedBy },
      finished_at: new Date().toISOString(),
    })
    .eq("id", runId)
    .eq("status", "waiting");
}

/** Mesma coisa para a run que pausou num "Perguntar" (achada pela conversa). */
export async function closeRunsWaitingOnConversation(
  supabase: SupabaseClient,
  workflowId: string,
  conversationId: string,
  continuedBy: string
): Promise<void> {
  await supabase
    .from("workflow_runs")
    .update({
      status: "success",
      output: { status: "continued", conversationId, continuedBy },
      finished_at: new Date().toISOString(),
    })
    .eq("workflow_id", workflowId)
    .eq("status", "waiting")
    .eq("output->>conversationId", conversationId);
}
