export type AssignmentDirective = {
  name: string;
  nameOffset: number;
  exprSource: string;
  exprOffset: number;
};

const ASSIGNMENT_RE = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(?!=)/;

/** Recognises a `${name = expr}` body; null for any other directive. */
export function parseAssignmentDirective(
  body: string,
): AssignmentDirective | null {
  const m = ASSIGNMENT_RE.exec(body);
  if (!m) return null;
  return {
    name: m[1],
    nameOffset: m[0].indexOf(m[1]),
    exprSource: body.slice(m[0].length),
    exprOffset: m[0].length,
  };
}
