import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";

/** The expression inside a `${…}` directive's source. */
export function directiveExpr(source: string): string {
  return source.slice(2, -1);
}

/** The name a `${name = expr}` directive node assigns, if it is one. */
export function assignmentNameOf(
  directive: SyntaxNode,
  state: EditorState,
): string | undefined {
  const name = directive
    .getChild("LuaExpressionDirective")
    ?.getChild("LuaAssignmentName");
  return name ? state.sliceDoc(name.from, name.to) : undefined;
}

/** A `${…}` in the page */
export type DirectiveTarget = {
  from: number;
  to: number;
  expr: string;
  // Set for a `${name = expr}` definition
  assignmentName?: string;
};

/** Whether `expr` is a `query[[…]]` the Workbench's query builder can open */
export function isQueryExpression(expr: string): boolean {
  return /^\s*query\s*\[/.test(expr);
}

/** The `${…}` that `LuaDirective` node `n` is */
export function directiveFromNode(
  state: EditorState,
  n: SyntaxNode,
): DirectiveTarget {
  return {
    from: n.from,
    to: n.to,
    expr: directiveExpr(state.sliceDoc(n.from, n.to)),
    assignmentName: assignmentNameOf(n, state),
  };
}

/** The `${…}` expression containing, or touching, `pos`. */
export function directiveAt(
  state: EditorState,
  pos: number,
): DirectiveTarget | undefined {
  for (const side of [-1, 1] as const) {
    for (
      let n: SyntaxNode | null = syntaxTree(state).resolveInner(pos, side);
      n;
      n = n.parent
    ) {
      if (n.name === "LuaDirective") return directiveFromNode(state, n);
    }
  }
  return undefined;
}
