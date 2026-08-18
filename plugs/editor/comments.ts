import { editor, markdown } from "@silverbulletmd/silverbullet/syscalls";
import {
  collectNodesOfType,
  type ParseTree,
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

/** End of the block containing `pos`: forward to the last non-blank line. */
function endOfBlock(text: string, pos: number): number {
  let at = pos;
  while (at < text.length) {
    const nl = text.indexOf("\n", at);
    const lineEnd = nl === -1 ? text.length : nl;
    const nextStart = nl === -1 ? text.length : nl + 1;
    const nextNl = text.indexOf("\n", nextStart);
    const nextEnd = nextNl === -1 ? text.length : nextNl;
    at = lineEnd;
    if (
      nextStart >= text.length ||
      text.slice(nextStart, nextEnd).trim() === ""
    ) {
      break;
    }
    at = nextStart;
  }
  return at;
}

function quoteSelection(selection: string): string {
  if (!selection) {
    return "";
  }
  const lines = selection.split("\n");
  // A trailing "\n" in the selection ends the split with an empty segment that
  // represents no real line — drop it so it doesn't render as a bare ">".
  if (selection.endsWith("\n")) {
    lines.pop();
  }
  return `${lines.map((line) => (line.trim() === "" ? ">" : `> ${line}`)).join("\n")}\n`;
}

export function buildCommentInsertion(
  text: string,
  selFrom: number,
  selTo: number,
): { insertAt: number; text: string; cursorPos: number } {
  const insertAt = endOfBlock(text, selTo);
  const selection = text.slice(selFrom, selTo);
  const quote = quoteSelection(selection);
  // With a quote, a blank line follows it: the cursor lands one line further
  // down, so what gets typed starts its own block instead of being absorbed as
  // a lazy continuation of the blockquote.
  const scaffold = quote ? `\n<!--\n${quote}\n\n-->` : `\n<!--\n\n-->`;
  return {
    insertAt,
    text: scaffold,
    // Land on the blank line the scaffold leaves above the closing marker.
    cursorPos: insertAt + scaffold.length - 4,
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
  const r = buildCommentInsertion(text, selection.from, selection.to);
  await editor.replaceRange(r.insertAt, r.insertAt, r.text);
  await editor.moveCursor(r.cursorPos);
}
