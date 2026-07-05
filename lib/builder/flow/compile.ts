// compileFlow: compila a árvore canônica (Flow) para o grafo nodes+edges que o
// executor Upstash consome (lib/builder/workflow-executor.workflow.ts).
//
// Semântica do executor (contrato):
//   - Condition é um GATE: false bloqueia TODAS as saídas. Branching real =
//     fan-out de N Conditions mutuamente exclusivas após um pai comum.
//   - Convergência: nó com múltiplas incoming roda quando todas resolvem e ≥1
//     está satisfeita.
//   - ask-question (whatsapp/ask-question) envia a pergunta, grava
//     workflow_conversations com resume_node_id = ÚNICO next e pausa. Na
//     retomada, o executor recomeça em startNodeIds=[resume node] com a
//     resposta em initialVariables[variableKey] — por isso o resume node é um
//     "Get Variable" que expõe { key, value } como output referenciável.
//   - Delay = setTimeout in-process (delayMs).
//
// Ids DETERMINÍSTICOS derivados de step.id:
//   whatsapp/wait  → stepId
//   interactive    → stepId (ask) + stepId__var (get variable, resume node)
//                    + stepId__cond_<i> (um por botão) + stepId__cond_else
//   condition      → stepId__cond_<i> (um por branch) + stepId__cond_none
//   trigger        → __trigger (constante)
//   end            → NÃO emite node (a cadeia termina sem saídas)

import {
  preValidateConditionExpression,
  validateConditionExpression,
} from "@/lib/builder/condition-validator";
import { WAIT_UNITS } from "./meta";
import { layoutFlow, TRIGGER_ID } from "./layout";
import { validateTree } from "./tree-validate";
import type { Branch, Flow, Step } from "./types";

// ─── Action types reais do executor (ver plugins.ts / step-registry.ts) ───────
export const ACTION_SEND_MESSAGE = "whatsapp/send-message";
export const ACTION_SEND_TEMPLATE = "whatsapp/send-template";
export const ACTION_SEND_MEDIA = "whatsapp/send-media";
export const ACTION_ASK_QUESTION = "whatsapp/ask-question";
export const ACTION_CONDITION = "Condition";
export const ACTION_DELAY = "Delay";
export const ACTION_GET_VARIABLE = "Get Variable";

export const TRIGGER_NODE_ID = TRIGGER_ID; // "__trigger"

/**
 * Label usado dentro das expressões {{@nodeId:Label.field}}. O executor ignora
 * o label na resolução (usa só o nodeId), mas o parser corta o field no
 * PRIMEIRO ponto — então o label NÃO pode conter '.', ':' nem '}'.
 */
const REF_LABEL_REPLY = "Resposta";
const REF_LABEL_TRIGGER = "Gatilho";

// ─── Types do grafo compilado (shape validado por workflow-schema.ts) ─────────
export type CompiledNode = {
  id: string;
  type: "trigger" | "action";
  position: { x: number; y: number };
  data: {
    label: string;
    type: "trigger" | "action";
    config: Record<string, unknown>;
  };
};

export type CompiledEdge = {
  id: string;
  source: string;
  target: string;
};

export type CompiledWorkflow = {
  nodes: CompiledNode[];
  edges: CompiledEdge[];
};

export class FlowCompileError extends Error {
  stepId: string | null;

  constructor(message: string, stepId: string | null = null) {
    super(message);
    this.name = "FlowCompileError";
    this.stepId = stepId;
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────────────
type Position = { x: number; y: number };

interface CompileCtx {
  nodes: CompiledNode[];
  edges: CompiledEdge[];
  nodeIds: Set<string>;
  edgeIds: Set<string>;
  pos: Map<string, Position>;
}

const FALLBACK_POS: Position = { x: 0, y: 0 };

function posOf(ctx: CompileCtx, layoutId: string, dy = 0, fallback?: Position): Position {
  const base = ctx.pos.get(layoutId) ?? fallback ?? FALLBACK_POS;
  return { x: base.x, y: base.y + dy };
}

function addNode(
  ctx: CompileCtx,
  node: { id: string; type: "trigger" | "action"; label: string; config: Record<string, unknown>; position: Position }
): void {
  if (ctx.nodeIds.has(node.id)) {
    throw new FlowCompileError(`Id de node compilado duplicado: "${node.id}".`, node.id);
  }
  ctx.nodeIds.add(node.id);
  ctx.nodes.push({
    id: node.id,
    type: node.type,
    position: node.position,
    data: { label: node.label, type: node.type, config: node.config },
  });
}

function addEdge(ctx: CompileCtx, source: string, target: string): void {
  const id = `e-${source}-${target}`;
  if (ctx.edgeIds.has(id)) return; // dedupe (pares source→target são únicos)
  ctx.edgeIds.add(id);
  ctx.edges.push({ id, source, target });
}

function connect(ctx: CompileCtx, source: string, targets: string[]): void {
  for (const target of targets) addEdge(ctx, source, target);
}

/** Escapa um valor para virar string literal dentro da expressão de condição. */
function escapeLiteral(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t");
}

const TEMPLATE_REF_PATTERN = /\{\{@([^:]+):([^}]+)\}\}/g;

/**
 * Valida uma expressão gerada usando o condition-validator do executor:
 * 1. preValidate na expressão original (com os templates {{@...}})
 * 2. validate na expressão transformada (templates substituídos por __vN,
 *    exatamente como o executor faz em runtime)
 */
function assertValidExpression(expression: string, where: string, stepId: string): void {
  const pre = preValidateConditionExpression(expression);
  if (!pre.valid) {
    throw new FlowCompileError(
      `Expressão de condição inválida em ${where}: ${pre.error}`,
      stepId
    );
  }
  let counter = 0;
  const simulated = expression.replace(TEMPLATE_REF_PATTERN, () => {
    const name = `__v${counter}`;
    counter += 1;
    return name;
  });
  const result = validateConditionExpression(simulated);
  if (!result.valid) {
    throw new FlowCompileError(
      `Expressão de condição inválida em ${where}: ${result.error}`,
      stepId
    );
  }
}

/** Junta a expressão-base da branch com a negação das anteriores (exclusividade). */
function exclusiveExpression(bases: string[], index: number): string {
  const parts = [bases[index]];
  for (let i = 0; i < index; i += 1) parts.push(`!(${bases[i]})`);
  return parts.join(" && ");
}

/** Negação conjunta de todas as bases (branch None/else). */
function noneExpression(bases: string[]): string {
  return bases.map((base) => `!(${base})`).join(" && ");
}

// ─── Compilação por tipo ───────────────────────────────────────────────────────

function compileWhatsapp(ctx: CompileCtx, step: Step): void {
  const template = String(step.config.template ?? "").trim();
  const mediaUrl = String(step.config.mediaUrl ?? "").trim();
  const message = String(step.config.message ?? "");

  let config: Record<string, unknown>;
  if (template) {
    config = {
      actionType: ACTION_SEND_TEMPLATE,
      toSource: "inbound",
      templateName: template,
      language: "pt_BR",
    };
  } else if (mediaUrl) {
    config = {
      actionType: ACTION_SEND_MEDIA,
      toSource: "inbound",
      mediaType: String(step.config.mediaType ?? "image"),
      mediaUrl,
      caption: message,
    };
  } else {
    if (!message.trim()) {
      throw new FlowCompileError(
        `Passo WhatsApp "${step.name}" está vazio: defina template, mídia ou mensagem.`,
        step.id
      );
    }
    config = {
      actionType: ACTION_SEND_MESSAGE,
      toSource: "inbound",
      message,
    };
  }

  addNode(ctx, {
    id: step.id,
    type: "action",
    label: step.name,
    config,
    position: posOf(ctx, step.id),
  });
}

function compileWait(ctx: CompileCtx, step: Step): void {
  const mode = String(step.config.mode ?? "duration");
  if (mode === "reply") {
    throw new FlowCompileError(
      `Passo "${step.name}": aguardar até resposta ainda não é suportado no v1 (use "Perguntar").`,
      step.id
    );
  }
  const unitKey = String(step.config.unit ?? "minutes");
  const unit = WAIT_UNITS[unitKey];
  if (!unit) {
    throw new FlowCompileError(
      `Passo "${step.name}": unidade de tempo desconhecida "${unitKey}".`,
      step.id
    );
  }
  const value = Number(step.config.value ?? 0);
  if (!Number.isFinite(value) || value <= 0) {
    throw new FlowCompileError(
      `Passo "${step.name}": duração inválida (${String(step.config.value)}).`,
      step.id
    );
  }

  addNode(ctx, {
    id: step.id,
    type: "action",
    label: step.name,
    config: { actionType: ACTION_DELAY, delayMs: value * unit.ms },
    position: posOf(ctx, step.id),
  });
}

/** Posição da coluna de uma branch: head do child ou placeholder do layout. */
function branchColumnPos(ctx: CompileCtx, step: Step, branchIndex: number): Position {
  const branch = step.branches?.[branchIndex];
  if (branch?.child) return posOf(ctx, branch.child.id, -72, posOf(ctx, step.id));
  return posOf(ctx, `ph-${step.id}-${branchIndex}`, 0, posOf(ctx, step.id));
}

function compileInteractive(
  ctx: CompileCtx,
  step: Step,
  contHeads: string[],
  compileBranchChain: (child: Step | null, convergeHeads: string[]) => string[]
): string[] {
  const message = String(step.config.message ?? "").trim();
  if (!message) {
    throw new FlowCompileError(
      `Pergunta "${step.name}" está sem texto de mensagem.`,
      step.id
    );
  }

  const branches = step.branches ?? [];
  const buttons: Array<{ branch: Branch; index: number }> = [];
  for (const [index, branch] of branches.entries()) {
    if (branch.locked) {
      // "Not Delivered"/"Timeout" não têm suporte no executor v1.
      if (branch.child) {
        throw new FlowCompileError(
          `Pergunta "${step.name}": a branch "${branch.label}" não é suportada no v1 — remova as ações dela.`,
          step.id
        );
      }
      continue;
    }
    buttons.push({ branch, index });
  }
  if (buttons.length === 0) {
    throw new FlowCompileError(
      `Pergunta "${step.name}" precisa de pelo menos 1 botão.`,
      step.id
    );
  }

  const askId = step.id;
  const varId = `${step.id}__var`;
  const variableKey = `reply_${step.id}`;
  const askPos = posOf(ctx, step.id);

  // Q: envia a pergunta e pausa (resume_node_id = G, o ÚNICO next).
  addNode(ctx, {
    id: askId,
    type: "action",
    label: step.name,
    config: {
      actionType: ACTION_ASK_QUESTION,
      toSource: "inbound",
      message,
      variableKey,
    },
    position: askPos,
  });

  // G: resume node. Get Variable devolve { key, value } — value é a resposta.
  // IMPORTANTE: não incluir "message" no config (shouldTreatAsAskQuestion
  // sequestraria o node como ask-question de novo).
  addNode(ctx, {
    id: varId,
    type: "action",
    label: `${step.name} · resposta`,
    config: { actionType: ACTION_GET_VARIABLE, variableKey },
    position: { x: askPos.x, y: askPos.y + 96 },
  });
  addEdge(ctx, askId, varId);

  const ref = `{{@${varId}:${REF_LABEL_REPLY}.value}}`;
  const bases = buttons.map(
    ({ branch }) => `${ref}.includes("${escapeLiteral(branch.label)}")`
  );

  // fan-out: G → C_i (mutuamente exclusivas) e G → C_else
  buttons.forEach(({ branch, index }, i) => {
    const condId = `${step.id}__cond_${index}`;
    const expression = exclusiveExpression(bases, i);
    assertValidExpression(expression, `"${step.name}" / botão "${branch.label}"`, step.id);

    addNode(ctx, {
      id: condId,
      type: "action",
      label: branch.label,
      config: { actionType: ACTION_CONDITION, condition: expression },
      position: branchColumnPos(ctx, step, index),
    });
    addEdge(ctx, varId, condId);

    const branchHeads = compileBranchChain(branch.child, contHeads);
    connect(ctx, condId, branchHeads);
  });

  // C_else: resposta que não bate em nenhum botão segue direto pra continuação
  // (sem ela, uma resposta fora dos botões bloquearia o fluxo inteiro).
  const elseId = `${step.id}__cond_else`;
  const elseExpression = noneExpression(bases);
  assertValidExpression(elseExpression, `"${step.name}" / branch else`, step.id);
  addNode(ctx, {
    id: elseId,
    type: "action",
    label: "Outra resposta",
    config: { actionType: ACTION_CONDITION, condition: elseExpression },
    position: { x: askPos.x, y: askPos.y + 192 },
  });
  addEdge(ctx, varId, elseId);
  connect(ctx, elseId, contHeads);

  return [askId];
}

function conditionBase(ref: string, branch: Branch, step: Step): string {
  const operator = String(branch.operator ?? "contains");
  const value = escapeLiteral(String(branch.value ?? ""));
  switch (operator) {
    case "contains":
      return `${ref}.includes("${value}")`;
    case "not_contains":
      return `!(${ref}.includes("${value}"))`;
    case "equals":
      return `${ref} === "${value}"`;
    default:
      throw new FlowCompileError(
        `Condição "${step.name}": operador não suportado "${operator}".`,
        step.id
      );
  }
}

function compileCondition(
  ctx: CompileCtx,
  step: Step,
  contHeads: string[],
  askVarNodeId: string | null,
  compileBranchChain: (child: Step | null, convergeHeads: string[]) => string[]
): string[] {
  // Referência: Get Variable do "Perguntar" mais próximo ACIMA na árvore;
  // sem um, a mensagem do trigger (o executor injeta triggerInput.message no
  // output do node trigger — ver triggerStep + webhook: { from, to, message }).
  const ref = askVarNodeId
    ? `{{@${askVarNodeId}:${REF_LABEL_REPLY}.value}}`
    : `{{@${TRIGGER_NODE_ID}:${REF_LABEL_TRIGGER}.message}}`;

  const branches = step.branches ?? [];
  const evaluated: Array<{ branch: Branch; index: number; base: string }> = [];
  let noneBranch: { branch: Branch; index: number } | null = null;

  for (const [index, branch] of branches.entries()) {
    if (branch.locked) {
      if (noneBranch) {
        throw new FlowCompileError(
          `Condição "${step.name}": só uma branch "None" é suportada.`,
          step.id
        );
      }
      noneBranch = { branch, index };
      continue;
    }
    evaluated.push({ branch, index, base: conditionBase(ref, branch, step) });
  }

  if (evaluated.length === 0) {
    throw new FlowCompileError(
      `Condição "${step.name}" precisa de pelo menos 1 branch além do "None".`,
      step.id
    );
  }

  const bases = evaluated.map((e) => e.base);
  const heads: string[] = [];

  evaluated.forEach(({ branch, index }, i) => {
    const condId = `${step.id}__cond_${index}`;
    const expression = exclusiveExpression(bases, i);
    assertValidExpression(expression, `"${step.name}" / branch "${branch.label}"`, step.id);

    addNode(ctx, {
      id: condId,
      type: "action",
      label: branch.label,
      config: { actionType: ACTION_CONDITION, condition: expression },
      position: branchColumnPos(ctx, step, index),
    });
    heads.push(condId);

    const branchHeads = compileBranchChain(branch.child, contHeads);
    connect(ctx, condId, branchHeads);
  });

  // Branch None (locked): negação conjunta de todas as outras.
  if (noneBranch) {
    const condId = `${step.id}__cond_none`;
    const expression = noneExpression(bases);
    assertValidExpression(expression, `"${step.name}" / branch "None"`, step.id);

    addNode(ctx, {
      id: condId,
      type: "action",
      label: noneBranch.branch.label,
      config: { actionType: ACTION_CONDITION, condition: expression },
      position: branchColumnPos(ctx, step, noneBranch.index),
    });
    heads.push(condId);

    const branchHeads = compileBranchChain(noneBranch.branch.child, contHeads);
    connect(ctx, condId, branchHeads);
  }

  return heads;
}

/**
 * Compila uma cadeia (step + next + ...).
 *
 * @param convergeHeads heads do ponto de convergência herdado (next de um
 *   container ancestral). Cadeia vazia/aberta conecta o pai direto neles.
 * @param askVarNodeId id do Get Variable do "Perguntar" mais próximo acima.
 * @returns os HEADS da cadeia — nodes que o pai deve conectar. `[]` = a cadeia
 *   termina (end) e o pai não ganha saída.
 */
function compileChain(
  ctx: CompileCtx,
  step: Step | null,
  convergeHeads: string[],
  askVarNodeId: string | null
): string[] {
  if (!step) return convergeHeads;

  switch (step.type) {
    case "end":
      // END não emite node: a cadeia simplesmente não tem saída.
      return [];

    case "whatsapp": {
      compileWhatsapp(ctx, step);
      const nextHeads = compileChain(ctx, step.next, convergeHeads, askVarNodeId);
      connect(ctx, step.id, nextHeads);
      return [step.id];
    }

    case "wait": {
      compileWait(ctx, step);
      const nextHeads = compileChain(ctx, step.next, convergeHeads, askVarNodeId);
      connect(ctx, step.id, nextHeads);
      return [step.id];
    }

    case "interactive": {
      const varId = `${step.id}__var`;
      // A continuação (next) e as branches ficam ABAIXO do Perguntar na árvore →
      // condições dentro delas referenciam o Get Variable deste step.
      const contHeads = compileChain(ctx, step.next, convergeHeads, varId);
      return compileInteractive(ctx, step, contHeads, (child, heads) =>
        compileChain(ctx, child, heads, varId)
      );
    }

    case "condition": {
      const contHeads = compileChain(ctx, step.next, convergeHeads, askVarNodeId);
      return compileCondition(ctx, step, contHeads, askVarNodeId, (child, heads) =>
        compileChain(ctx, child, heads, askVarNodeId)
      );
    }

    case "split":
    case "tag":
    case "goto":
      throw new FlowCompileError(
        `O passo "${step.name}" (${step.type}) ainda não é suportado no v1 — remova-o ou aguarde a próxima versão.`,
        step.id
      );

    default: {
      const exhaustive: never = step.type;
      throw new FlowCompileError(`Tipo de step desconhecido: ${String(exhaustive)}.`, step.id);
    }
  }
}

// ─── Entrada principal ─────────────────────────────────────────────────────────

export function compileFlow(flow: Flow): CompiledWorkflow {
  // 1. Validação estrutural leve da árvore
  const tree = validateTree(flow);
  if (!tree.valid) {
    throw new FlowCompileError(
      `Árvore inválida: ${tree.issues.map((i) => i.message).join(" | ")}`,
      tree.issues[0]?.stepId ?? null
    );
  }

  // 2. Layout determinístico → posições por id (steps, __trigger, ph-*)
  const layout = layoutFlow(flow);
  const pos = new Map<string, Position>();
  for (const node of layout.nodes) pos.set(node.id, node.position);

  const ctx: CompileCtx = {
    nodes: [],
    edges: [],
    nodeIds: new Set(),
    edgeIds: new Set(),
    pos,
  };

  // 3. Trigger (exatamente 1, exigido pelo workflow-schema)
  addNode(ctx, {
    id: TRIGGER_NODE_ID,
    type: "trigger",
    label: flow.trigger.label || "Palavras-chave",
    config: {
      triggerType: "Keywords",
      keywordList: flow.trigger.keywords.join("\n"),
    },
    position: posOf(ctx, TRIGGER_ID),
  });

  // 4. Cadeia raiz (sem convergência herdada, sem Perguntar acima)
  const rootHeads = compileChain(ctx, flow.root, [], null);
  connect(ctx, TRIGGER_NODE_ID, rootHeads);

  return { nodes: ctx.nodes, edges: ctx.edges };
}
