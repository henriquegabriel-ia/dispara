import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import {
  createNewVersion,
  ensureEditorRecord,
  getCompanyId,
} from "@/lib/builder/workflow-db";
import { syncWorkflowSchedule, clearWorkflowSchedule } from "@/lib/builder/workflow-schedule";
import { settingsDb } from "@/lib/supabase-db";
import {
  findWorkflowGraphIssues,
  workflowGraphIssuesBody,
} from "@/lib/builder/workflow-graph-guard";

type RouteParams = {
  params: Promise<{ workflowId: string }>;
};

export async function POST(_request: Request, { params }: RouteParams) {
  const { workflowId } = await params;
  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return NextResponse.json(
      { error: "Supabase not configured" },
      { status: 400 }
    );
  }

  const companyId = await getCompanyId(supabase);
  // Publica o que o editor vê: o rascunho mais novo (ou a versão ativa, se não
  // houver rascunho).
  const record = await ensureEditorRecord(supabase, workflowId, companyId);

  // Não publica grafo com condição inválida/maliciosa nem com actionType fora
  // da allowlist (rascunhos salvos antes da revalidação no PATCH podem ter).
  const graphIssues = findWorkflowGraphIssues(record.version.nodes);
  if (graphIssues.length > 0) {
    return NextResponse.json(workflowGraphIssuesBody(graphIssues), {
      status: 400,
    });
  }

  const previousVersionId = record.workflow.active_version_id;
  const published = await createNewVersion(supabase, workflowId, {
    nodes: record.version.nodes,
    edges: record.version.edges,
    tree: record.version.tree ?? null,
    status: "published",
  });

  const now = new Date().toISOString();
  await supabase.from("workflows").update({
    active_version_id: published.id,
    status: "published",
    updated_at: now,
  }).eq("id", workflowId);

  // A versão que estava no ar e o rascunho que acabou de ser publicado viram histórico.
  const toArchive = [previousVersionId, record.version.id].filter(
    (id): id is string => Boolean(id) && id !== published.id
  );
  if (toArchive.length > 0) {
    await supabase
      .from("workflow_versions")
      .update({ status: "archived", updated_at: now })
      .in("id", Array.from(new Set(toArchive)));
  }

  const triggerNode = record.version.nodes.find(
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
