// A block `${…}`: an expression on lines of its own (nothing else on its first
// and last line). It moves and deletes as one block (a `BlockSpan`) from its
// ⋮ menu or its ⋮ line handle, as the other widget blocks do
import { syntaxTree } from "@codemirror/language";
import type { EditorState, TransactionSpec } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";
import { type DirectiveTarget, directiveFromNode } from "./directive_at.ts";

/** Whether nothing but whitespace shares the first and last line of `n` */
export function ownsLines(
  state: EditorState,
  n: { from: number; to: number },
): boolean {
  const { doc } = state;
  return (
    doc.sliceString(doc.lineAt(n.from).from, n.from).trim() === "" &&
    doc.sliceString(n.to, doc.lineAt(n.to).to).trim() === ""
  );
}

/** Whether directive node `n` has its lines to itself */
function onOwnLines(state: EditorState, n: SyntaxNode): boolean {
  return n.parent?.name === "Paragraph" && ownsLines(state, n);
}

function directiveNodeAt(
  state: EditorState,
  from: number,
): SyntaxNode | undefined {
  for (
    let n: SyntaxNode | null = syntaxTree(state).resolveInner(from, 1);
    n;
    n = n.parent
  ) {
    if (n.name === "LuaDirective") return n.from === from ? n : undefined;
  }
}

/** The block `${…}` starting at `from`; undefined for an inline one */
export function blockDirectiveAt(
  state: EditorState,
  from: number,
): DirectiveTarget | undefined {
  const n = directiveNodeAt(state, from);
  return n && onOwnLines(state, n) ? directiveFromNode(state, n) : undefined;
}

/**
 * The block `${…}` that line `line` is part of, and whether it is its first
 * line (where its ⋮ handle goes); undefined on any other line
 */
export function blockDirectiveOnLine(
  state: EditorState,
  line: number,
): { directive: DirectiveTarget; first: boolean } | undefined {
  const target = state.doc.line(line);
  let found: SyntaxNode | undefined;
  syntaxTree(state).iterate({
    from: target.from,
    to: target.to,
    enter: (node) => {
      if (found) return false;
      if (node.name !== "LuaDirective") return;
      if (onOwnLines(state, node.node)) found = node.node;
      return false;
    },
  });
  if (!found) return;
  return {
    directive: directiveFromNode(state, found),
    first: state.doc.lineAt(found.from).number === line,
  };
}

/**
 * Moves the cursor out of the block `${…}` so it renders: to the start of the
 * next line, else the end of the one before; on a page of only the `${…}`, to
 * a new line after it
 */
export function showBlockDirectiveResult(
  state: EditorState,
  directive: DirectiveTarget,
): TransactionSpec {
  const { doc } = state;
  // A `${…}` ends in `}`: its end is never the start of a line
  const last = doc.lineAt(directive.to);
  if (last.number < doc.lines) {
    return { selection: { anchor: doc.line(last.number + 1).from } };
  }
  const first = doc.lineAt(directive.from);
  if (first.number > 1) {
    return { selection: { anchor: doc.line(first.number - 1).to } };
  }
  return {
    changes: { from: doc.length, insert: "\n" },
    selection: { anchor: doc.length + 1 },
  };
}
