"use client";

// Controller hook do builder novo (padrão Page → Hook → Service → API):
//   - carrega o workflow por id (React Query + api.workflow.getById);
//     se version.tree existir usa a árvore, senão createEmptyFlow().
//   - injeta no zustand store (components/flow-builder/store.ts).
//   - autosave: debounce 1s para config/nome, flush imediato para operações
//     estruturais; cada save envia { name, tree, nodes, edges } com
//     nodes/edges = compileFlow(tree). Se compileFlow lançar (ex.: passo vazio,
//     tipo não suportado), salva a tree mantendo os nodes/edges anteriores; as
//     pendências aparecem na tela (components/flow-builder/issues.ts), sem toast.
//   - saves enfileirados (um PATCH por vez, o último estado vence), retry após
//     erro, aviso ao fechar a aba com edição pendente; a carga espera o save do
//     unmount anterior e não reaproveita cache (gcTime 0).
//   - publish: bloqueia com pendências, flusha o save e chama a rota real.

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "@/lib/toast";
import type { SaveState } from "@/components/flow-builder/BuilderHeader";
import { collectFlowIssues } from "@/components/flow-builder/issues";
import {
  TRIGGER_SELECTION_ID,
  useFlowBuilderStore,
} from "@/components/flow-builder/store";
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
  const queryClient = useQueryClient();
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
  /** há mudança debounced ainda não enviada — flush no unmount */
  const dirtyRef = useRef(false);
  /** save no ar (um por vez) e o próximo da fila (sempre com o estado mais novo) */
  const inFlightRef = useRef<Promise<boolean> | null>(null);
  const queuedRef = useRef<{ flow: Flow; promise: Promise<boolean> } | null>(null);
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
  /** Grava UM snapshot da árvore (capturado por quem enfileirou). */
  const runSave = useCallback(
    async (flow: Flow): Promise<boolean> => {
      setSaveState("saving");

      let nodes = lastGraphRef.current?.nodes ?? [];
      let edges = lastGraphRef.current?.edges ?? [];
      try {
        const compiled = compileFlow(flow);
        nodes = compiled.nodes as WorkflowNode[];
        edges = compiled.edges as WorkflowEdge[];
        lastGraphRef.current = { nodes, edges };
      } catch (error) {
        // A árvore é salva mesmo assim (rascunho) com o último grafo bom. Sem
        // toast: as pendências aparecem no header/canvas (useFlowIssues) e o
        // Publicar as lista — um toast a cada passo novo cobria o painel.
        if (!(error instanceof FlowCompileError)) {
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
        // Gravou o estado atual da tela: nada mais a re-tentar.
        if (useFlowBuilderStore.getState().flow === flow) {
          dirtyRef.current = false;
          if (retryTimerRef.current) {
            clearTimeout(retryTimerRef.current);
            retryTimerRef.current = null;
          }
        }
        // Há edição mais nova (debounce ou save na fila): o indicador fica com
        // o save seguinte.
        if (!dirtyRef.current && !queuedRef.current) setSaveState("saved");
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
    },
    [workflowId]
  );

  /**
   * Enfileira um save: nunca dois PATCH simultâneos (fora de ordem). O flow é
   * capturado AGORA (o flush do unmount roda antes do reset do store); sem
   * save no ar o PATCH sai na hora, senão fica UM na fila com o estado mais
   * novo (saves seguintes só atualizam o snapshot da fila).
   */
  const doSave = useCallback((): Promise<boolean> => {
    const flow = useFlowBuilderStore.getState().flow;
    if (!flow) return Promise.resolve(false);
    dirtyRef.current = false;

    const start = (snapshot: Flow): Promise<boolean> => {
      const running = runSave(snapshot);
      inFlightRef.current = running;
      pendingSaves.set(workflowId, running);
      void running.finally(() => {
        if (inFlightRef.current === running) inFlightRef.current = null;
        if (pendingSaves.get(workflowId) === running) pendingSaves.delete(workflowId);
      });
      return running;
    };

    const inFlight = inFlightRef.current;
    if (!inFlight) return start(flow);

    const queued = queuedRef.current;
    if (queued) {
      queued.flow = flow;
      return queued.promise;
    }
    const entry: { flow: Flow; promise: Promise<boolean> } = {
      flow,
      promise: Promise.resolve(false),
    };
    entry.promise = inFlight
      .catch(() => false)
      .then(() => {
        if (queuedRef.current === entry) queuedRef.current = null;
        return start(entry.flow);
      });
    queuedRef.current = entry;
    pendingSaves.set(workflowId, entry.promise);
    return entry.promise;
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
      // Sem cache entre montagens: o gcTime 0 só coleta depois de um tick, e
      // voltar ao builder antes disso mostraria a árvore velha.
      queryClient.removeQueries({ queryKey: ["builder-workflow", workflowId], exact: true });
      // A lista (/workflows) mostra nome/status/versão: o que mudou aqui vale lá.
      void queryClient.invalidateQueries({ queryKey: ["builder-workflows"] });
    },
    [workflowId, doSave, queryClient]
  );

  // ── Publish ───────────────────────────────────────────────────────────────
  const publish = useCallback(async () => {
    const flow = useFlowBuilderStore.getState().flow;
    if (!flow || publishing) return;

    // Publicar exige fluxo sem pendências (lint + compile) — melhor errar aqui
    // do que publicar um grafo velho ou um fluxo que nunca dispara. A lista
    // completa fica no header ("N pendências"); o passo da primeira é aberto.
    const issues = collectFlowIssues(flow);
    if (issues.length > 0) {
      const [first] = issues;
      toast.error("Corrija o fluxo antes de publicar", {
        description:
          issues.length > 1
            ? `${first.message} (+${issues.length - 1} ${issues.length === 2 ? "pendência" : "pendências"})`
            : first.message,
      });
      useFlowBuilderStore
        .getState()
        .select(first.stepId ?? TRIGGER_SELECTION_ID);
      return;
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
