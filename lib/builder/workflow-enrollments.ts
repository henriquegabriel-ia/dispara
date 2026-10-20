import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Enrollments — estado durável de um contato dentro de um fluxo, para waits (Delay).
 *
 * Fase D da migração QStash→pg_cron. O executor, ao encontrar um Delay, pausa e devolve
 * o ponto de continuação (resumeNodeIds multi-head + outputs + variables + resolved_nodes);
 * a BORDA (rota /execute ou o cron drain) persiste aqui o enrollment com resume_at. O
 * relógio (pg_cron → /api/cron/tick) drena os vencidos e retoma a execução re-hidratando
 * resolved_nodes (anti-double-send) e outputs ({{@node}} a montante do Delay).
 */

export const MAX_ENROLLMENT_ATTEMPTS = 5;

/**
 * Tipo da espera (workflow_enrollments.wait_kind):
 *   - "delay":  passo Aguardar — o único que o Stop on Response cancela;
 *   - "window": pausa fora da janela de horário (settings.timeWindow);
 *   - "enroll": inscrição manual ainda não iniciada (pontapé do /enroll).
 */
export type EnrollmentWaitKind = "delay" | "window" | "enroll";

export type EnrollmentRow = {
  id: string;
  workflow_id: string;
  version_id: string;
  phone: string;
  contact_id: string | null;
  status: string;
  wait_kind: string | null;
  current_node_id: string | null;
  resume_node_ids: string[] | null;
  resume_at: string | null;
  variables: Record<string, unknown> | null;
  resolved_nodes: string[] | null;
  outputs: Record<string, unknown> | null;
  run_id: string | null;
  attempts: number;
};

export type DelayWaitParams = {
  workflowId: string;
  versionId: string;
  phone: string;
  contactId?: string | null;
  runId?: string | null;
  resumeNodeIds: string[];
  resumeAt: string; // ISO
  variables: Record<string, unknown>;
  resolvedNodeIds: string[];
  outputs: Record<string, unknown>;
  waitKind?: EnrollmentWaitKind;
};

function delayPayload(params: DelayWaitParams) {
  return {
    status: "waiting",
    wait_kind: params.waitKind ?? "delay",
    current_node_id: params.resumeNodeIds[0] ?? null,
    resume_node_ids: params.resumeNodeIds,
    resume_at: params.resumeAt,
    variables: params.variables,
    resolved_nodes: params.resolvedNodeIds,
    outputs: params.outputs,
    run_id: params.runId ?? null,
    locked_at: null,
    locked_by: null,
    updated_at: new Date().toISOString(),
  };
}

/**
 * Persiste (ou atualiza) o enrollment quando o executor pausa por Delay.
 *
 * Idempotente e seguro sob concorrência: só toca linhas 'waiting' (nunca 'active', que
 * está sendo processada pelo drain), e trata a violação do índice único parcial
 * (23505 — duas pausas concorrentes pro mesmo contato) sem propagar erro.
 *
 * Retorna se a espera ficou GRAVADA. false = nada persistido (erro do banco ou
 * conflito com um enrollment 'active'): quem chama não pode deixar a run
 * "waiting" — o contato nunca seria retomado.
 */
export async function persistDelayWait(
  supabase: SupabaseClient,
  params: DelayWaitParams
): Promise<boolean> {
  const shared = delayPayload(params);

  const { data: existing, error: lookupError } = await supabase
    .from("workflow_enrollments")
    .select("id")
    .eq("workflow_id", params.workflowId)
    .eq("phone", params.phone)
    .eq("status", "waiting")
    .maybeSingle();
  if (lookupError) {
    console.error("[workflow-enrollments] Falha ao ler a espera existente:", lookupError.message);
    return false;
  }

  if (existing) {
    const { data: updated, error: updateError } = await supabase
      .from("workflow_enrollments")
      .update(shared)
      .eq("id", (existing as { id: string }).id)
      .eq("status", "waiting") // CAS: não rouba linha que o drain acabou de claimar
      .select("id");
    if (updateError) {
      console.error("[workflow-enrollments] Falha ao atualizar a espera:", updateError.message);
      return false;
    }
    return Array.isArray(updated) && updated.length > 0;
  }

  const now = new Date().toISOString();
  const { error } = await supabase.from("workflow_enrollments").insert({
    workflow_id: params.workflowId,
    version_id: params.versionId,
    phone: params.phone,
    contact_id: params.contactId ?? null,
    created_at: now,
    ...shared,
  });

  if (error) {
    console.error("[workflow-enrollments] Falha ao gravar a espera:", error.message);
    // Provável 23505 (unique parcial): outra pausa concorrente já criou/está ativa.
    // Best-effort: atualiza só se ainda houver uma linha 'waiting' (não pisa em 'active').
    const { data: updated } = await supabase
      .from("workflow_enrollments")
      .update(shared)
      .eq("workflow_id", params.workflowId)
      .eq("phone", params.phone)
      .eq("status", "waiting")
      .select("id");
    return Array.isArray(updated) && updated.length > 0;
  }
  return true;
}

/**
 * Claim atômico dos enrollments vencidos (cron drain). Para cada candidato, faz um CAS
 * waiting→active (só um worker ganha) incrementando attempts. Retorna os claimados.
 */
export async function claimDueEnrollments(
  supabase: SupabaseClient,
  workerId: string,
  limit = 25
): Promise<EnrollmentRow[]> {
  const nowIso = new Date().toISOString();

  const { data: candidates } = await supabase
    .from("workflow_enrollments")
    .select("id, attempts")
    .eq("status", "waiting")
    .lte("resume_at", nowIso)
    .order("resume_at", { ascending: true })
    .limit(limit);

  const claimed: EnrollmentRow[] = [];
  for (const c of candidates || []) {
    const row = c as { id: string; attempts: number | null };
    const { data: won } = await supabase
      .from("workflow_enrollments")
      .update({
        status: "active",
        locked_at: nowIso,
        locked_by: workerId,
        attempts: (row.attempts ?? 0) + 1,
        updated_at: nowIso,
      })
      .eq("id", row.id)
      .eq("status", "waiting")
      .select("*")
      .maybeSingle();
    if (won) claimed.push(won as EnrollmentRow);
  }
  return claimed;
}

/**
 * Devolve à fila enrollments 'active' presos (worker morreu no meio). Reaper.
 * A janela (padrão 20min) deve ser > 2x maxDuration (300s) pra nunca devolver um worker
 * vivo — invariante que o teste documenta.
 */
export async function reapStuckEnrollments(
  supabase: SupabaseClient,
  olderThanMs = 20 * 60 * 1000
): Promise<number> {
  const cutoffIso = new Date(Date.now() - olderThanMs).toISOString();
  const { data } = await supabase
    .from("workflow_enrollments")
    .update({ status: "waiting", locked_at: null, locked_by: null })
    .eq("status", "active")
    .lt("locked_at", cutoffIso)
    .select("id");
  return (data || []).length;
}

/**
 * Enrollment retomado encontrou OUTRO Delay (ou a janela de horário): reagenda o
 * mesmo enrollment. A retomada deu certo, então as tentativas ZERAM — attempts
 * mede só falhas consecutivas da mesma retomada (anti-poison), não quantas
 * esperas o fluxo tem.
 *
 * CAS em 'active': se o contato respondeu durante a retomada e o Stop on Response
 * cancelou o enrollment, ele NÃO volta para a fila. Retorna se reagendou.
 */
export async function rescheduleEnrollment(
  supabase: SupabaseClient,
  id: string,
  params: {
    resumeNodeIds: string[];
    resumeAt: string;
    variables: Record<string, unknown>;
    resolvedNodeIds: string[];
    outputs: Record<string, unknown>;
    waitKind?: EnrollmentWaitKind;
    /** run que pausou agora (a próxima retomada o finaliza) */
    runId?: string | null;
  }
): Promise<boolean> {
  const { data } = await supabase
    .from("workflow_enrollments")
    .update({
      status: "waiting",
      wait_kind: params.waitKind ?? "delay",
      current_node_id: params.resumeNodeIds[0] ?? null,
      resume_node_ids: params.resumeNodeIds,
      resume_at: params.resumeAt,
      variables: params.variables,
      resolved_nodes: params.resolvedNodeIds,
      outputs: params.outputs,
      attempts: 0,
      ...(params.runId !== undefined ? { run_id: params.runId } : {}),
      locked_at: null,
      locked_by: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("status", "active")
    .select("id");
  return Array.isArray(data) && data.length > 0;
}

/** Backoff: erro transitório no drain → reagenda pro futuro em vez de falhar em definitivo. */
export async function backoffEnrollment(
  supabase: SupabaseClient,
  id: string,
  attempts: number,
  error: unknown
): Promise<void> {
  const delayMs = Math.min(30 * 60 * 1000, 60 * 1000 * 2 ** attempts); // 2,4,8… min, cap 30min
  await supabase
    .from("workflow_enrollments")
    .update({
      status: "waiting",
      resume_at: new Date(Date.now() + delayMs).toISOString(),
      last_error: String(error).slice(0, 500),
      locked_at: null,
      locked_by: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("status", "active"); // não ressuscita um enrollment cancelado
}

export async function completeEnrollment(
  supabase: SupabaseClient,
  id: string
): Promise<void> {
  await supabase
    .from("workflow_enrollments")
    .update({
      status: "completed",
      locked_at: null,
      locked_by: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("status", "active"); // cancelado no meio (Stop on Response) continua cancelado
}

/** Encerra sem executar (contato com opt-out/supressão, fluxo sem versão publicada). */
export async function cancelEnrollment(
  supabase: SupabaseClient,
  id: string,
  reason: string
): Promise<void> {
  await supabase
    .from("workflow_enrollments")
    .update({
      status: "cancelled",
      last_error: reason.slice(0, 500),
      locked_at: null,
      locked_by: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
}

export async function failEnrollment(
  supabase: SupabaseClient,
  id: string,
  error: unknown
): Promise<void> {
  await supabase
    .from("workflow_enrollments")
    .update({
      status: "failed",
      last_error: String(error).slice(0, 500),
      locked_at: null,
      locked_by: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
}
