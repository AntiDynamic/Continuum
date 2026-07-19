export const RETRIEVAL_NORMALIZATION_VERSION = "deterministic-identifier-normalization-v1";

export function splitIdentifierTerms(value: string): string[] {
  return value.normalize("NFC")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Za-z])([0-9])/g, "$1 $2")
    .replace(/([0-9])([A-Za-z])/g, "$1 $2")
    .replace(/[_./\\@-]+/g, " ")
    .toLowerCase().match(/[a-z0-9]+/g) ?? [];
}
function singular(value: string): string | undefined {
  if (value.length > 4 && value.endsWith("ies")) return value.slice(0, -3) + "y";
  if (value.length > 4 && value.endsWith("s") && !value.endsWith("ss")) return value.slice(0, -1);
  return undefined;
}
export function normalizeRetrievalTerms(value: string): string[] {
  const tokens = splitIdentifierTerms(value), terms = new Set(tokens);
  for (const token of tokens) { const normalized = singular(token); if (normalized) terms.add(normalized); }
  for (let index = 0; index < tokens.length - 1; index += 1) terms.add(tokens[index]! + tokens[index + 1]!);
  if (tokens.length > 1) terms.add(tokens.join(""));
  return [...terms].filter((term) => term.length > 1);
}
export function normalizedRetrievalQuery(value: string): string { return normalizeRetrievalTerms(value).join(" "); }
