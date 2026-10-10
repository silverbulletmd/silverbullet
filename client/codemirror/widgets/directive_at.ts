import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";

/** The expression inside a `${…}` directive's source. */
export function directiveExpr(source: string): string {
  return source.slice(2, -1);
}

/** The `${…}` expression containing, or touching, `pos`. */
export function directiveAt(
  state: EditorState,
  pos: number,
): { from: number; to: number; expr: string } | undefined {
  for (const side of [-1, 1] as const) {
    for (
      let n: SyntaxNode | null = syntaxTree(state).resolveInner(pos, side);
      n;
      n = n.parent
    ) {
      if (n.name === "LuaDirective") {
        return {
          from: n.from,
          to: n.to,
          expr: directiveExpr(state.sliceDoc(n.from, n.to)),
        };
      }
    }
  }
  return undefined;
}
