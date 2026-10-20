"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Check,
  CircleAlert,
  Loader2,
  Pencil,
  Redo2,
  Rocket,
  Settings2,
  TriangleAlert,
  Undo2,
} from "lucide-react";
import { useFlowIssues } from "./issues";
import { TRIGGER_SELECTION_ID, useFlowBuilderStore } from "./store";

export type SaveState = "idle" | "saving" | "saved" | "error";

interface BuilderHeaderProps {
  saveState: SaveState;
  publishedVersion: number | null;
  /** há edições salvas que ainda não estão no ar */
  hasUnpublishedChanges?: boolean;
  publishing: boolean;
  onPublish: () => void;
  onOpenSettings: () => void;
}

// No mobile (<sm) o indicador fica só com o ícone; o texto vai no title.
function SaveIndicator({ state }: { state: SaveState }) {
  if (state === "saving") {
    return (
      <span
        className="flex shrink-0 items-center gap-1 px-1 text-[12px] text-[var(--ds-text-secondary)]"
        title="Salvando…"
      >
        <Loader2 size={13} className="animate-spin" />
        <span className="hidden sm:inline">Salvando…</span>
      </span>
    );
  }
  if (state === "error") {
    return (
      <span
        className="flex shrink-0 items-center gap-1 px-1 text-[12px] text-red-600 legacy-dark:text-red-400"
        title="Erro ao salvar — tentando de novo"
      >
        <CircleAlert size={13} />
        <span className="hidden sm:inline">Erro ao salvar</span>
      </span>
    );
  }
  return (
    <span
      className="flex shrink-0 items-center gap-1 px-1 text-[12px] text-[var(--ds-text-muted)]"
      title="Salvo"
    >
      <Check size={13} className="text-primary-500" />
      <span className="hidden sm:inline">Salvo</span>
    </span>
  );
}

/**
 * "N pendências": o que impede o Publicar (lintFlow + compile). Clicar num item
 * abre o passo (ou o gatilho) no painel.
 */
function IssuesButton() {
  const issues = useFlowIssues();
  const hasFlow = useFlowBuilderStore((s) => s.flow !== null);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!hasFlow || issues.length === 0) return null;
  const label = `${issues.length} ${issues.length === 1 ? "pendência" : "pendências"}`;

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        className="flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-700 hover:bg-amber-500/20 legacy-dark:text-amber-300"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={`${label} para publicar`}
        title="O que falta para publicar"
      >
        <TriangleAlert size={12} />
        <span>{issues.length}</span>
        <span className="hidden md:inline">{issues.length === 1 ? "pendência" : "pendências"}</span>
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="Pendências do fluxo"
          className="absolute top-8 right-0 z-50 w-[min(20rem,calc(100vw-2rem))] overflow-hidden rounded-lg border border-border bg-popover shadow-lg"
        >
          <p className="border-b border-border px-3 py-2 text-[12px] font-semibold text-[var(--ds-text-primary)]">
            Corrija antes de publicar
          </p>
          <ul className="max-h-72 overflow-y-auto py-1">
            {issues.map((issue, i) => (
              <li key={`${issue.stepId ?? "flow"}-${i}`}>
                <button
                  type="button"
                  className="flex w-full items-start gap-2 px-3 py-2 text-left text-[12px] leading-snug text-[var(--ds-text-secondary)] hover:bg-[var(--ds-bg-hover)]"
                  onClick={() => {
                    setOpen(false);
                    useFlowBuilderStore
                      .getState()
                      .select(issue.stepId ?? TRIGGER_SELECTION_ID);
                  }}
                >
                  <TriangleAlert size={12} className="mt-0.5 shrink-0 text-amber-500" />
                  <span>{issue.message}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default function BuilderHeader({
  saveState,
  publishedVersion,
  hasUnpublishedChanges = false,
  publishing,
  onPublish,
  onOpenSettings,
}: BuilderHeaderProps) {
  const name = useFlowBuilderStore((s) => s.flow?.name ?? "");
  const canUndo = useFlowBuilderStore((s) => s.past.length > 0);
  const canRedo = useFlowBuilderStore((s) => s.future.length > 0);
  const hasFlow = useFlowBuilderStore((s) => s.flow !== null);
  const [editing, setEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const commit = () => {
    const value = inputRef.current?.value.trim();
    if (value && value !== name) useFlowBuilderStore.getState().renameFlow(value);
    setEditing(false);
  };

  return (
    // Abaixo de sm: textos secundários viram ícones e o nome encolhe (min-w-0),
    // para "Publicar" sempre caber na tela (mobile-builder).
    <header className="z-40 flex h-14 shrink-0 items-center gap-2 border-b border-border bg-card px-3 sm:gap-3 sm:px-4">
      <Link
        href="/workflows"
        className="flex shrink-0 items-center gap-1.5 text-[13px] text-[var(--ds-text-secondary)] hover:text-[var(--ds-text-primary)]"
        aria-label="Voltar para Workflows"
      >
        <ArrowLeft size={15} /> <span className="hidden sm:inline">Workflows</span>
      </Link>
      <div className="h-5 w-px shrink-0 bg-border" />

      {editing ? (
        <input
          ref={inputRef}
          defaultValue={name}
          autoFocus
          className="w-full min-w-0 rounded-lg border border-primary-500 bg-transparent px-2 py-1 text-[13px] font-medium text-[var(--ds-text-primary)] outline-none sm:w-[320px] sm:flex-none"
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") setEditing(false);
          }}
        />
      ) : (
        <button
          type="button"
          className="group flex min-w-[3rem] items-center gap-1.5 overflow-hidden"
          onClick={() => hasFlow && setEditing(true)}
          title={name}
        >
          <span className="max-w-[300px] min-w-0 truncate text-[13px] font-medium text-[var(--ds-text-primary)]">
            {name || "Carregando…"}
          </span>
          <Pencil
            size={12}
            className="shrink-0 text-[var(--ds-text-muted)] group-hover:text-[var(--ds-text-secondary)]"
          />
        </button>
      )}

      {publishedVersion != null && (
        <span className="hidden shrink-0 rounded-full border border-primary-500/30 bg-primary-500/10 px-2 py-0.5 text-[11px] font-medium text-primary-600 sm:inline legacy-dark:text-primary-400">
          v{publishedVersion} publicada
        </span>
      )}

      {publishedVersion != null && hasUnpublishedChanges && (
        <span
          className="hidden shrink-0 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-700 lg:inline legacy-dark:text-amber-300"
          title="As edições estão salvas, mas só entram no ar quando você publicar."
        >
          Alterações não publicadas
        </span>
      )}

      <div className="ml-auto flex shrink-0 items-center gap-1 sm:gap-2">
        <IssuesButton />
        <button
          type="button"
          className="rounded p-1.5 text-[var(--ds-text-secondary)] hover:bg-[var(--ds-bg-hover)] hover:text-[var(--ds-text-primary)] disabled:opacity-30"
          disabled={!canUndo}
          onClick={() => useFlowBuilderStore.getState().undo()}
          title="Desfazer (Cmd+Z)"
          aria-label="Desfazer"
        >
          <Undo2 size={15} />
        </button>
        <button
          type="button"
          className="rounded p-1.5 text-[var(--ds-text-secondary)] hover:bg-[var(--ds-bg-hover)] hover:text-[var(--ds-text-primary)] disabled:opacity-30"
          disabled={!canRedo}
          onClick={() => useFlowBuilderStore.getState().redo()}
          title="Refazer (Cmd+Shift+Z)"
          aria-label="Refazer"
        >
          <Redo2 size={15} />
        </button>
        <button
          type="button"
          className="rounded p-1.5 text-[var(--ds-text-secondary)] hover:bg-[var(--ds-bg-hover)] hover:text-[var(--ds-text-primary)]"
          onClick={onOpenSettings}
          title="Configurações do workflow"
          aria-label="Configurações do workflow"
        >
          <Settings2 size={15} />
        </button>

        <SaveIndicator state={saveState} />

        <span title="Em breve" className="hidden lg:inline-block">
          <button
            type="button"
            className="cursor-not-allowed rounded-lg border border-border px-3 py-1.5 text-[13px] text-[var(--ds-text-muted)] opacity-60"
            disabled
          >
            Testar workflow
          </button>
        </span>

        <button
          type="button"
          className="flex items-center gap-1.5 rounded-lg bg-primary-500 px-3 py-1.5 text-[13px] font-medium text-white shadow-sm hover:bg-primary-600 disabled:cursor-not-allowed disabled:opacity-50 sm:px-3.5"
          onClick={onPublish}
          disabled={publishing || !hasFlow}
        >
          {publishing ? (
            <Loader2 size={13} className="animate-spin" />
          ) : (
            <Rocket size={13} />
          )}
          {publishing ? "Publicando…" : "Publicar"}
        </button>
      </div>
    </header>
  );
}
