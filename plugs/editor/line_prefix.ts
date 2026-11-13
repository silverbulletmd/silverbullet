import { lineEnd, lineStart } from "@silverbulletmd/silverbullet/lib/lines";

const listItemPrefix = /^(\s*(?:[*+-]|\d+[.)])\s+)/;
const taskPrefix = /^\s*(?:[*+-]|\d+[.)])\s+\[[^\]]*\]\s/;

type LineResult = { from: number; to: number; insert: string; cursor: number };

/**
 * Rewrites the lines touched by `[from, to]`. `rewrite(line)` returns null to
 * keep a line, or an edit inside it: `remove` characters at offset `at` are
 * replaced by `insert`. Blank lines inside a multi-line range are kept. A
 * cursor after an edit shifts with it, one inside the removed span goes to the
 * end of the inserted text. Returns null when nothing changes, otherwise the
 * replacement for the line range and the new cursor position.
 */
function mapTouchedLines(
  text: string,
  from: number,
  to: number,
  cursor: number,
  rewrite: (
    line: string,
  ) => { at: number; remove: number; insert: string } | null,
): LineResult | null {
  const start = lineStart(text, from);
  const end = lineEnd(text, to);
  const original = text.slice(start, end).split("\n");
  let changed = false;
  let offset = start;
  let newCursor = cursor;
  const lines = original.map((line) => {
    const lineFrom = offset;
    offset += line.length + 1;
    if (line.trim() === "" && original.length > 1) return line;
    const edit = rewrite(line);
    if (!edit) return line;
    changed = true;
    const editFrom = lineFrom + edit.at;
    if (cursor >= editFrom + edit.remove) {
      newCursor += edit.insert.length - edit.remove;
    } else if (cursor > editFrom) {
      newCursor += editFrom + edit.insert.length - cursor;
    }
    return (
      line.slice(0, edit.at) + edit.insert + line.slice(edit.at + edit.remove)
    );
  });
  if (!changed) return null;
  return { from: start, to: end, insert: lines.join("\n"), cursor: newCursor };
}

/**
 * Turns every line touched by `[from, to]` into a task: a plain line becomes
 * `* [ ] line`, a list item gets `[ ] ` after its bullet, a task stays as is.
 * Blank lines inside a multi-line range are left alone.
 * Returns null when nothing changes, otherwise the replacement for the line
 * range and where a cursor at `cursor` ends up.
 */
export function taskifyLines(
  text: string,
  from: number,
  to: number,
  cursor: number,
): LineResult | null {
  return mapTouchedLines(text, from, to, cursor, (line) => {
    if (taskPrefix.test(line)) return null;
    const bullet = line.match(listItemPrefix)?.[1];
    if (bullet !== undefined) {
      return { at: bullet.length, remove: 0, insert: "[ ] " };
    }
    return { at: line.match(/^\s*/)![0].length, remove: 0, insert: "* [ ] " };
  });
}

/**
 * Prefixes every line touched by `[from, to]` with `* `, after its
 * indentation. Blank lines inside a multi-line range are left alone. A
 * collapsed cursor moves along with its line's text, so on an empty line it
 * ends up after the bullet, ready to type.
 */
export function listifyLines(
  text: string,
  from: number,
  to: number,
): { from: number; to: number; insert: string; cursor?: number } {
  const result = mapTouchedLines(text, from, to, from, (line) => ({
    at: line.match(/^\s*/)![0].length,
    remove: 0,
    insert: "* ",
  }))!;
  return { ...result, cursor: from === to ? result.cursor : undefined };
}

// Indentation and quote markers, then an ATX heading marker (a `#tag` is text)
const headingPrefix = /^(\s{0,3}(?:>\s?)*)(#{1,6}(?:\s+|$))?/;

/**
 * Sets every line touched by `[from, to]` to heading `level` (1–6), or to
 * normal text (`level` 0) by removing its `#` marker. List items and tasks are
 * left alone, as are blank lines inside a multi-line range; a quote keeps its
 * `>`. Returns null when nothing changes, otherwise the replacement for the
 * line range and where a cursor at `cursor` ends up.
 */
export function headingLines(
  text: string,
  from: number,
  to: number,
  cursor: number,
  level: number,
): LineResult | null {
  const marker = level > 0 ? `${"#".repeat(level)} ` : "";
  return mapTouchedLines(text, from, to, cursor, (line) => {
    if (listItemPrefix.test(line)) return null;
    const [, prefix, old = ""] = line.match(headingPrefix)!;
    if (old === marker) return null;
    return { at: prefix.length, remove: old.length, insert: marker };
  });
}
