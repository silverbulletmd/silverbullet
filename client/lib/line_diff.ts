import diff, { DELETE, INSERT } from "fast-diff";
import {
  type DiffLine,
  diffLineClass,
} from "../navigator/views/revision_preview.ts";

const NO_FINAL_NEWLINE = "\\ No newline at end";

/**
 * Line-level diff of `a` against `b`: lines are prefixed " " (both), "-"
 * (only in `a`) or "+" (only in `b`). A carriage return shows as "␍", and a
 * side whose last line lacks the other side's final newline gets a
 * `\ No newline at end` line.
 */
export function lineDiff(a: string, b: string): DiffLine[] {
  const markEnd = endsLine(a) !== endsLine(b);
  // Map each distinct line to one code point so fast-diff works per line,
  // skipping the surrogate range so every id stays one code point
  const ids = new Map<string, string>();
  const lines: string[] = [];
  const encode = (text: string) =>
    splitLines(text, markEnd)
      .map((line) => {
        let id = ids.get(line);
        if (id === undefined) {
          id = String.fromCodePoint(idToCodePoint(lines.length));
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
      const text = prefix + lines[codePointToId(ch.codePointAt(0)!)];
      result.push({ text, cssClass: diffLineClass(text) });
    }
  }
  return result;
}

const SURROGATES = 0xe000 - 0xd800;

const idToCodePoint = (id: number) => (id < 0xd800 ? id : id + SURROGATES);

const codePointToId = (cp: number) => (cp < 0xd800 ? cp : cp - SURROGATES);

const endsLine = (text: string) => text === "" || text.endsWith("\n");

function splitLines(text: string, markEnd: boolean): string[] {
  if (text === "") return [];
  const lines = text
    .replace(/\n$/, "")
    .split("\n")
    .map((line) => line.replace(/\r$/, "␍"));
  if (markEnd && !endsLine(text)) lines.push(NO_FINAL_NEWLINE);
  return lines;
}
