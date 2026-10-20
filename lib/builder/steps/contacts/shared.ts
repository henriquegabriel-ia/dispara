import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "@/lib/supabase";
import { normalizePhoneNumber } from "@/lib/phone-formatter";
import { phoneLookupVariants } from "@/lib/builder/phone-variants";

export type ContactRow = {
  id: string;
  name: string;
  phone: string;
  tags: unknown;
};

// Variantes do telefone (bug do 9 + prefixo "+"): ver lib/builder/phone-variants.ts.
export { phoneLookupVariants };

/** Telefone do contato do fluxo (triggerData.from/to/phone), normalizado E.164. */
export function resolveContactPhone(
  triggerData: Record<string, unknown> | undefined
): string | null {
  const raw =
    (triggerData?.from as string | undefined) ||
    (triggerData?.to as string | undefined) ||
    (triggerData?.phone as string | undefined) ||
    "";
  const normalized = normalizePhoneNumber(String(raw));
  return normalized && /^\+\d{8,15}$/.test(normalized) ? normalized : null;
}

/**
 * Acha o contato pelo telefone (variantes) ou cria um novo — ações de dados do
 * fluxo (tag/pipeline) precisam de um contato mesmo quando o número chegou por
 * um gatilho de keyword e nunca foi importado.
 */
export async function findOrCreateContactByPhone(
  supabase: SupabaseClient,
  phone: string
): Promise<ContactRow | null> {
  const variants = phoneLookupVariants(phone);
  if (variants.length === 0) return null;

  const { data: found } = await supabase
    .from("contacts")
    .select("id, name, phone, tags")
    .in("phone", variants)
    .limit(1);
  if (found && found.length > 0) return found[0] as ContactRow;

  const { data: created, error } = await supabase
    .from("contacts")
    .insert({ phone, name: "", tags: [] })
    .select("id, name, phone, tags")
    .single();
  if (error) {
    // Corrida (unique em phone): outro caminho criou primeiro — relê.
    const { data: retry } = await supabase
      .from("contacts")
      .select("id, name, phone, tags")
      .in("phone", variants)
      .limit(1);
    return (retry?.[0] as ContactRow) ?? null;
  }
  return created as ContactRow;
}

export function requireSupabase(): SupabaseClient | null {
  return getSupabaseAdmin();
}
