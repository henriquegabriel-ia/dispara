import "server-only";

import { nanoid } from "nanoid";
import type { SupabaseClient } from "@supabase/supabase-js";
import { phoneLookupVariants } from "@/lib/builder/phone-variants";

/**
 * Perguntas pendentes ("Perguntar" / ask-question) — workflow_conversations.
 *
 * Ciclo de status: waiting → processing (claim atômico do /resume) → completed.
 * Pergunta superada por outra do MESMO fluxo para o mesmo contato, ou encerrada
 * por opt-out / palavra-chave de outro fluxo → cancelled.
 */
export type ConversationStatus = "waiting" | "processing" | "completed" | "cancelled";

export type ConversationState = {
  id: string;
  workflow_id: string;
  phone: string;
  status: ConversationStatus;
  resume_node_id?: string | null;
  variable_key?: string | null;
  variables?: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};

/** Variantes do telefone (bug do 9 / "+"); se não houver dígitos, o valor cru. */
function phoneVariantsOrSelf(phone: string): string[] {
  const variants = phoneLookupVariants(phone);
  return variants.length > 0 ? variants : [phone];
}

export async function createConversation(params: {
  supabase: SupabaseClient;
  workflowId: string;
  phone: string;
  resumeNodeId?: string | null;
  variableKey?: string | null;
  variables?: Record<string, unknown> | null;
}): Promise<ConversationState | null> {
  const now = new Date().toISOString();
  const id = nanoid();

  // Uma pergunta pendente por contato + fluxo: a nova supera as anteriores do
  // mesmo fluxo (ex.: dois gatilhos rápidos). Sem isso a pergunta antiga ficaria
  // órfã e capturaria a próxima mensagem do contato.
  await params.supabase
    .from("workflow_conversations")
    .update({ status: "cancelled", updated_at: now })
    .eq("workflow_id", params.workflowId)
    .in("phone", phoneVariantsOrSelf(params.phone))
    .eq("status", "waiting");

  const { data, error } = await params.supabase
    .from("workflow_conversations")
    .insert({
      id,
      workflow_id: params.workflowId,
      phone: params.phone,
      status: "waiting",
      resume_node_id: params.resumeNodeId ?? null,
      variable_key: params.variableKey ?? null,
      variables: params.variables ?? null,
      created_at: now,
      updated_at: now,
    })
    .select("*")
    .single();

  if (error || !data) {
    return null;
  }
  return data as ConversationState;
}

/**
 * Pergunta pendente mais recente do contato (de qualquer fluxo). Casa as
 * variantes do telefone: a conversa gravada com o 9 é achada pelo wa_id legado
 * sem o 9 (e vice-versa), com ou sem "+".
 */
export async function getPendingConversation(
  supabase: SupabaseClient,
  phone: string
): Promise<ConversationState | null> {
  const { data } = await supabase
    .from("workflow_conversations")
    .select("*")
    .in("phone", phoneVariantsOrSelf(phone))
    .eq("status", "waiting")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) return null;
  return data as ConversationState;
}

/**
 * Claim atômico da resposta (CAS waiting → processing): só UMA retomada vence.
 * Duas respostas quase simultâneas (wamids diferentes) não executam a branch 2x.
 */
export async function claimConversation(
  supabase: SupabaseClient,
  conversationId: string
): Promise<ConversationState | null> {
  const { data } = await supabase
    .from("workflow_conversations")
    .update({ status: "processing", updated_at: new Date().toISOString() })
    .eq("id", conversationId)
    .eq("status", "waiting")
    .select("*")
    .maybeSingle();
  return (data as ConversationState | null) ?? null;
}

export async function completeConversation(
  supabase: SupabaseClient,
  conversationId: string,
  variables: Record<string, unknown>
): Promise<void> {
  await supabase
    .from("workflow_conversations")
    .update({
      status: "completed",
      variables,
      updated_at: new Date().toISOString(),
    })
    .eq("id", conversationId);
}

/** Encerra as perguntas pendentes do contato (opt-out, palavra-chave de outro fluxo). */
export async function cancelPendingConversations(
  supabase: SupabaseClient,
  phone: string,
  options: { conversationId?: string } = {}
): Promise<void> {
  let query = supabase
    .from("workflow_conversations")
    .update({ status: "cancelled", updated_at: new Date().toISOString() })
    .in("phone", phoneVariantsOrSelf(phone))
    .eq("status", "waiting");
  if (options.conversationId) query = query.eq("id", options.conversationId);
  await query;
}
