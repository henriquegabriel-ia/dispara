"use client";

// Controller hook do builder novo (padrão Page → Hook → Service → API):
//   - carrega o workflow por id (React Query + api.workflow.getById);
//     se version.tree existir usa a árvore, senão createEmptyFlow().
//   - injeta no zustand store (components/flow-builder/store.ts).
//   - autosave: debounce 1s para config/nome, flush imediato para operações
//     estruturais; cada save envia { name, tree, nodes, edges } com
//     nodes/edges = compileFlow(tree). Se compileFlow lançar FlowCompileError
//     (ex.: passo vazio, tipo não suportado), salva só a tree mantendo os
//     nodes/edges anteriores e mostra aviso não-bloqueante.
//   - publish: compila (bloqueia se inválido), flusha o save e chama a rota real.

import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "@/lib/toast";
import type { SaveState } from "@/components/flow-builder/BuilderHeader";
import { useFlowBuilderStore } from "@/components/flow-builder/store";
import { api } from "@/lib/builder/api-client";
import { compileFlow, FlowCompileError } from "@/lib/builder/flow/compile";
import { createEmptyFlow } from "@/lib/builder/flow/operations";
import type { Flow } from "@/lib/builder/flow/types";
import type { WorkflowEdge, WorkflowNode } from "@/lib/builder/graph-types";

const AUTOSAVE_DEBOUNCE_MS = 1000;
const SAVE_RETRY_MS = 5000;

/**
 * Saves em andamento por workflow, fora do ciclo de vida do componente: ao sair
 * do builder o flush do unmount ainda está no ar quando a pessoa volta, e a
 * carga precisa esperar por ele — senão traz a árvore velha e o autosave
 * seguinte grava por cima do que acabou de ser salvo.
 */
const pendingSaves = new Map<string, Promise<unknown>>();

async function loadWorkflowAfterPendingSave(workflowId: string) {
  const pending = pendingSaves.get(workflowId);
  if (pending) await pending.catch(() => undefined);
  return api.workflow.getById(workflowId);
}

function isFlowTree(tree: unknown): tree is Flow {
  return (
    typeof tree === "object" &&
    tree !== null &&
    (tree as { schemaVersion?: unknown }).schemaVersion === 1 &&
    typeof (tree as { trigger?: unknown }).trigger === "object"
  );
}

export function useWorkflowBuilder(workflowId: string) {
  const workflowQuery = useQuery({
    queryKey: ["builder-workflow", workflowId],
    queryFn: () => loadWorkflowAfterPendingSave(workflowId),
    refetchOnWindowFocus: false,
    // A árvore só é lida na montagem; o cache não pode sobreviver à saída do
    // builder (ver pendingSaves).
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: "always",
    retry: 1,
  });

  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [publishedVersion, setPublishedVersion] = useState<number | null>(null);
  const [hasUnpublishedChanges, setHasUnpublishedChanges] = useState(false);
  const [publishing, setPublishing] = useState(false);

  // Último grafo compilado com sucesso — fallback quando a árvore atual não compila.
  const lastGraphRef = useRef<{ nodes: WorkflowNode[]; edges: WorkflowEdge[] } | null>(
    null
  );
  const loadedRef = useRef<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastCompileWarningRef = useRef<string | null>(null);
  /** há mudança debounced ainda não enviada — flush no unmount */
  const dirtyRef = useRef(false);
  /** fila de saves: um por vez, na ordem (o último estado sempre vence) */
  const saveChainRef = useRef<Promise<boolean>>(Promise.resolve(true));
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Carga inicial → injeta no store ──────────────────────────────────────
  useEffect(() => {
    const wf = workflowQuery.data;
    if (!wf || loadedRef.current === workflowId) return;
    lastGraphRef.current = { nodes: wf.nodes ?? [], edges: wf.edges ?? [] };
    setPublishedVersion(wf.lastPublishedVersion ?? null);
    setHasUnpublishedChanges(Boolean(wf.hasUnpublishedChanges));

    const tree = isFlowTree(wf.tree)
      ? wf.tree
      : createEmptyFlow({ id: workflowId, name: wf.name });
    // O nome do registro (tabela workflows) é o canônico.
    useFlowBuilderStore.getState().loadFlow({ ...tree, name: wf.name || tree.name });
    loadedRef.current = workflowId;
    setSaveState("idle");
  }, [workflowQuery.data, workflowId]);

  // ── Save ──────────────────────────────────────────────────────────────────
  const runSave = useCallback(async (): Promise<boolean> => {
    const flow = useFlowBuilderStore.getState().flow;
    if (!flow) return false;
    dirtyRef.current = false;
    setSaveState("saving");

    let nodes = lastGraphRef.current?.nodes ?? [];
    let edges = lastGraphRef.current?.edges ?? [];
    try {
      const compiled = compileFlow(flow);
      nodes = compiled.nodes as WorkflowNode[];
      edges = compiled.edges as WorkflowEdge[];
      lastGraphRef.current = { nodes, edges };
      lastCompileWarningRef.current = null;
    } catch (error) {
      if (error instanceof FlowCompileError) {
        // Aviso não-bloqueante (deduplicado): a árvore é salva mesmo assim.
        if (lastCompileWarningRef.current !== error.message) {
          lastCompileWarningRef.current = error.message;
          toast.warning("Fluxo salvo como rascunho", {
            description: error.message,
          });
        }
      } else {
        // Erro inesperado no compile: salva só a árvore com o último grafo bom.
        console.error("Falha ao compilar o fluxo:", error);
      }
    }

    try {
      const saved = await api.workflow.update(workflowId, {
        name: flow.name,
        tree: flow,
        nodes,
        edges,
      });
      if (saved && typeof saved === "object" && "hasUnpublishedChanges" in saved) {
        setHasUnpublishedChanges(Boolean(saved.hasUnpublishedChanges));
      }
      // Houve nova edição enquanto este save estava no ar: o indicador fica
      // com o save seguinte.
      if (!dirtyRef.current) setSaveState("saved");
      return true;
    } catch (error) {
      console.error("Falha ao salvar o fluxo:", error);
      // Continua sujo: o unmount/sair da aba re-tenta, e há um retry automático.
      dirtyRef.current = true;
      setSaveState("error");
      toast.error("Falha ao salvar o fluxo", {
        description: "Vamos tentar de novo em instantes.",
        id: `builder-save-error-${workflowId}`,
      });
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
      retryTimerRef.current = setTimeout(() => {
        retryTimerRef.current = null;
        if (dirtyRef.current) void doSaveRef.current();
      }, SAVE_RETRY_MS);
      return false;
    }
  }, [workflowId]);

  /** Enfileira um save (nunca dois PATCH simultâneos fora de ordem). */
  const doSave = useCallback((): Promise<boolean> => {
    const next = saveChainRef.current.catch(() => false).then(() => runSave());
    saveChainRef.current = next;
    pendingSaves.set(workflowId, next);
    void next.finally(() => {
      if (pendingSaves.get(workflowId) === next) pendingSaves.delete(workflowId);
    });
    return next;
  }, [runSave, workflowId]);
  const doSaveRef = useRef(doSave);
  useEffect(() => {
    doSaveRef.current = doSave;
  }, [doSave]);

  // Fechar/recarregar a aba com edição não salva: avisa (o navegador não
  // espera um PATCH assíncrono terminar).
  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirtyRef.current && !pendingSaves.has(workflowId)) return;
      if (dirtyRef.current) void doSave();
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [workflowId, doSave]);

  // ── Autosave: observa mutações do store (rev) ────────────────────────────
  const rev = useFlowBuilderStore((s) => s.rev);
  const saveMode = useFlowBuilderStore((s) => s.saveMode);

  useEffect(() => {
    if (rev === 0 || loadedRef.current !== workflowId) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    if (saveMode === "structural") {
      void doSave();
      return;
    }
    dirtyRef.current = true;
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      void doSave();
    }, AUTOSAVE_DEBOUNCE_MS);
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [rev, saveMode, workflowId, doSave]);

  // Reset do store ao desmontar / trocar de workflow — flusha save pendente
  // antes (doSave captura o flow de forma síncrona, antes do reset).
  useEffect(
    () => () => {
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
      if (dirtyRef.current) void doSave();
      useFlowBuilderStore.getState().reset();
      loadedRef.current = null;
    },
    [workflowId, doSave]
  );

  // ── Publish ───────────────────────────────────────────────────────────────
  const publish = useCallback(async () => {
    const flow = useFlowBuilderStore.getState().flow;
    if (!flow || publishing) return;

    // Publicar exige árvore compilável — melhor errar aqui do que publicar grafo velho.
    try {
      compileFlow(flow);
    } catch (error) {
      if (error instanceof FlowCompileError) {
        toast.error("Corrija o fluxo antes de publicar", {
          description: error.message,
        });
        return;
      }
      throw error;
    }

    setPublishing(true);
    try {
      // Flusha qualquer save pendente para publicar o estado atual.
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      const saved = await doSave();
      if (!saved) return;
      const result = await api.workflow.publish(workflowId);
      setPublishedVersion(result.version);
      setHasUnpublishedChanges(false);
      toast.success(`Fluxo publicado (v${result.version})`);
    } catch (error) {
      console.error("Falha ao publicar o fluxo:", error);
      toast.error("Falha ao publicar o fluxo");
    } finally {
      setPublishing(false);
    }
  }, [workflowId, publishing, doSave]);

  return {
    isLoading: workflowQuery.isLoading,
    loadError: workflowQuery.error,
    saveState,
    publishedVersion,
    /** há edições salvas que ainda não estão no ar */
    hasUnpublishedChanges,
    publishing,
    publish,
    /** settings do workflow (workflows.settings) — editadas na sheet própria */
    settings: workflowQuery.data?.settings ?? {},
  };
}
