"use client";

import { memo } from "react";
import { Handle, Position } from "@xyflow/react";
import type { NodeProps } from "@xyflow/react";
import { Plus } from "lucide-react";
import type { Slot } from "@/lib/builder/flow/types";
import { useFlowBuilderStore } from "../store";

/**
 * "+" folha no fim de uma cadeia aberta (sem END e sem convergência) — ou o "+"
 * da continuação de um Perguntar/Condição (com `label`, abaixo do bloco de
 * branches ou no ponto de junção com o próximo passo).
 */
const PlusLeafNode = memo(function PlusLeafNode({ data }: NodeProps) {
  const { slot, label } = data as unknown as { slot: Slot; label?: string };
  return (
    <div className="relative h-full w-full">
      <Handle type="target" position={Position.Top} />
      <button
        type="button"
        className="nodrag nopan flex h-full w-full items-center justify-center rounded-full border border-[var(--ds-border-default)] bg-card text-[var(--ds-text-secondary)] shadow-sm transition-all hover:scale-110 hover:border-primary-500 hover:bg-primary-500 hover:text-white"
        onClick={(e) => {
          e.stopPropagation();
          useFlowBuilderStore
            .getState()
            .openPicker(slot, { x: e.clientX, y: e.clientY });
        }}
        aria-label={label ? `Adicionar ação: ${label}` : "Adicionar ação"}
        title={label}
      >
        <Plus size={16} />
      </button>
      {label && (
        <span className="pointer-events-none absolute top-1/2 left-full ml-2 -translate-y-1/2 rounded-full border border-[var(--ds-border-default)] bg-[var(--ds-bg-surface)] px-2 py-0.5 text-[11px] whitespace-nowrap text-[var(--ds-text-secondary)]">
          {label}
        </span>
      )}
    </div>
  );
});

export default PlusLeafNode;
