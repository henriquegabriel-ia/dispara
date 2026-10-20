import type { WorkflowEdge, WorkflowNode } from "@/lib/builder/graph-types";
import { normalizeAnswerText } from "@/lib/builder/keyword-match";

/**
 * Rótulos dos botões do "Perguntar" que pausou na conversa: o nó ask-question é
 * a origem da aresta que chega no nó de retomada (resume_node_id = "<ask>__var").
 * [] quando não dá para saber (grafo antigo, sem `buttons`).
 */
export function askButtonsForResumeNode(
  graph: { nodes: WorkflowNode[]; edges: WorkflowEdge[] },
  resumeNodeId: string
): string[] {
  const askIds = new Set(
    graph.edges.filter((edge) => edge?.target === resumeNodeId).map((edge) => edge.source)
  );
  for (const node of graph.nodes) {
    if (!askIds.has(node.id)) continue;
    const buttons = (node.data?.config as Record<string, unknown> | undefined)?.buttons;
    if (Array.isArray(buttons)) {
      return buttons.map((label) => String(label ?? "").trim()).filter(Boolean);
    }
  }
  return [];
}

/**
 * Resposta canônica de um "Perguntar": se casa com um botão — pelo id do botão
 * clicado (o id é o próprio rótulo) ou pelo texto normalizado (maiúsculas,
 * acentos e espaços ignorados) — vira o rótulo EXATO do botão, que é o que as
 * condições compiladas comparam (===). Senão, a resposta como veio (aparada).
 */
export function canonicalAskAnswer(
  buttons: string[],
  answer: string,
  replyId?: string | null
): string {
  const trimmed = String(answer ?? "").trim();
  if (buttons.length === 0) return trimmed;
  const id = String(replyId ?? "").trim();
  if (id) {
    const byId = buttons.find((label) => label === id);
    if (byId) return byId;
  }
  const normalized = normalizeAnswerText(trimmed);
  const byText = buttons.find((label) => normalizeAnswerText(label) === normalized);
  return byText ?? trimmed;
}

/** A resposta casa algum botão (id ou texto normalizado)? */
export function answerMatchesButton(
  buttons: string[],
  answer: string,
  replyId?: string | null
): boolean {
  if (buttons.length === 0) return false;
  return buttons.includes(canonicalAskAnswer(buttons, answer, replyId));
}
