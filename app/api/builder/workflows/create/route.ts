import { NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { getSupabaseAdmin } from "@/lib/supabase";
import {
  buildDefaultWorkflow,
  createWorkflowRecord,
  getCompanyId,
  toSavedWorkflow,
} from "@/lib/builder/workflow-db";
import { compileFlow } from "@/lib/builder/flow/compile";
import type { WorkflowEdge, WorkflowNode } from "@/lib/builder/graph-types";
import { validateWorkflowSchema } from "@/lib/shared/workflow-schema";
import { validateTree } from "@/lib/builder/flow/tree-validate";
import type { Flow } from "@/lib/builder/flow/types";
import {
  findWorkflowGraphIssues,
  workflowGraphIssuesBody,
} from "@/lib/builder/workflow-graph-guard";

export async function POST(request: Request) {
  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return NextResponse.json(
      { error: "Supabase not configured" },
      { status: 400 }
    );
  }
  const body = await request.json().catch(() => ({}));
  const nodes = Array.isArray(body?.nodes) ? body.nodes : [];
  const edges = Array.isArray(body?.edges) ? body.edges : [];
  const workflowId = nanoid();
  const name = typeof body?.name === "string" && body.name ? body.name : undefined;
  let tree: unknown;
  if (body?.tree !== undefined) {
    if (body.tree === null || typeof body.tree !== "object") {
      return NextResponse.json(
        { error: "Invalid tree", details: "tree deve ser um objeto Flow" },
        { status: 400 }
      );
    }
    const treeValidation = validateTree(body.tree as Flow);
    if (!treeValidation.valid) {
      return NextResponse.json(
        { error: "Invalid tree", details: treeValidation.issues },
        { status: 400 }
      );
    }
    tree = body.tree;
  }
  // Sem grafo no corpo (a tela de lista cria com nodes: [], edges: []): o fluxo
  // nasce no builder novo — árvore (a enviada ou a vazia "Sem gatilho") e o grafo
  // COMPILADO dela. Nunca o grafo legado (Webhook + Send Message vazio).
  let graph: { nodes: WorkflowNode[]; edges: WorkflowEdge[] } | null = null;
  if (nodes.length === 0 && edges.length === 0) {
    const fallback = buildDefaultWorkflow({ id: workflowId, name });
    graph = { nodes: fallback.nodes, edges: fallback.edges };
    if (tree === undefined) {
      tree = fallback.tree;
    } else {
      try {
        const compiled = compileFlow(tree as Flow);
        graph = {
          nodes: compiled.nodes as unknown as WorkflowNode[],
          edges: compiled.edges as unknown as WorkflowEdge[],
        };
      } catch {
        // Árvore ainda incompleta (rascunho): fica com o grafo da árvore vazia —
        // o publish recompila a árvore e recusa se ela não compilar.
      }
    }
  }
  const normalized = {
    id: workflowId,
    name: body?.name,
    description: body?.description,
    nodes: graph ? graph.nodes : nodes,
    edges: graph ? graph.edges : edges,
    tree,
    visibility: body?.visibility,
  };
  const validation = validateWorkflowSchema(normalized);
  if (!validation.success) {
    return NextResponse.json(
      { error: "Invalid workflow", details: validation.errors },
      { status: 400 }
    );
  }
  // Mesma revalidação do PATCH (condições + actionTypes): o grafo cru vai
  // direto para o executor.
  const graphIssues = findWorkflowGraphIssues(normalized.nodes);
  if (graphIssues.length > 0) {
    return NextResponse.json(workflowGraphIssuesBody(graphIssues), {
      status: 400,
    });
  }
  const companyId = await getCompanyId(supabase);
  try {
    const record = await createWorkflowRecord(
      supabase,
      normalized,
      companyId
    );
    const workflow = toSavedWorkflow(record);
    return NextResponse.json(workflow);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create workflow";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
