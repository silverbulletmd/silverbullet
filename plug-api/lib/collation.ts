import type { QueryCollationConfig } from "../types/config.ts";

/**
 * Compares two values the same way the query engine's `order by` does:
 * codepoint order by default, or `Intl.Collator` order when the space's
 * `queryCollation` config turns it on and both sides are strings.
 */
export function compareCollated(
  // deno-lint-ignore no-explicit-any
  a: any,
  // deno-lint-ignore no-explicit-any
  b: any,
  collation: QueryCollationConfig | undefined,
  collator: Intl.Collator,
): number {
  if (collation?.enabled && typeof a === "string" && typeof b === "string") {
    return collator.compare(a, b);
  }
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}
