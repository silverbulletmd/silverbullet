const listItemPrefix = /^(\s*(?:[*+-]|\d+[.)])\s+)/;
const taskPrefix = /^\s*(?:[*+-]|\d+[.)])\s+\[[^\]]*\]\s/;

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
): { from: number; to: number; insert: string; cursor: number } | null {
  const start = text.lastIndexOf("\n", from - 1) + 1;
  const endBreak = text.indexOf("\n", to);
  const end = endBreak === -1 ? text.length : endBreak;

  let changed = false;
  let offset = start;
  let newCursor = cursor;
  const original = text.slice(start, end).split("\n");
  const lines = original.map((line) => {
    const lineStart = offset;
    offset += line.length + 1;
    if (taskPrefix.test(line)) return line;
    const bullet = line.match(listItemPrefix)?.[1];
    const at = bullet?.length ?? line.match(/^\s*/)![0].length;
    const insert = bullet === undefined ? "* [ ] " : "[ ] ";
    // Blank lines inside a multi-line selection separate items; keep them.
    if (bullet === undefined && line.trim() === "" && original.length > 1) {
      return line;
    }
    changed = true;
    if (cursor >= lineStart + at) newCursor += insert.length;
    return line.slice(0, at) + insert + line.slice(at);
  });
  if (!changed) return null;
  return { from: start, to: end, insert: lines.join("\n"), cursor: newCursor };
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
  const start = text.lastIndexOf("\n", from - 1) + 1;
  const endBreak = text.indexOf("\n", to);
  const end = endBreak === -1 ? text.length : endBreak;
  const original = text.slice(start, end).split("\n");
  let offset = start;
  let cursor = from;
  const lines = original.map((line) => {
    const lineStart = offset;
    offset += line.length + 1;
    if (original.length > 1 && line.trim() === "") return line;
    const at = line.match(/^\s*/)![0].length;
    if (from >= lineStart + at) cursor += 2;
    return `${line.slice(0, at)}* ${line.slice(at)}`;
  });
  return {
    from: start,
    to: end,
    insert: lines.join("\n"),
    cursor: from === to ? cursor : undefined,
  };
}
