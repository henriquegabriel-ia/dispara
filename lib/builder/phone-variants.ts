/**
 * Variantes do telefone para lookup — cobre o "bug do 9" brasileiro (a Meta pode
 * entregar o número sem o 9 mesmo que esteja salvo com, e vice-versa) e a
 * presença/ausência do prefixo "+". Mesma regra do webhook (AutoReply, Stop on
 * Response) e das ações de contato do fluxo.
 *
 * Módulo puro (sem banco): pode ser usado por rotas, cron, passos e testes.
 */
export function phoneLookupVariants(phone: string): string[] {
  const digits = String(phone ?? "").replace(/\D/g, "");
  if (!digits) return [];
  const variants = new Set<string>([digits, `+${digits}`]);
  if (digits.startsWith("55") && digits.length === 12) {
    const withNine = `${digits.slice(0, 4)}9${digits.slice(4)}`;
    variants.add(withNine);
    variants.add(`+${withNine}`);
  } else if (digits.startsWith("55") && digits.length === 13 && digits[4] === "9") {
    const withoutNine = `${digits.slice(0, 4)}${digits.slice(5)}`;
    variants.add(withoutNine);
    variants.add(`+${withoutNine}`);
  }
  return Array.from(variants);
}
