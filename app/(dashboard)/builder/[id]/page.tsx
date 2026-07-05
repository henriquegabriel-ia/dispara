"use client";

// Página fina do builder novo: hook (useWorkflowBuilder) + componentes de
// components/flow-builder/. O canvas entra via next/dynamic (ssr: false) —
// React Flow mede DOM no client.

import dynamic from "next/dynamic";
import { use } from "react";
import { Loader2 } from "lucide-react";
import ActionPicker from "@/components/flow-builder/ActionPicker";
import BuilderHeader from "@/components/flow-builder/BuilderHeader";
import ConfigPanel from "@/components/flow-builder/ConfigPanel";
import { useWorkflowBuilder } from "@/hooks/useWorkflowBuilder";

const FlowCanvas = dynamic(() => import("@/components/flow-builder/FlowCanvas"), {
  ssr: false,
  loading: () => <CanvasLoading />,
});

function CanvasLoading() {
  return (
    <div className="flex h-full w-full items-center justify-center">
      <Loader2 className="size-6 animate-spin text-slate-500" />
    </div>
  );
}

type BuilderPageProps = {
  params: Promise<{ id: string }>;
};

export default function BuilderPage({ params }: BuilderPageProps) {
  const { id } = use(params);
  const { isLoading, loadError, saveState, publishedVersion, publishing, publish } =
    useWorkflowBuilder(id);

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-background">
      <BuilderHeader
        saveState={saveState}
        publishedVersion={publishedVersion}
        publishing={publishing}
        onPublish={publish}
      />
      <div className="relative flex-1 overflow-hidden">
        {isLoading ? (
          <CanvasLoading />
        ) : loadError ? (
          <div className="flex h-full w-full items-center justify-center">
            <div className="rounded-lg border border-border bg-card p-8 text-center shadow-lg">
              <h1 className="mb-2 text-xl font-semibold text-slate-100">
                Não foi possível carregar o fluxo
              </h1>
              <p className="text-sm text-slate-400">
                Verifique a conexão e tente novamente.
              </p>
            </div>
          </div>
        ) : (
          <FlowCanvas />
        )}
        <ConfigPanel />
        <ActionPicker />
      </div>
    </div>
  );
}
