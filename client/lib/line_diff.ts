import diff, { DELETE, INSERT } from "fast-diff";
import {
  type DiffLine,
  diffLineClass,
} from "../navigator/views/revision_preview.ts";

/**
 * Line-level diff of `a` against `b`: lines are prefixed " " (both), "-"
 * (only in `a`) or "+" (only in `b`).
 */
export function lineDiff(a: string, b: string): DiffLine[] {
  // Map each distinct line to one character so fast-diff works per line
  const ids = new Map<string, string>();
  const lines: string[] = [];
  const encode = (text: string) =>
    splitLines(text)
      .map((line) => {
        let id = ids.get(line);
        if (id === undefined) {
          id = String.fromCharCode(lines.length);
          ids.set(line, id);
          lines.push(line);
        }
        return id;
      })
      .join("");

  const result: DiffLine[] = [];
  for (const [op, chars] of diff(encode(a), encode(b))) {
    const prefix = op === DELETE ? "-" : op === INSERT ? "+" : " ";
    for (const ch of chars) {
      const text = prefix + lines[ch.charCodeAt(0)];
      result.push({ text, cssClass: diffLineClass(text) });
    }
  }
  return result;
}

function splitLines(text: string): string[] {
  if (text === "") return [];
  return text.replace(/\n$/, "").split("\n");
}
