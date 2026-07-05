import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import {
  createWorkflowRecord,
  ensureWorkflowRecord,
  getCompanyId,
  toSavedWorkflow,
} from "@/lib/builder/workflow-db";

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
  const record = await ensureWorkflowRecord(supabase, workflowId, companyId);
  const duplicate = await createWorkflowRecord(
    supabase,
    {
      name: `${record.workflow.name} Copy`,
      description: record.workflow.description ?? undefined,
      nodes: record.version.nodes,
      edges: record.version.edges,
      tree: record.version.tree ?? undefined,
    },
    companyId
  );
  return NextResponse.json(toSavedWorkflow(duplicate));
}
