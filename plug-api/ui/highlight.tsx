/**
 * Matched-character highlighting for a row's primary text -- one
 * `<mark>`-per-token pass, driven by whatever phrase is currently ranking
 * rows. Token-based rather than positional: most fuzzy rankers score a
 * candidate without reporting which characters it matched, so this does its
 * own (cheap) substring search over the same tokens the ranker was handed.
 */

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Wraps every occurrence of a phrase's whitespace-separated tokens in `<mark>`. */
export function highlightMatches(text: string, phrase?: string) {
  if (!phrase) return text;
  const tokens = [
    ...new Set(phrase.trim().toLowerCase().split(/\s+/).filter(Boolean)),
  ];
  if (tokens.length === 0) return text;
  const re = new RegExp(`(${tokens.map(escapeRegExp).join("|")})`, "gi");
  return text
    .split(re)
    .map((part, i) =>
      tokens.includes(part.toLowerCase()) ? <mark key={i}>{part}</mark> : part,
    );
}
