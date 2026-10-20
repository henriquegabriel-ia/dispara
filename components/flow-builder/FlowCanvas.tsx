"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  Panel,
  ReactFlow,
  useViewport,
} from "@xyflow/react";
import type { Edge, Node, NodeMouseHandler } from "@xyflow/react";
import { CornerDownRight } from "lucide-react";
import { useEiaTheme } from "@/components/eia/theme";
import { layoutFlow } from "@/lib/builder/flow/layout";
import { useFlowIssues } from "./issues";
import { TRIGGER_SELECTION_ID, useFlowBuilderStore } from "./store";
import { edgeTypes } from "./edges";
import { nodeTypes } from "./nodes";

const PRO_OPTIONS = { hideAttribution: true };
const FIT_VIEW_OPTIONS = { padding: 0.15, maxZoom: 0.9 };

function miniMapColor(n: Node): string {
  if (n.type === "trigger" || n.type === "placeholder" || n.type === "plus") {
    return "var(--ds-border-strong)";
  }
  if (n.type === "end") return "var(--ds-text-muted)";
  return "var(--ds-brand-primary)";
}

function ZoomIndicator() {
  const { zoom } = useViewport();
  return (
    <Panel
      position="bottom-left"
      className="!ml-14 rounded-md border border-border bg-card px-2 py-1 text-[11px] font-medium text-[var(--ds-text-secondary)] shadow-sm"
    >
      {Math.round(zoom * 100)}%
    </Panel>
  );
}

const noopNodesChange = () => {};

export default function FlowCanvas() {
  // colorMode do React Flow precisa seguir o tema do app: ele injeta a classe
  // dark/light no subtree do canvas, e os tokens --ds-* resolvem por ela.
  const { theme: resolvedTheme } = useEiaTheme();
  const flow = useFlowBuilderStore((s) => s.flow);
  const selectedStepId = useFlowBuilderStore((s) => s.selectedStepId);
  const pickingGotoId = useFlowBuilderStore((s) => s.pickingGotoId);

  // Animação de re-layout desabilitada no primeiro render (evita nós "voando" do 0,0)
  const [animated, setAnimated] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setAnimated(true), 600);
    return () => window.clearTimeout(t);
  }, []);

  // Atalhos: Esc fecha picker/cancela goto-pick; Cmd/Ctrl+Z desfaz;
  // Cmd/Ctrl+Shift+Z (e Ctrl+Y) refaz.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const typing =
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT" ||
        target.isContentEditable;
      const mod = (e.metaKey || e.ctrlKey) && !e.altKey;
      const key = e.key.toLowerCase();
      if (mod && !typing && key === "z") {
        e.preventDefault();
        if (e.shiftKey) useFlowBuilderStore.getState().redo();
        else useFlowBuilderStore.getState().undo();
      } else if (mod && !typing && !e.shiftKey && key === "y") {
        e.preventDefault();
        useFlowBuilderStore.getState().redo();
      }
      if (e.key === "Escape") {
        const st = useFlowBuilderStore.getState();
        st.closePicker();
        st.cancelGotoPick();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Árvore aninhada é a única fonte de verdade: nodes/edges 100% derivados
  const layout = useMemo(() => (flow ? layoutFlow(flow) : null), [flow]);

  // Pendências por passo (marca no card) e do gatilho (sem stepId)
  const issues = useFlowIssues();
  const issueByNode = useMemo(() => {
    const map = new Map<string, string>();
    for (const issue of issues) {
      const id = issue.stepId ?? TRIGGER_SELECTION_ID;
      if (!map.has(id)) map.set(id, issue.message);
    }
    return map;
  }, [issues]);

  const nodes = useMemo(
    () =>
      (layout?.nodes ?? []).map((n) => ({
        ...n,
        data: issueByNode.has(n.id) ? { ...n.data, issue: issueByNode.get(n.id) } : n.data,
        selected: n.id === selectedStepId,
        className:
          pickingGotoId && n.type === "step" && n.id !== pickingGotoId
            ? "pickable"
            : undefined,
      })) as Node[],
    [layout, selectedStepId, pickingGotoId, issueByNode]
  );

  const edges = useMemo(() => (layout?.edges ?? []) as unknown as Edge[], [layout]);

  const onNodeClick: NodeMouseHandler = useCallback((_, node) => {
    const st = useFlowBuilderStore.getState();
    if (st.pickingGotoId) {
      if (node.type === "step" && node.id !== st.pickingGotoId) {
        st.chooseGotoTarget(node.id);
      }
      return;
    }
    if (node.type === "step" || node.type === "end") st.select(node.id);
    if (node.type === "trigger") st.select(TRIGGER_SELECTION_ID);
  }, []);

  const onPaneClick = useCallback(() => {
    const st = useFlowBuilderStore.getState();
    st.select(null);
    st.closePicker();
    st.cancelGotoPick();
  }, []);

  if (!flow) return null;

  return (
    <div
      className={`dispara-canvas h-full w-full ${animated ? "animated" : ""} ${
        pickingGotoId ? "picking" : ""
      }`}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={noopNodesChange}
        onNodeClick={onNodeClick}
        onPaneClick={onPaneClick}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable
        edgesFocusable={false}
        zoomOnDoubleClick={false}
        deleteKeyCode={null}
        panOnDrag
        zoomOnScroll
        minZoom={0.2}
        maxZoom={2}
        fitView
        fitViewOptions={FIT_VIEW_OPTIONS}
        proOptions={PRO_OPTIONS}
        colorMode={resolvedTheme === "light" ? "light" : "dark"}
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1.5} color="var(--ds-border-default)" />
        <Controls position="bottom-left" showInteractive={false} />
        <ZoomIndicator />
        <MiniMap position="bottom-right" pannable zoomable nodeColor={miniMapColor} />
      </ReactFlow>
      {pickingGotoId && (
        <div className="pointer-events-none absolute top-4 left-1/2 z-40 -translate-x-1/2">
          <div className="flex items-center gap-2 rounded-full border border-violet-500/30 bg-violet-500/10 px-4 py-2 text-[13px] font-medium text-violet-600 shadow-md backdrop-blur legacy-dark:text-violet-300">
            <CornerDownRight size={14} />
            Clique em um passo para definir o destino do Go To — Esc cancela
          </div>
        </div>
      )}
    </div>
  );
}
