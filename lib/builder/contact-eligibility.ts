import type { SupabaseClient } from "@supabase/supabase-js";
import { phoneLookupVariants } from "@/lib/builder/phone-variants";

/**
 * Contatos que NÃO podem receber mensagens de fluxo: supressão ativa em
 * phone_suppressions (opt-out por palavra, erro de opt-out da Meta, manual) ou
 * contato marcado como Opt-out/Suprimido. Mesma fonte de verdade do disparo de
 * campanhas. Considera as variantes do 9 brasileiro e do "+".
 *
 * Erro de banco PROPAGA (quem chama decide: o dreno faz backoff, a inscrição
 * responde erro) — na dúvida, não enviar.
 */
const BLOCKED_CONTACT_STATUSES = ["Opt-out", "Suprimido"];

function isActiveSuppression(row: { is_active?: unknown; expires_at?: unknown }): boolean {
  if (row.is_active === false) return false;
  if (!row.expires_at) return true;
  const expires = Date.parse(String(row.expires_at));
  return !Number.isFinite(expires) || expires > Date.now();
}

/** Devolve o subconjunto de `phones` (como foram passados) que está bloqueado. */
export async function findBlockedPhones(
  supabase: SupabaseClient,
  phones: string[]
): Promise<Set<string>> {
  const variantsByPhone = new Map<string, string[]>();
  for (const phone of phones) {
    const variants = phoneLookupVariants(phone);
    if (variants.length > 0) variantsByPhone.set(phone, variants);
  }
  const allVariants = Array.from(new Set(Array.from(variantsByPhone.values()).flat()));
  if (allVariants.length === 0) return new Set();

  const [suppressions, contacts] = await Promise.all([
    supabase
      .from("phone_suppressions")
      .select("phone, is_active, expires_at")
      .in("phone", allVariants),
    supabase
      .from("contacts")
      .select("phone, status")
      .in("phone", allVariants)
      .in("status", BLOCKED_CONTACT_STATUSES),
  ]);
  if (suppressions.error) {
    throw new Error(`Falha ao consultar supressões: ${suppressions.error.message}`);
  }
  if (contacts.error) {
    throw new Error(`Falha ao consultar contatos: ${contacts.error.message}`);
  }

  const blockedVariants = new Set<string>();
  for (const row of (suppressions.data ?? []) as Array<{ phone: string; is_active?: unknown; expires_at?: unknown }>) {
    if (row?.phone && isActiveSuppression(row)) blockedVariants.add(String(row.phone));
  }
  for (const row of (contacts.data ?? []) as Array<{ phone: string }>) {
    if (row?.phone) blockedVariants.add(String(row.phone));
  }

  const blocked = new Set<string>();
  for (const [phone, variants] of variantsByPhone) {
    if (variants.some((v) => blockedVariants.has(v))) blocked.add(phone);
  }
  return blocked;
}

export async function isPhoneBlocked(supabase: SupabaseClient, phone: string): Promise<boolean> {
  return (await findBlockedPhones(supabase, [phone])).has(phone);
}
