// Modelo de dados do builder novo: árvore aninhada — ÚNICA fonte de verdade.
// Nodes/edges (formato do executor/React Flow) são 100% derivados:
//   - layoutFlow() deriva o grafo visual (lib/builder/flow/layout.ts)
//   - compileFlow() deriva o grafo executável (lib/builder/flow/compile.ts)
//
// Types recursivos escritos à mão (sem zod recursivo, por decisão de projeto).

export type StepType =
  | "whatsapp"
  | "interactive"
  | "wait"
  | "condition"
  | "split"
  | "tag"
  | "goto"
  | "end";

export interface Branch {
  id: string;
  label: string;
  child: Step | null;
  /** split: porcentagem do path (soma deve dar 100) */
  percent?: number;
  /** contagem de contatos exibida na edge (badge azul) */
  count?: number;
  /** branches fixas não removíveis: "None", "Not Delivered", "Timeout" */
  locked?: boolean;
  /** condition: campo/operador/valor */
  field?: string;
  operator?: string;
  value?: string;
}

export interface Step {
  /** id estável (nanoid) — os ids compilados são derivados dele */
  id: string;
  type: StepType;
  /** renomeável ("Perfeito", "RETÉM") */
  name: string;
  config: Record<string, unknown>;
  /** sequência (lista ligada) */
  next: Step | null;
  /** só condition/split/interactive */
  branches?: Branch[];
}

export interface FlowTrigger {
  label: string;
  /** palavras-chave que disparam o fluxo (uma entrada por keyword) */
  keywords: string[];
}

export interface Flow {
  /** versão do formato da árvore persistida em workflow_versions.tree */
  schemaVersion: 1;
  id: string;
  name: string;
  trigger: FlowTrigger;
  root: Step | null;
}

/** Onde inserir um novo step. */
export type Slot =
  | { kind: "root" } // entre o trigger e o root
  | { kind: "after"; stepId: string } // depois de um step (entre ele e o next)
  | { kind: "branch"; stepId: string; branchIndex: number }; // no início de uma branch
