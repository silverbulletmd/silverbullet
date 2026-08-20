import type { BlockContext, Line, MarkdownConfig } from "@lezer/markdown";
import * as ct from "./customtags.ts";

const START_PREFIX = "<<<<<<< SB sha256:";
const BASE_PREFIX = "||||||| SB BASE sha256:";
const SEPARATOR_LINE = "=======";
const END_PREFIX = ">>>>>>> SB sha256:";

type MarkerKind = "start" | "separator" | "end" | "other";

// `=======` is only a conflict marker between an opening and a closing marker;
// everywhere else it's a legitimate setext underline. Openness is tracked per
// BlockContext (one per parse, advanced strictly front-to-back) rather than in
// module state so concurrent and incremental parses can't see each other's.
const openConflict = new WeakMap<BlockContext, boolean>();

function markerKind(cx: BlockContext, lineText: string): MarkerKind | null {
  const text = lineText.endsWith("\r") ? lineText.slice(0, -1) : lineText;
  if (text.startsWith(START_PREFIX)) return "start";
  if (text.startsWith(END_PREFIX)) return "end";
  if (text.startsWith(BASE_PREFIX)) return "other";
  if (text === SEPARATOR_LINE && openConflict.get(cx)) return "separator";
  return null;
}

function couldStartMarker(line: Line): boolean {
  switch (line.next) {
    case 60 /* < */:
    case 62 /* > */:
    case 124 /* | */:
    case 61 /* = */:
      return true;
    default:
      return false;
  }
}

export const ConflictMarkers: MarkdownConfig = {
  defineNodes: [
    { name: "ConflictMarker", block: true, style: ct.ConflictMarkerTag },
  ],
  parseBlock: [
    {
      name: "ConflictMarker",
      parse(cx: BlockContext, line: Line) {
        if (!couldStartMarker(line)) return false;
        const kind = markerKind(cx, line.text.slice(line.pos));
        if (!kind) return false;

        const from = cx.lineStart + line.pos;
        cx.nextLine();
        cx.addElement(cx.elt("ConflictMarker", from, cx.prevLineEnd()));
        if (kind === "start") {
          openConflict.set(cx, true);
        } else if (kind === "end") {
          openConflict.set(cx, false);
        }
        return true;
      },
      endLeaf(cx: BlockContext, line: Line) {
        return (
          couldStartMarker(line) &&
          markerKind(cx, line.text.slice(line.pos)) !== null
        );
      },
      before: "Blockquote",
    },
  ],
};
