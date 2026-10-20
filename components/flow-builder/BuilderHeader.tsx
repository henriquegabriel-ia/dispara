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
import { EiaButton, EiaIconButton } from "@/components/eia";
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
        className="flex shrink-0 items-center gap-1 px-1 text-[12px] text-eia-muted"
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
        className="flex shrink-0 items-center gap-1 px-1 text-[12px] text-eia-danger"
        title="Erro ao salvar — tentando de novo"
      >
        <CircleAlert size={13} />
        <span className="hidden sm:inline">Erro ao salvar</span>
      </span>
    );
  }
  return (
    <span
      className="flex shrink-0 items-center gap-1 px-1 text-[12px] text-eia-muted"
      title="Salvo"
    >
      <Check size={13} className="text-eia-success" />
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
      <EiaButton
        variant="ghost"
        size="sm"
        className="rounded-full border border-eia-warning/40 bg-eia-warning-surface text-eia-warning"
        leadingIcon={<TriangleAlert size={12} />}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={`${label} para publicar`}
        title="O que falta para publicar"
      >
        {issues.length}
        <span className="hidden md:inline">
          {" "}
          {issues.length === 1 ? "pendência" : "pendências"}
        </span>
      </EiaButton>
      {open && (
        <div
          role="dialog"
          aria-label="Pendências do fluxo"
          className="absolute top-9 right-0 z-50 w-[min(20rem,calc(100vw-2rem))] overflow-hidden rounded-lg border border-eia-border bg-eia-raised shadow-lg"
        >
          <p className="border-b border-eia-border-subtle px-3 py-2 text-[12px] font-semibold text-eia-text">
            Corrija antes de publicar
          </p>
          <ul className="max-h-72 overflow-y-auto py-1">
            {issues.map((issue, i) => (
              <li key={`${issue.stepId ?? "flow"}-${i}`}>
                <EiaButton
                  variant="ghost"
                  size="sm"
                  className="h-auto w-full justify-start rounded-none px-3 py-2 text-left text-[12px] leading-snug font-normal whitespace-normal text-eia-muted"
                  leadingIcon={<TriangleAlert size={12} className="text-eia-warning" />}
                  onClick={() => {
                    setOpen(false);
                    useFlowBuilderStore
                      .getState()
                      .select(issue.stepId ?? TRIGGER_SELECTION_ID);
                  }}
                >
                  {issue.message}
                </EiaButton>
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
    <header className="z-40 flex h-14 shrink-0 items-center gap-2 border-b border-eia-border-subtle bg-eia-surface px-3 sm:gap-3 sm:px-4">
      <Link
        href="/workflows"
        className="flex shrink-0 items-center gap-1.5 text-[13px] text-eia-muted hover:text-eia-text"
        aria-label="Voltar para Workflows"
      >
        <ArrowLeft size={15} /> <span className="hidden sm:inline">Workflows</span>
      </Link>
      <div className="h-5 w-px shrink-0 bg-eia-border" />

      {editing ? (
        <input
          ref={inputRef}
          defaultValue={name}
          autoFocus
          className="w-full min-w-0 rounded-lg border border-eia-focus bg-transparent px-2 py-1 text-[13px] font-medium text-eia-text outline-none sm:w-[320px] sm:flex-none"
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
          <span className="max-w-[300px] min-w-0 truncate text-[13px] font-medium text-eia-text">
            {name || "Carregando…"}
          </span>
          <Pencil
            size={12}
            className="shrink-0 text-eia-muted group-hover:text-eia-text"
          />
        </button>
      )}

      {publishedVersion != null && (
        <span className="hidden shrink-0 rounded-full border border-eia-success/30 bg-eia-success-surface px-2 py-0.5 text-[11px] font-medium text-eia-success sm:inline">
          v{publishedVersion} publicada
        </span>
      )}

      {publishedVersion != null && hasUnpublishedChanges && (
        <span
          className="hidden shrink-0 rounded-full border border-eia-warning/30 bg-eia-warning-surface px-2 py-0.5 text-[11px] font-medium text-eia-warning lg:inline"
          title="As edições estão salvas, mas só entram no ar quando você publicar."
        >
          Alterações não publicadas
        </span>
      )}

      <div className="ml-auto flex shrink-0 items-center gap-1 sm:gap-2">
        <IssuesButton />
        <EiaIconButton
          label="Desfazer"
          size="sm"
          disabled={!canUndo}
          onClick={() => useFlowBuilderStore.getState().undo()}
          title="Desfazer (Cmd+Z)"
        >
          <Undo2 size={15} />
        </EiaIconButton>
        <EiaIconButton
          label="Refazer"
          size="sm"
          disabled={!canRedo}
          onClick={() => useFlowBuilderStore.getState().redo()}
          title="Refazer (Cmd+Shift+Z)"
        >
          <Redo2 size={15} />
        </EiaIconButton>
        <EiaIconButton
          label="Configurações do workflow"
          size="sm"
          onClick={onOpenSettings}
          title="Configurações do workflow"
        >
          <Settings2 size={15} />
        </EiaIconButton>

        <SaveIndicator state={saveState} />

        <span title="Em breve" className="hidden lg:inline-block">
          <EiaButton variant="secondary" size="sm" disabled>
            Testar workflow
          </EiaButton>
        </span>

        <EiaButton
          size="sm"
          onClick={onPublish}
          disabled={!hasFlow}
          loading={publishing}
          leadingIcon={<Rocket size={13} />}
        >
          {publishing ? "Publicando…" : "Publicar"}
        </EiaButton>
      </div>
    </header>
  );
}
