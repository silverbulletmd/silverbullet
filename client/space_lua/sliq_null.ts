// Sentinel value representing SQL NULL in query results.
export const SLIQ_NULL = Symbol.for("silverbullet.sqlNull");

export function isSqlNull(v: any): boolean {
  return v === SLIQ_NULL;
}
