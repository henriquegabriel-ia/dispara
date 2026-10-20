import { NextRequest, NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { getSupabaseAdmin } from "@/lib/supabase";
import { fetchPublishedRecord, toSavedWorkflow } from "@/lib/builder/workflow-db";
import { executeWorkflow } from "@/lib/builder/workflow-executor.workflow";
import { validateWorkflowSchema } from "@/lib/shared/workflow-schema";
import { verifyCronRequest, cronUnauthorizedResponse } from "@/lib/cron-auth";
import { matchesKeyword, parseKeywordList } from "@/lib/builder/keyword-match";
import { isPhoneBlocked } from "@/lib/builder/contact-eligibility";
import {
  settleExecution,
  type ExecutionShape,
} from "@/lib/builder/workflow-run-outcome";

/**
 * Executa um workflow do builder.
 *
 * Migração QStash→pg_cron (Fase D): antes era um serve() do @upstash/workflow (o QStash
 * re-invocava o endpoint por step). Agora é um POST normal autenticado (verifyCronRequest)
 * chamado pelo webhook (fire-and-forget). O DAG roda in-process; ao encontrar um Delay o
 * executor pausa e devolve o ponto de continuação — aqui persistimos o enrollment com
 * resume_at, e o cron drena/retoma depois. Ask-question segue persistindo inline
 * (workflow_conversations).
 *
 * Só roda a versão PUBLICADA (workflows.active_version_id com status 'published'):
 * fluxo nunca publicado, excluído ou inexistente não executa (e nunca é criado aqui).
 */

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type BuilderWorkflowInput = {
  input?: {
    to?: string;
    from?: string;
    message?: string;
    previewUrl?: boolean;
  };
  startNodeIds?: string[];
  initialVariables?: Record<string, unknown>;
  /**
   * Por que o webhook despachou: "default" = fluxo padrão (a mensagem NÃO casou
   * palavra-chave nenhuma) — o gate de Palavras-chave não se aplica.
   */
  dispatch?: "keyword" | "default" | "campaign_reply";
};

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ workflowId: string }> }
) {
  const auth = verifyCronRequest(request);
  if (!auth.valid) return cronUnauthorizedResponse(auth.error);

  const { workflowId } = await params;
  const payload = (await request
    .json()
    .catch(() => ({}))) as BuilderWorkflowInput;
  const input = payload.input;

  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return NextResponse.json({
      executionId: nanoid(),
      status: "failed",
      error: "Supabase not configured",
    });
  }

  const record = await fetchPublishedRecord(supabase, workflowId);
  if (!record) {
    return NextResponse.json({
      executionId: nanoid(),
      status: "failed",
      error: "Workflow not published",
    });
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

  const triggerNode = workflow.nodes.find(
    (node) => node.data.type === "trigger"
  );
  const triggerType = triggerNode?.data.config?.triggerType as
    | string
    | undefined;
  const inboundMessage = input?.message || "";
  const versionId = record.version.id;

  const executionId = nanoid();
  await supabase.from("workflow_runs").insert({
    id: executionId,
    workflow_id: workflowId,
    version_id: versionId,
    status: "running",
    trigger_type: triggerType ?? null,
    input: input ?? {},
    started_at: new Date().toISOString(),
  });

  const skip = async (reason: string) => {
    await supabase
      .from("workflow_runs")
      .update({
        status: "skipped",
        output: { reason },
        finished_at: new Date().toISOString(),
      })
      .eq("id", executionId);
    return NextResponse.json({
      executionId,
      status: "skipped",
      output: { reason },
    });
  };

  // Gate de Keywords — só no disparo inicial (não em resume, que passa
  // startNodeIds) e não quando o webhook despachou o fluxo como PADRÃO. Mesma
  // regra do webhook (lib/builder/keyword-match): match exato normalizado.
  if (
    triggerType === "Keywords" &&
    !payload.startNodeIds &&
    payload.dispatch !== "default"
  ) {
    if (!inboundMessage.trim()) return skip("missing_message");
    const keywords = parseKeywordList(triggerNode?.data.config?.keywordList);
    if (!matchesKeyword(keywords, inboundMessage)) return skip("keyword_not_matched");
  }

  // Opt-out / supressão: quem pediu para sair não recebe o fluxo (na dúvida —
  // erro ao consultar — também não envia).
  const contactPhone = String(input?.from || input?.to || "");
  if (contactPhone) {
    let blocked = true;
    try {
      blocked = await isPhoneBlocked(supabase, contactPhone);
    } catch (error) {
      console.error("[builder/execute] Falha ao checar supressão:", error);
    }
    if (blocked) return skip("contact_opted_out");
  }

  const execution = (await executeWorkflow({
    nodes: workflow.nodes,
    edges: workflow.edges,
    triggerInput: input ?? {},
    executionId,
    workflowId,
    startNodeIds: payload.startNodeIds,
    initialVariables: payload.initialVariables,
    workflowSettings: workflow.settings,
  })) as ExecutionShape;

  const status = await settleExecution(supabase, {
    workflowId,
    versionId,
    executionId,
    phoneRaw: contactPhone,
    execution,
    logPrefix: "[builder/execute]",
  });

  return NextResponse.json({
    executionId,
    status,
    output: execution,
  });
}
