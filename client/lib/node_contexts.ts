import { foldedRanges, syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";
import type { Client } from "../client.ts";
import { findFrontmatterBlock } from "../codemirror/syntax/frontmatter_block.ts";

/**
 * `onlyContexts` / `exceptContexts` filtering against the contexts at the
 * cursor (as produced by `contextsAt`). Contexts match by prefix, so
 * `FencedCode` also matches `FencedCode:lua`.
 */
export type NodeContextFilter = {
  onlyContexts?: string[];
  exceptContexts?: string[];
};

export function matchesNodeContexts(
  filter: NodeContextFilter,
  parentNodes: string[],
): boolean {
  const inContext = (context: string) =>
    parentNodes.some((node) => node.startsWith(context));
  if (filter.onlyContexts && !filter.onlyContexts.some(inContext)) {
    return false;
  }
  return !filter.exceptContexts?.some(inContext);
}

/**
 * Contexts that are facts about the line rather than syntax nodes. Spelled
 * with a leading `@`, which no syntax node name has, so prefix matching never
 * mixes the two up.
 */
export const PSEUDO_CONTEXTS = {
  /** The line is empty or whitespace only */
  blank: "@blank",
  /** The list item the line is in has nested items */
  hasChildren: "@hasChildren",
  /** A fold starts on the line */
  folded: "@folded",
  /** The page starts with frontmatter (a fact about the page, not the line) */
  hasFrontmatter: "@hasFrontmatter",
} as const;

/**
 * The contexts at `pos`, for `onlyContexts` / `exceptContexts`: the syntax
 * nodes enclosing it (innermost first, as `Client.extractParentNodes` names
 * them), then the pseudo-contexts that apply (see `PSEUDO_CONTEXTS`). Markup
 * buttons and slash commands both filter on these.
 */
export function contextsAt(
  client: Pick<Client, "extractParentNodes">,
  state: EditorState,
  pos: number,
  // Which way to look from `pos` (at a node boundary). At the start of a
  // line, look forward so the position counts as inside the item on that line
  // rather than the node that ended on the line before.
  side: 1 | -1 = pos === state.doc.lineAt(pos).from ? 1 : -1,
): string[] {
  const node = syntaxTree(state).resolveInner(pos, side);
  const contexts = client.extractParentNodes(state, node);
  const line = state.doc.lineAt(pos);
  if (line.text.trim() === "") contexts.push(PSEUDO_CONTEXTS.blank);
  for (let n: SyntaxNode | null = node; n; n = n.parent) {
    if (n.name !== "ListItem") continue;
    if (n.getChild("BulletList") ?? n.getChild("OrderedList")) {
      contexts.push(PSEUDO_CONTEXTS.hasChildren);
    }
    break;
  }
  let folded = false;
  foldedRanges(state).between(line.from, line.to, (from) => {
    if (from >= line.from && from <= line.to) {
      folded = true;
      return false;
    }
  });
  if (folded) contexts.push(PSEUDO_CONTEXTS.folded);
  if (findFrontmatterBlock(state))
    contexts.push(PSEUDO_CONTEXTS.hasFrontmatter);
  return contexts;
}
