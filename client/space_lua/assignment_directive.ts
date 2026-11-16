export type AssignmentDirective = {
  name: string;
  nameOffset: number;
  exprSource: string;
  exprOffset: number;
  // `${local name = expr}`: defined like any cell, but its value isn't shown
  local: boolean;
  // Where `local` starts, when it's there
  localOffset?: number;
};

const ASSIGNMENT_RE = /^\s*(?:(local)\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(?!=)/;

/** Recognizes a `${name = expr}` body; null for any other directive. */
export function parseAssignmentDirective(
  body: string,
): AssignmentDirective | null {
  const m = ASSIGNMENT_RE.exec(body);
  if (!m) return null;
  const local = m[1] !== undefined;
  const nameOffset = local
    ? m[0].indexOf(m[2], m[0].indexOf("local") + 5)
    : m[0].indexOf(m[2]);
  return {
    name: m[2],
    nameOffset,
    exprSource: body.slice(m[0].length),
    exprOffset: m[0].length,
    local,
    localOffset: local ? m[0].indexOf("local") : undefined,
  };
}
