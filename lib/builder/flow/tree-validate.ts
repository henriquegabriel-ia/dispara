// Validador estrutural LEVE da árvore (Flow). Não valida semântica de execução
// (isso é papel do compileFlow + validateWorkflowSchema no grafo compilado) —
// só invariantes básicas que a UI e as operações devem manter.

import { triggerTypeOf, type Branch, type Flow, type Step } from "./types";

export interface TreeIssue {
  /** id do step relacionado (null = problema no nível do flow/trigger) */
  stepId: string | null;
  message: string;
}

export interface TreeValidationResult {
  valid: boolean;
  issues: TreeIssue[];
}

const BRANCHED_TYPES = new Set(["condition", "split", "interactive"]);

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** branches como lista (tree malformada vinda do corpo do PATCH não pode lançar). */
function branchList(step: Step): Branch[] {
  return Array.isArray(step.branches) ? step.branches.filter(isObject) : [];
}

function stepConfig(step: Step): Record<string, unknown> {
  return isObject(step.config) ? step.config : {};
}

function walk(step: Step | null, fn: (s: Step) => void): void {
  if (!isObject(step)) return;
  fn(step);
  for (const b of branchList(step)) walk(b.child, fn);
  walk(step.next, fn);
}

function nonLocked(branches: Branch[] | undefined): Branch[] {
  return (branches ?? []).filter((b) => !b.locked);
}

export function validateTree(flow: Flow): TreeValidationResult {
  const issues: TreeIssue[] = [];

  if (flow.schemaVersion !== 1) {
    issues.push({
      stepId: null,
      message: `schemaVersion não suportada: ${String(flow.schemaVersion)} (esperado 1).`,
    });
  }

  // ── ids únicos (steps e branches) ────────────────────────────────────────
  const stepIds = new Set<string>();
  const branchIds = new Set<string>();
  const allStepIds = new Set<string>();
  walk(flow.root, (s) => allStepIds.add(s.id));

  walk(flow.root, (s) => {
    const branches = branchList(s);
    if (s.branches !== undefined && !Array.isArray(s.branches)) {
      issues.push({ stepId: s.id ?? null, message: `Step "${s.name}": branches deve ser uma lista.` });
    }
    if (s.config !== undefined && !isObject(s.config)) {
      issues.push({ stepId: s.id ?? null, message: `Step "${s.name}": config inválida.` });
    }

    if (!s.id) {
      issues.push({ stepId: null, message: `Step do tipo "${s.type}" sem id.` });
    } else if (stepIds.has(s.id)) {
      issues.push({ stepId: s.id, message: `Id de step duplicado: "${s.id}".` });
    } else {
      stepIds.add(s.id);
    }

    for (const b of branches) {
      if (!b.id) {
        issues.push({ stepId: s.id, message: `Branch "${b.label}" sem id em "${s.name}".` });
      } else if (branchIds.has(b.id)) {
        issues.push({ stepId: s.id, message: `Id de branch duplicado: "${b.id}".` });
      } else {
        branchIds.add(b.id);
      }
    }

    // ── branches obrigatórios em tipos ramificados ─────────────────────────
    if (BRANCHED_TYPES.has(s.type)) {
      if (branches.length === 0) {
        issues.push({
          stepId: s.id,
          message: `Step "${s.name}" (${s.type}) precisa ter branches.`,
        });
      } else if (s.type === "condition" && nonLocked(branches).length === 0) {
        issues.push({
          stepId: s.id,
          message: `Condição "${s.name}" precisa de pelo menos 1 branch além do "None".`,
        });
      } else if (s.type === "interactive" && nonLocked(branches).length === 0) {
        issues.push({
          stepId: s.id,
          message: `Pergunta "${s.name}" precisa de pelo menos 1 botão.`,
        });
      }
    } else if (branches.length > 0) {
      issues.push({
        stepId: s.id,
        message: `Step "${s.name}" (${s.type}) não deveria ter branches.`,
      });
    }

    // ── split: percentuais somam 100 ───────────────────────────────────────
    if (s.type === "split" && branches.length > 0) {
      const total = branches.reduce((sum, b) => sum + (b.percent ?? 0), 0);
      if (total !== 100) {
        issues.push({
          stepId: s.id,
          message: `Split "${s.name}": percentuais somam ${total}% (esperado 100%).`,
        });
      }
    }

    // ── goto: alvo precisa existir ─────────────────────────────────────────
    if (s.type === "goto") {
      const target = stepConfig(s).targetId as string | null | undefined;
      if (target && !allStepIds.has(target)) {
        issues.push({
          stepId: s.id,
          message: `Go To "${s.name}" aponta para step inexistente: "${target}".`,
        });
      }
    }

    // ── terminais não podem ter next ───────────────────────────────────────
    if ((s.type === "end" || s.type === "goto") && s.next) {
      issues.push({
        stepId: s.id,
        message: `Step terminal "${s.name}" (${s.type}) não pode ter continuação.`,
      });
    }
  });

  return { valid: issues.length === 0, issues };
}

// ─── Pendências de publicação ─────────────────────────────────────────────────
// Diferente do validateTree (barreira estrutural do PATCH, que aceita rascunho),
// estas checagens apontam o que impede o fluxo de FUNCIONAR depois de publicado.
// A tela mostra a lista (header + cards) e o Publicar é bloqueado enquanto houver
// alguma. Não substitui o compileFlow — o publish ainda compila.

/** Operadores de condição que comparam com um valor digitado. */
const VALUE_OPERATORS = new Set(["contains", "not_contains", "equals"]);

/** Valores preenchidos para as variáveis do template ({{1}}, {{2}}…). */
export function templateBodyParamsOf(config: Record<string, unknown>): string[] {
  const raw = config.templateBodyParams;
  return Array.isArray(raw) ? raw.map((v) => (v == null ? "" : String(v))) : [];
}

export function lintFlow(flow: Flow): TreeIssue[] {
  const issues: TreeIssue[] = [];
  const trigger = isObject(flow.trigger) ? flow.trigger : null;

  if (trigger && triggerTypeOf(trigger) === "keywords") {
    const keywords = Array.isArray(trigger.keywords) ? trigger.keywords : [];
    if (!keywords.some((k) => String(k ?? "").trim() !== "")) {
      issues.push({
        stepId: null,
        message: "Gatilho de palavra-chave sem nenhuma palavra: o fluxo nunca dispararia.",
      });
    }
  }

  walk(flow.root, (s) => {
    const cfg = stepConfig(s);
    const name = s.name || "sem nome";
    switch (s.type) {
      case "whatsapp": {
        const template = String(cfg.template ?? "").trim();
        const mediaUrl = String(cfg.mediaUrl ?? "").trim();
        const message = String(cfg.message ?? "").trim();
        if (!template && !mediaUrl && !message) {
          issues.push({
            stepId: s.id,
            message: `Passo WhatsApp "${name}" está vazio: escolha um template ou escreva a mensagem.`,
          });
        } else if (template) {
          const missing = templateBodyParamsOf(cfg).filter((v) => v.trim() === "").length;
          if (missing > 0) {
            issues.push({
              stepId: s.id,
              message: `Passo WhatsApp "${name}": preencha ${
                missing === 1 ? "a variável" : `as ${missing} variáveis`
              } do template.`,
            });
          }
          if (String(cfg.templateHeaderMediaType ?? "") && !String(cfg.templateHeaderMediaUrl ?? "").trim()) {
            issues.push({
              stepId: s.id,
              message: `Passo WhatsApp "${name}": o template tem mídia no cabeçalho — informe a URL.`,
            });
          }
        }
        break;
      }
      case "interactive": {
        if (!String(cfg.message ?? "").trim()) {
          issues.push({ stepId: s.id, message: `Pergunta "${name}" está sem texto.` });
        }
        const labels = nonLocked(branchList(s)).map((b) => String(b.label ?? "").trim());
        if (labels.some((l) => l === "")) {
          issues.push({ stepId: s.id, message: `Pergunta "${name}" tem botão sem texto.` });
        } else if (new Set(labels.map((l) => l.toLowerCase())).size !== labels.length) {
          issues.push({ stepId: s.id, message: `Pergunta "${name}" tem botões com o mesmo texto.` });
        }
        break;
      }
      case "condition": {
        for (const b of nonLocked(branchList(s))) {
          const op = String(b.operator ?? "contains");
          if (VALUE_OPERATORS.has(op) && String(b.value ?? "").trim() === "") {
            issues.push({
              stepId: s.id,
              message: `Condição "${name}": a branch "${b.label}" está sem valor.`,
            });
          }
        }
        break;
      }
      default:
        break;
    }
  });

  return issues;
}
