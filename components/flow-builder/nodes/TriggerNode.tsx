"use client";

import { memo } from "react";
import { Handle, Position } from "@xyflow/react";
import type { NodeProps } from "@xyflow/react";
import { Zap } from "lucide-react";

const TriggerNode = memo(function TriggerNode({ data, selected }: NodeProps) {
  const { label, keywords } = data as unknown as {
    label: string;
    keywords?: string[];
  };
  const count = keywords?.length ?? 0;
  const subtitle =
    count > 0
      ? `${count} ${count === 1 ? "palavra-chave" : "palavras-chave"}`
      : "Definir palavras-chave";

  return (
    <div
      className={`flex h-full w-full items-center gap-3 rounded-[10px] border-2 border-dashed px-3 ${
        selected
          ? "border-primary-500 bg-card/80 ring-2 ring-primary-500/25"
          : "border-[var(--ds-border-default)] bg-card/60 hover:border-slate-500"
      }`}
    >
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-500/15 text-amber-400">
        <Zap size={16} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-medium text-[var(--ds-text-secondary)]">
          {label}
        </div>
        <div className="truncate text-[11px] text-[var(--ds-text-muted)]">{subtitle}</div>
      </div>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
});

export default TriggerNode;
