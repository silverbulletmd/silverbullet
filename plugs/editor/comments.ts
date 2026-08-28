import { editor, markdown } from "@silverbulletmd/silverbullet/syscalls";
import {
  collectNodesOfType,
  type ParseTree,
  traverseTree,
} from "@silverbulletmd/silverbullet/lib/tree";

/**
 * Whether `pos` sits in a fenced code block, where the block's own language
 * has a comment syntax of its own and an HTML comment would just be code.
 */
export function isInFencedCode(tree: ParseTree, pos: number): boolean {
  // Checked by range rather than by walking up from the node at `pos`: that
  // needs parent pointers, and adding them would mutate the syscall's tree
  // with cycles.
  return collectNodesOfType(tree, "FencedCode").some(
    (node) => pos >= node.from! && pos < node.to!,
  );
}

export function wrapLines(
  text: string,
  selFrom: number,
  selTo: number,
): { from: number; to: number; replacement: string } {
  const from = selFrom === 0 ? 0 : text.lastIndexOf("\n", selFrom - 1) + 1;
  // A selection that already ends right after a newline (triple-click, Home+Shift-Down,
  // dragging to the next line's start) has fully covered its last line; don't pull in
  // the line after it.
  let to: number;
  if (selTo > selFrom && text[selTo - 1] === "\n") {
    to = selTo - 1;
  } else {
    const nl = text.indexOf("\n", selTo);
    to = nl === -1 ? text.length : nl;
  }
  return { from, to, replacement: `<!--\n${text.slice(from, to)}\n-->` };
}

/**
 * End of the top-level block containing `pos`. Between blocks — on a blank
 * line — there is nothing to follow, so the comment belongs right at `pos`.
 */
function endOfBlock(tree: ParseTree, pos: number): number {
  for (const block of tree.children ?? []) {
    // The untyped children are the whitespace runs separating the blocks.
    if (!block.type) continue;
    if (pos >= block.from! && pos <= block.to!) {
      return block.to!;
    }
  }
  return pos;
}

function enclosingListItem(
  tree: ParseTree,
  pos: number,
): ParseTree | undefined {
  // Deeper items are visited later, so the last match is the innermost one.
  let found: ParseTree | undefined;
  traverseTree(tree, (node) => {
    if (node.from === undefined || node.to === undefined) return false;
    if (pos < node.from || pos > node.to) return true;
    if (node.type === "ListItem") found = node;
    return false;
  });
  return found;
}

/**
 * Where a comment on `selTo` belongs, and the indent that keeps it there. A
 * `<!--` in column 0 inside a list splits the list in two; indented to the
 * item's continuation column it parses as part of the item instead.
 */
export function commentAnchor(
  tree: ParseTree,
  text: string,
  selTo: number,
): { insertAt: number; indent: string } {
  const item = enclosingListItem(tree, selTo);
  const mark = item?.children?.[0];
  if (!item || mark?.type !== "ListMark") {
    return { insertAt: endOfBlock(tree, selTo), indent: "" };
  }
  // Measured from the line, not from `item.from`: a nested item's leading
  // indentation is a sibling text node of the parent list, outside the item.
  const lineStart = text.lastIndexOf("\n", item.from! - 1) + 1;
  // A task's `[ ]` is deliberately not counted: that column is content indent
  // + 4, which the parser reads as an indented code block.
  return { insertAt: item.to!, indent: " ".repeat(mark.to! - lineStart + 1) };
}

function quoteSelection(selection: string, indent: string): string {
  if (!selection) {
    return "";
  }
  const lines = selection.split("\n");
  // A trailing "\n" in the selection ends the split with an empty segment that
  // represents no real line — drop it so it doesn't render as a bare ">".
  if (selection.endsWith("\n")) {
    lines.pop();
  }
  return `${lines.map((line) => (line.trim() === "" ? `${indent}>` : `${indent}> ${line}`)).join("\n")}\n`;
}

export function buildCommentInsertion(
  tree: ParseTree,
  text: string,
  selFrom: number,
  selTo: number,
): { insertAt: number; text: string; cursorPos: number } {
  const { insertAt, indent } = commentAnchor(tree, text, selTo);
  const quote = quoteSelection(text.slice(selFrom, selTo), indent);
  // Only an anchor with text already on its line needs a separator; at a line
  // boundary one would push the comment down past the spot it was asked for.
  const lead = insertAt > 0 && text[insertAt - 1] !== "\n" ? "\n" : "";
  // With a quote, a blank line follows it: the cursor lands one line further
  // down, so what gets typed starts its own block instead of being absorbed as
  // a lazy continuation of the blockquote. That landing line carries the indent
  // even though it is otherwise empty — the caret sits after it, so typing
  // lands in the comment's column instead of back at the margin.
  const scaffold = quote
    ? `${lead}${indent}<!--\n${quote}\n${indent}\n${indent}-->`
    : `${lead}${indent}<!--\n${indent}\n${indent}-->`;
  return {
    insertAt,
    text: scaffold,
    cursorPos: insertAt + scaffold.length - (4 + indent.length),
  };
}

export async function commentSelection() {
  const selection = await editor.getSelection();
  if (selection.from === selection.to) {
    return;
  }
  const text = await editor.getText();
  // Inside fenced code the editor already knows the block's language, so let
  // CodeMirror comment it the way that language does.
  if (isInFencedCode(await markdown.parseMarkdown(text), selection.from)) {
    await editor.toggleComment();
    return;
  }
  const r = wrapLines(text, selection.from, selection.to);
  await editor.replaceRange(r.from, r.to, r.replacement);
}

export async function addComment() {
  const text = await editor.getText();
  const selection = await editor.getSelection();
  const tree = await markdown.parseMarkdown(text);
  const r = buildCommentInsertion(tree, text, selection.from, selection.to);
  await editor.replaceRange(r.insertAt, r.insertAt, r.text);
  await editor.moveCursor(r.cursorPos);
}
