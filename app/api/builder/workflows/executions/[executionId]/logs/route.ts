import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { fetchWorkflowRecord } from "@/lib/builder/workflow-db";

type RouteParams = {
  params: Promise<{ executionId: string }>;
};

export async function GET(request: Request, { params }: RouteParams) {
  const { executionId } = await params;
  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return NextResponse.json({ execution: null, logs: [] });
  }

  const statusFilter = new URL(request.url).searchParams.get("status");

  const { data: execution, error: execError } = await supabase
    .from("workflow_runs")
    .select("*")
    .eq("id", executionId)
    .single();

  if (execError || !execution) {
    return NextResponse.json({ execution: null, logs: [] });
  }

  let logsQuery = supabase
    .from("workflow_run_logs")
    .select("*")
    .eq("run_id", executionId)
    .order("started_at", { ascending: true });

  if (statusFilter) {
    logsQuery = logsQuery.eq("status", statusFilter);
  }

  const { data: logs } = await logsQuery;

  // Grafo da versão que RODOU (a run guarda version_id); sem ela, a versão
  // ativa. Leitura nunca cria o workflow.
  let graph: { nodes: unknown[]; edges: unknown[] } = { nodes: [], edges: [] };
  const { data: ranVersion } = execution.version_id
    ? await supabase
        .from("workflow_versions")
        .select("nodes, edges")
        .eq("id", execution.version_id)
        .maybeSingle()
    : { data: null };
  if (ranVersion) {
    graph = { nodes: ranVersion.nodes ?? [], edges: ranVersion.edges ?? [] };
  } else {
    const workflowRecord = await fetchWorkflowRecord(supabase, execution.workflow_id);
    if (workflowRecord) {
      graph = { nodes: workflowRecord.version.nodes, edges: workflowRecord.version.edges };
    }
  }

  const mappedLogs = (logs || []).map((log) => ({
    id: String(log.id),
    executionId: log.run_id,
    nodeId: log.node_id,
    nodeName: log.node_name || "",
    nodeType: log.node_type || "",
    status: log.status,
    input: log.input,
    output: log.output,
    error: log.error,
    startedAt: log.started_at,
    completedAt: log.completed_at,
    duration: null,
  }));

  return NextResponse.json({
    execution: {
      id: execution.id,
      workflow: graph,
    },
    logs: mappedLogs,
  });
}
