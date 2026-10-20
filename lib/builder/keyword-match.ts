/**
 * Casamento de palavra-chave do gatilho "Palavras-chave" — ÚNICA regra usada pelo
 * webhook (escolha do fluxo) e pelo /execute (gate do disparo inicial).
 *
 * Regra: a mensagem inteira, normalizada, precisa ser IGUAL a uma das palavras
 * normalizadas. Normalizar = trim + minúsculas + sem acentos (NFD sem diacríticos).
 * Espaços internos NÃO são colapsados ("quero  muito" ≠ "quero muito") e não há
 * casamento por substring ("eu quero" não casa "quero").
 */
export function normalizeKeywordText(input: string): string {
  return String(input ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

/** keywordList do nó de gatilho compilado (uma palavra por linha) → palavras normalizadas. */
export function parseKeywordList(raw: unknown): string[] {
  return String(typeof raw === "string" ? raw : "")
    .split(/\r?\n/)
    .map((entry) => normalizeKeywordText(entry))
    .filter(Boolean);
}

/** A mensagem casa (match exato normalizado) alguma das palavras já normalizadas? */
export function matchesKeyword(normalizedKeywords: string[], message: string): boolean {
  const normalizedMessage = normalizeKeywordText(message);
  if (!normalizedMessage) return false;
  return normalizedKeywords.some((keyword) => keyword === normalizedMessage);
}

/**
 * Normalização da resposta de um "Perguntar": a de palavra-chave + espaços internos
 * colapsados ("  sim   quero " ≡ "Sim quero").
 */
export function normalizeAnswerText(input: string): string {
  return normalizeKeywordText(input).replace(/\s+/g, " ");
}
