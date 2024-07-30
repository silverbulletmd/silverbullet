import type { EditorState } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { Decoration } from "@codemirror/view";
import type { SyntaxNodeRef } from "@lezer/common";
import { decoratorStateField, isCursorInRange } from "./util.ts";

const ADMONITION_REGEX =
  /^>( *)(?:\*{2}|\[!)(.*?)(\*{2}|\])( *)(.*)(?:\n([\s\S]*))?/im;
const ADMONITION_LINE_SPLIT_REGEX = /\n>/gm;

type AdmonitionFields = {
  preSpaces: string;
  admonitionType: string;
  postSyntax: string;
  postSpaces: string;
  admonitionTitle: string;
  admonitionContent: string;
};

// Given the raw text of an entire Blockquote, match an Admonition block.
// If matched, extract relevant fields using regex capture groups and return them
// as an object.
//
// If not matched return null.
//
// Example Admonition block (github formatted):
//
// > **note** I am an Admonition Title
// > admonition text
//
// or
// > [!note] I am an Admonition Title
// > admonition text

function extractAdmonitionFields(rawText: string): AdmonitionFields | null {
  const regexResults = rawText.match(ADMONITION_REGEX);

  if (regexResults) {
    const preSpaces = regexResults[1] || "";
    const admonitionType = regexResults[2];
    const postSyntax = regexResults[3];
    const postSpaces = regexResults[4] || "";
    const admonitionTitle: string = regexResults[5] || "";
    const admonitionContent: string = regexResults[6] || "";

    return {
      preSpaces,
      admonitionType,
      postSyntax,
      postSpaces,
      admonitionTitle,
      admonitionContent,
    };
  }

  return null;
}

export function admonitionPlugin() {
  return decoratorStateField((state: EditorState) => {
    const widgets: any[] = [];

    syntaxTree(state).iterate({
      enter: (node: SyntaxNodeRef) => {
        const { type, from, to } = node;

        if (type.name === "Blockquote") {
          // Extract raw text from admonition block
          const rawText = state.sliceDoc(from, to);

          // Split text into type, title and content using regex capture groups
          const extractedFields = extractAdmonitionFields(rawText);

          // Bailout here if we don't have a proper Admonition formatted blockquote
          if (!extractedFields) {
            return;
          }

          const { preSpaces, admonitionType, postSyntax } = extractedFields;

          // A blockquote is actually rendered as many divs, one per line.
          // We need to keep track of the `from` offsets here, so we can attach css
          // classes to them further down.
          const fromOffsets: number[] = [];
          const lines = rawText.slice(1).split(ADMONITION_LINE_SPLIT_REGEX);
          let accum = from;
          lines.forEach((line) => {
            fromOffsets.push(accum);
            accum += line.length + 2;
          });

          // `from` and `to` range info for switching out keyword text with correct
          // icon further down.
          const iconRange = {
            from: from + 2,
            to: from + preSpaces.length + 2 + admonitionType.length +
              postSyntax.length + 1,
          };

          // The first div is the title, attach title css class
          widgets.push(
            Decoration.line({
              class: "sb-admonition-title",
            }).range(fromOffsets[0]),
          );

          // If cursor is not within the first line, replace the keyword text
          // with the icon
          if (
            !isCursorInRange(state, [
              from,
              fromOffsets.length > 1 ? fromOffsets[1] : to,
            ])
          ) {
            widgets.push(
              Decoration.mark({
                tagName: "span",
                class: "sb-admonition-type",
              }).range(iconRange.from, iconRange.to),
            );
          }

          // Each line of the blockquote is spread across separate divs, attach
          // relevant css classes and attribute here.
          fromOffsets.forEach((fromOffset) => {
            widgets.push(
              Decoration.line({
                attributes: { admonition: admonitionType },
                class: "sb-admonition",
              }).range(fromOffset),
            );
          });
        }
      },
    });

    return Decoration.set(widgets, true);
  });
}
