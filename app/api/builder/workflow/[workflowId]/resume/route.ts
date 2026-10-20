import { NextRequest, NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { getSupabaseAdmin } from "@/lib/supabase";
import { fetchPublishedRecord, toSavedWorkflow } from "@/lib/builder/workflow-db";
import { executeWorkflow } from "@/lib/builder/workflow-executor.workflow";
import { validateWorkflowSchema } from "@/lib/shared/workflow-schema";
import {
  claimConversation,
  completeConversation,
} from "@/lib/builder/workflow-conversations";
import { verifyCronRequest, cronUnauthorizedResponse } from "@/lib/cron-auth";
import { askButtonsForResumeNode, canonicalAskAnswer } from "@/lib/builder/ask-reply";
import {
  closeRunsWaitingOnConversation,
  settleExecution,
  type ExecutionShape,
} from "@/lib/builder/workflow-run-outcome";

/**
 * Retoma um workflow pausado por Ask Question quando o usuário responde.
 *
 * Migração QStash→pg_cron (Fase D): antes era serve() do @upstash/workflow. Agora é um
 * POST autenticado chamado pelo webhook. Se o fluxo retomado cair num Delay, ele pausa
 * de novo e persistimos o enrollment (resume_at) aqui também.
 *
 * Concorrência: a conversa é "claimada" (CAS waiting → processing) ANTES de executar —
 * duas respostas quase simultâneas retomam a pergunta uma vez só.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type ResumeWorkflowInput = {
  conversationId?: string;
  input?: {
    from?: string;
    to?: string;
    message?: string;
    /** id do botão/item clicado (interactive.button_reply.id / list_reply.id) */
    replyId?: string;
  };
};

const failed = (error: string) =>
  NextResponse.json({ executionId: nanoid(), status: "failed", error });

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ workflowId: string }> }
) {
  const auth = verifyCronRequest(request);
  if (!auth.valid) return cronUnauthorizedResponse(auth.error);

  const { workflowId } = await params;
  const payload = (await request
    .json()
    .catch(() => ({}))) as ResumeWorkflowInput;
  const { conversationId, input } = payload;

  if (!workflowId || !conversationId) {
    return failed("Missing workflowId or conversationId");
  }

  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return failed("Supabase not configured");
  }

  const { data: conversation } = await supabase
    .from("workflow_conversations")
    .select("*")
    .eq("id", conversationId)
    .eq("status", "waiting")
    .maybeSingle();

  if (!conversation) {
    return failed("Conversation not found");
  }

  if (conversation.workflow_id !== workflowId) {
    return failed("Conversation workflow mismatch");
  }

  const resumeNodeId = conversation.resume_node_id;
  if (!resumeNodeId) {
    return failed("Conversation missing resume node");
  }

  const variableKey = conversation.variable_key;
  if (!variableKey) {
    return failed("Conversation missing variable key");
  }

  const rawMessage = String(input?.message || "").trim();
  if (!rawMessage) {
    return failed("Missing inbound message");
  }

  const record = await fetchPublishedRecord(supabase, workflowId);
  if (!record) {
    return failed("Workflow not published");
  }
  const workflow = toSavedWorkflow(record);
  const validation = validateWorkflowSchema(workflow);
  if (!validation.success) {
    return NextResponse.json({
      executionId: nanoid(),
      status: "failed",
      error: "Invalid workflow",
      details: validation.errors,
    });
  }

  // Claim atômico: só uma retomada consome a resposta.
  const claimed = await claimConversation(supabase, conversation.id);
  if (!claimed) {
    return failed("Conversation already answered");
  }

  // Resposta casa um botão (pelo id clicado ou pelo texto, ignorando maiúsculas,
  // acentos e espaços) → vira o rótulo exato do botão.
  const incomingMessage = canonicalAskAnswer(
    askButtonsForResumeNode(workflow, resumeNodeId),
    rawMessage,
    input?.replyId
  );

  const executionId = nanoid();
  const versionId = record.version.id;
  await supabase.from("workflow_runs").insert({
    id: executionId,
    workflow_id: workflowId,
    version_id: versionId,
    status: "running",
    trigger_type: "Resume",
    input: input ?? {},
    started_at: new Date().toISOString(),
  });

  const conversationVars =
    (claimed.variables as Record<string, unknown> | null) || {};
  const nextVariables = {
    ...conversationVars,
    [variableKey]: incomingMessage,
  };
  const fromPhone = String(
    input?.from || claimed.phone || input?.to || ""
  );

  let execution: ExecutionShape;
  try {
    execution = (await executeWorkflow({
      nodes: workflow.nodes,
      edges: workflow.edges,
      triggerInput: {
        from: fromPhone,
        to: fromPhone,
        message: incomingMessage,
      },
      executionId,
      workflowId,
      startNodeIds: [resumeNodeId],
      initialVariables: nextVariables,
      workflowSettings: workflow.settings,
    })) as ExecutionShape;
  } finally {
    // A resposta foi consumida: encerra a conversa do ask-question (mesmo se a
    // execução falhar — nunca reprocessar a mesma resposta).
    await completeConversation(supabase, conversation.id, nextVariables);
  }

  // A run que pausou na pergunta deixa de ficar "waiting".
  await closeRunsWaitingOnConversation(supabase, workflowId, conversation.id, executionId);

  // Se o fluxo retomado caiu num Delay, pausa de novo — persiste o enrollment.
  const status = await settleExecution(supabase, {
    workflowId,
    versionId,
    executionId,
    phoneRaw: fromPhone,
    execution,
    fallbackVariables: nextVariables,
    logPrefix: "[builder/resume]",
  });

  return NextResponse.json({
    executionId,
    status,
    output: execution,
  });
}
