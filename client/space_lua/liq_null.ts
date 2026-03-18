// Sentinel value representing SQL NULL in query results.
export const LIQ_NULL = Symbol.for("silverbullet.sqlNull");

export function isSqlNull(v: any): boolean {
  return v === LIQ_NULL;
}
