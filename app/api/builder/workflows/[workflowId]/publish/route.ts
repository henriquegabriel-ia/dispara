import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import {
  createNewVersion,
  fetchEditorRecord,
} from "@/lib/builder/workflow-db";
import { syncWorkflowSchedule, clearWorkflowSchedule } from "@/lib/builder/workflow-schedule";
import { settingsDb } from "@/lib/supabase-db";
import {
  findWorkflowGraphIssues,
  workflowGraphIssuesBody,
} from "@/lib/builder/workflow-graph-guard";
import { compileFlow, FlowCompileError } from "@/lib/builder/flow/compile";
import type { Flow } from "@/lib/builder/flow/types";
import type { WorkflowEdge, WorkflowNode } from "@/lib/builder/graph-types";

type RouteParams = {
  params: Promise<{ workflowId: string }>;
};

/** Árvore do builder novo (schemaVersion 1)? Fluxos antigos têm tree null. */
function isFlowTree(tree: unknown): tree is Flow {
  return (
    !!tree &&
    typeof tree === "object" &&
    (tree as { schemaVersion?: unknown }).schemaVersion === 1
  );
}

export async function POST(_request: Request, { params }: RouteParams) {
  const { workflowId } = await params;
  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return NextResponse.json(
      { error: "Supabase not configured" },
      { status: 400 }
    );
  }

  // Publica o que o editor vê: o rascunho mais novo (ou a versão ativa, se não
  // houver rascunho). Nunca cria o workflow: id inexistente → 404.
  const record = await fetchEditorRecord(supabase, workflowId);
  if (!record) {
    return NextResponse.json({ error: "Workflow não encontrado" }, { status: 404 });
  }

  // Não publica grafo com condição inválida/maliciosa nem com actionType fora
  // da allowlist (rascunhos salvos antes da revalidação no PATCH podem ter).
  const graphIssues = findWorkflowGraphIssues(record.version.nodes);
  if (graphIssues.length > 0) {
    return NextResponse.json(workflowGraphIssuesBody(graphIssues), {
      status: 400,
    });
  }

  // O servidor compila a árvore salva: o que vai ao ar é SEMPRE o grafo da árvore
  // que o usuário vê (o autosave grava a tree mesmo quando ela não compila — com
  // os nodes antigos). Árvore que não compila não é publicada.
  let nodes: WorkflowNode[] = record.version.nodes;
  let edges: WorkflowEdge[] = record.version.edges;
  if (isFlowTree(record.version.tree)) {
    try {
      const compiled = compileFlow(record.version.tree);
      nodes = compiled.nodes as unknown as WorkflowNode[];
      edges = compiled.edges as unknown as WorkflowEdge[];
    } catch (error) {
      if (error instanceof FlowCompileError) {
        return NextResponse.json(
          {
            error: `Não foi possível publicar: ${error.message}`,
            stepId: error.stepId,
          },
          { status: 400 }
        );
      }
      throw error;
    }
    const compiledIssues = findWorkflowGraphIssues(nodes);
    if (compiledIssues.length > 0) {
      return NextResponse.json(workflowGraphIssuesBody(compiledIssues), {
        status: 400,
      });
    }
  }

  const previousVersionId = record.workflow.active_version_id;
  const published = await createNewVersion(supabase, workflowId, {
    nodes,
    edges,
    tree: record.version.tree ?? null,
    status: "published",
  });

  const now = new Date().toISOString();
  await supabase.from("workflows").update({
    active_version_id: published.id,
    status: "published",
    updated_at: now,
  }).eq("id", workflowId);

  // A versão que estava no ar e o rascunho que acabou de ser publicado viram
  // histórico — e qualquer outra 'published' perdida (sempre 1 no ar por fluxo).
  const toArchive = [previousVersionId, record.version.id].filter(
    (id): id is string => Boolean(id) && id !== published.id
  );
  if (toArchive.length > 0) {
    await supabase
      .from("workflow_versions")
      .update({ status: "archived", updated_at: now })
      .in("id", Array.from(new Set(toArchive)));
  }
  await supabase
    .from("workflow_versions")
    .update({ status: "archived", updated_at: now })
    .eq("workflow_id", workflowId)
    .eq("status", "published")
    .neq("id", published.id);

  const triggerNode = nodes.find(
    (node) => node.data.type === "trigger"
  );
  const triggerType = triggerNode?.data.config?.triggerType as string | undefined;
  if (triggerType === "Schedule") {
    const cron = String(triggerNode?.data.config?.scheduleCron || "").trim();
    const timezone = triggerNode?.data.config?.scheduleTimezone
      ? String(triggerNode.data.config.scheduleTimezone)
      : null;
    if (cron) {
      const secret =
        (await settingsDb.get("workflow_builder_webhook_secret")) ||
        process.env.WORKFLOW_BUILDER_WEBHOOK_SECRET ||
        null;
      await syncWorkflowSchedule({
        workflowId,
        cron,
        timezone,
        secret,
      });
    }
  } else {
    await clearWorkflowSchedule(workflowId);
  }

  return NextResponse.json({
    success: true,
    versionId: published.id,
    version: published.version,
  });
}
