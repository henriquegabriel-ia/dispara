import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { fetchEditorRecord, toSavedWorkflow } from "@/lib/builder/workflow-db";

type RouteParams = {
  params: Promise<{ workflowId: string }>;
};

export async function GET(_request: Request, { params }: RouteParams) {
  const { workflowId } = await params;
  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return NextResponse.json(
      { error: "Supabase not configured" },
      { status: 400 }
    );
  }
  // Leitura nunca cria: id inexistente → 404.
  const record = await fetchEditorRecord(supabase, workflowId);
  if (!record) {
    return NextResponse.json({ error: "Workflow não encontrado" }, { status: 404 });
  }
  const workflow = toSavedWorkflow(record);
  return NextResponse.json({
    name: workflow.name,
    workflow,
  });
}
