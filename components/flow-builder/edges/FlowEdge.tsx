"use client";

import { memo } from "react";
import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath } from "@xyflow/react";
import type { EdgeProps } from "@xyflow/react";
import { Plus, Users } from "lucide-react";
import type { Slot } from "@/lib/builder/flow/types";
import { useFlowBuilderStore } from "../store";
import { roundedOrthogonalPath } from "./path";

export interface FlowEdgeData {
  slot?: Slot;
  branchLabel?: string;
  count?: number;
  noButton?: boolean;
  converge?: boolean;
  /** container→next quando nenhuma branch converge: rota pela lateral do bloco de branches */
  bypassX?: number;
}

const nf = new Intl.NumberFormat("pt-BR");
const EDGE_STYLE = { stroke: "#334155", strokeWidth: 1.5 };

const FlowEdge = memo(function FlowEdge(props: EdgeProps) {
  const { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition } =
    props;
  const data = (props.data ?? {}) as FlowEdgeData;
  const isBranch = data.branchLabel !== undefined;

  // Branch: segmento horizontal logo abaixo do container (deixa a coluna limpa
  // para pill + contagem + botão). Convergência: horizontal logo acima do alvo.
  // Bypass: nenhuma branch convergiu (todas terminais) → contorna o bloco de
  // branches pela lateral em vez de atravessar a coluna do meio.
  const isBypass = data.bypassX != null;
  const [path, labelX, labelY] = isBypass
    ? ([
        roundedOrthogonalPath(
          [
            [sourceX, sourceY],
            [sourceX, sourceY + 24],
            [data.bypassX!, sourceY + 24],
            [data.bypassX!, targetY - 28],
            [targetX, targetY - 28],
            [targetX, targetY],
          ],
          8
        ),
        data.bypassX!,
        (sourceY + 24 + (targetY - 28)) / 2,
      ] as [string, number, number])
    : getSmoothStepPath({
        sourceX,
        sourceY,
        sourcePosition,
        targetX,
        targetY,
        targetPosition,
        borderRadius: 8,
        centerY: isBranch ? sourceY + 24 : data.converge ? targetY - 28 : undefined,
      });

  const hasCount = data.count != null;
  const pillY = targetY - (hasCount ? 72 : 56);
  const plusPos = isBypass
    ? { x: labelX, y: labelY }
    : isBranch
      ? { x: targetX, y: targetY - 16 }
      : data.converge
        ? { x: sourceX, y: sourceY + 28 }
        : { x: labelX, y: labelY };

  const openPicker = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (data.slot) {
      useFlowBuilderStore
        .getState()
        .openPicker(data.slot, { x: e.clientX, y: e.clientY });
    }
  };

  return (
    <>
      <BaseEdge id={id} path={path} style={EDGE_STYLE} />
      <EdgeLabelRenderer>
        {isBranch && (
          <div
            className="pointer-events-none absolute rounded-full border border-slate-700 bg-slate-800 px-2.5 py-0.5 text-[11px] whitespace-nowrap text-slate-400"
            style={{
              transform: `translate(-50%,-50%) translate(${targetX}px,${pillY}px)`,
            }}
          >
            {data.branchLabel}
          </div>
        )}
        {hasCount && (
          <div
            className="pointer-events-none absolute flex items-center gap-1 rounded-full border border-sky-500/30 bg-sky-500/10 px-2 py-0.5 text-[11px] font-medium whitespace-nowrap text-sky-400"
            style={{
              transform: `translate(-50%,-50%) translate(${targetX}px,${targetY - 44}px)`,
            }}
          >
            <Users size={10} />
            {nf.format(data.count!)}
          </div>
        )}
        {!data.noButton && data.slot && (
          <div
            className="nodrag nopan absolute"
            style={{
              transform: `translate(-50%,-50%) translate(${plusPos.x}px,${plusPos.y}px)`,
              pointerEvents: "all",
            }}
          >
            <button
              type="button"
              className="flex h-6 w-6 items-center justify-center rounded-full border border-slate-600 bg-card text-slate-400 shadow-sm transition-all duration-150 hover:scale-115 hover:border-emerald-500 hover:bg-emerald-500 hover:text-white"
              onClick={openPicker}
              aria-label="Inserir ação aqui"
            >
              <Plus size={13} />
            </button>
          </div>
        )}
      </EdgeLabelRenderer>
    </>
  );
});

export default FlowEdge;
