"use client";

import { memo } from "react";
import { Handle, Position } from "@xyflow/react";
import type { NodeProps } from "@xyflow/react";

const EndNode = memo(function EndNode({ selected }: NodeProps) {
  return (
    <div
      className={`flex h-full w-full items-center justify-center rounded-full border border-slate-600 bg-slate-800 text-[11px] font-semibold tracking-[0.2em] text-slate-200 shadow-sm ${
        selected ? "ring-2 ring-primary-500/40" : ""
      }`}
    >
      END
      <Handle type="target" position={Position.Top} />
    </div>
  );
});

export default EndNode;
