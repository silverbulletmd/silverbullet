import { tags as t } from "@lezer/highlight";
import { type Line, type MarkdownConfig } from "@lezer/markdown";
import * as ct from "./customtags.ts";

const footnoteRefRegex = /^\[\^([^\]\s]+)\]/;

export const FootnoteRef: MarkdownConfig = {
  defineNodes: [
    { name: "FootnoteRef" },
    { name: "FootnoteRefMark", style: t.processingInstruction },
    { name: "FootnoteRefLabel", style: ct.FootnoteRefTag },
  ],
  parseInline: [
    {
      name: "FootnoteRef",
      parse(cx, next, pos) {
        if (next !== 91 /* '[' */) {
          return -1;
        }
        const match = footnoteRefRegex.exec(cx.slice(pos, cx.end));
        if (!match) {
          return -1;
        }
        // If followed by ':', this is a definition, not a reference
        const afterMatch = pos + match[0].length;
        if (afterMatch < cx.end && cx.slice(afterMatch, afterMatch + 1) === ":") {
          return -1;
        }
        const label = match[1];
        const endPos = pos + match[0].length;
        return cx.addElement(
          cx.elt("FootnoteRef", pos, endPos, [
            cx.elt("FootnoteRefMark", pos, pos + 2), // [^
            cx.elt("FootnoteRefLabel", pos + 2, endPos - 1), // label
            cx.elt("FootnoteRefMark", endPos - 1, endPos), // ]
          ]),
        );
      },
      after: "Emphasis",
    },
  ],
};

const footnoteDefRegex = /^\[\^([^\]\s]+)\]:\s?/;

export const FootnoteDefinition: MarkdownConfig = {
  defineNodes: [
    { name: "FootnoteDefinition", block: true },
    { name: "FootnoteDefMark", style: t.processingInstruction },
    { name: "FootnoteDefLabel", style: ct.FootnoteDefTag },
    { name: "FootnoteDefBody" },
  ],
  parseBlock: [
    {
      name: "FootnoteDefinition",
      parse: (cx, line: Line) => {
        const match = footnoteDefRegex.exec(line.text);
        if (!match) {
          return false;
        }
        const label = match[1];
        const markLen = match[0].length; // [^label]:
        const startPos = cx.parsedPos;
        let bodyText = line.text.slice(markLen);
        let endPos = cx.parsedPos + line.text.length + 1;

        // Consume continuation lines (indented by 4+ spaces or tab)
        // Blank lines are allowed between continuation paragraphs
        while (cx.nextLine()) {
          if (/^(?:    |\t)/.test(line.text)) {
            bodyText += "\n" + line.text;
            endPos = cx.parsedPos + line.text.length + 1;
          } else if (line.text.trim() === "") {
            // Blank line: peek ahead to see if next line is indented
            bodyText += "\n";
            endPos = cx.parsedPos + line.text.length + 1;
          } else {
            break;
          }
        }
        // Trim trailing blank lines from the body
        while (bodyText.endsWith("\n")) {
          const trimmed = bodyText.slice(0, -1);
          if (trimmed.endsWith("\n") || trimmed.length === 0) {
            bodyText = trimmed;
            endPos--;
          } else {
            break;
          }
        }

        const labelStart = startPos + 2; // after [^
        const labelEnd = labelStart + label.length;
        const markEnd = startPos + markLen; // after [^label]:
        // endPos - 1 to exclude trailing newline
        const bodyEnd = endPos - 1;

        const elts = [
          cx.elt("FootnoteDefMark", startPos, startPos + 2), // [^
          cx.elt("FootnoteDefLabel", labelStart, labelEnd),
          cx.elt("FootnoteDefMark", labelEnd, markEnd), // ]:
        ];
        if (bodyEnd > markEnd) {
          elts.push(
            cx.elt(
              "FootnoteDefBody",
              markEnd,
              bodyEnd,
              cx.parser.parseInline(bodyText, markEnd),
            ),
          );
        }
        cx.addElement(
          cx.elt("FootnoteDefinition", startPos, bodyEnd, elts),
        );
        return true;
      },
      before: "LinkReference",
    },
  ],
};

const inlineFootnoteRegex = /^\^\[([^\]]+)\]/;

export const InlineFootnote: MarkdownConfig = {
  defineNodes: [
    { name: "InlineFootnote" },
    { name: "InlineFootnoteMark", style: t.processingInstruction },
    { name: "InlineFootnoteContent", style: ct.InlineFootnoteTag },
  ],
  parseInline: [
    {
      name: "InlineFootnote",
      parse(cx, next, pos) {
        if (next !== 94 /* '^' */) {
          return -1;
        }
        const match = inlineFootnoteRegex.exec(cx.slice(pos, cx.end));
        if (!match) {
          return -1;
        }
        const endPos = pos + match[0].length;
        return cx.addElement(
          cx.elt("InlineFootnote", pos, endPos, [
            cx.elt("InlineFootnoteMark", pos, pos + 2), // ^[
            cx.elt("InlineFootnoteContent", pos + 2, endPos - 1), // content
            cx.elt("InlineFootnoteMark", endPos - 1, endPos), // ]
          ]),
        );
      },
      after: "Emphasis",
    },
  ],
};
