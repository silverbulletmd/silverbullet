import {
  Decoration,
  EditorState,
  EditorView,
  SyntaxNodeRef,
  syntaxTree,
  WidgetType,
} from "../deps.ts";
import { Client } from "../client.ts";
import { decoratorStateField, isCursorInRange } from "./util.ts";

type AdmonitionType = "note" | "warning";

const ADMONITION_REGEX =
  /^>( *)\*{2}(Note|Warning)\*{2}( *)(.*)(?:\n([\s\S]*))?/im;
const ADMONITION_LINE_SPLIT_REGEX = /\n>/gm;

class AdmonitionIconWidget extends WidgetType {
  constructor(
    readonly pos: number,
    readonly type: AdmonitionType,
    readonly editorView: EditorView,
  ) {
    super();
  }

  toDOM(): HTMLElement {
    const outerDiv = document.createElement("div");
    outerDiv.classList.add("sb-admonition-icon");
    outerDiv.addEventListener("click", () => {
      this.editorView.dispatch({
        selection: {
          anchor: this.pos,
        },
      });
    });

    switch (this.type) {
      case "note":
        outerDiv.insertAdjacentHTML(
          "beforeend",
          '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>',
        );
        break;
      case "warning":
        outerDiv.insertAdjacentHTML(
          "beforeend",
          '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>',
        );
        break;
      default:
        //
    }

    return outerDiv;
  }
}

type AdmonitionFields = {
  preSpaces: string;
  admonitionType: AdmonitionType;
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
function extractAdmonitionFields(rawText: string): AdmonitionFields | null {
  const regexResults = rawText.match(ADMONITION_REGEX);

  if (regexResults) {
    const preSpaces = regexResults[1] || "";
    const admonitionType = regexResults[2].toLowerCase() as AdmonitionType;
    const postSpaces = regexResults[3] || "";
    const admonitionTitle: string = regexResults[4] || "";
    const admonitionContent: string = regexResults[5] || "";

    return {
      preSpaces,
      admonitionType,
      postSpaces,
      admonitionTitle,
      admonitionContent,
    };
  }

  return null;
}

export function admonitionPlugin(editor: Client) {
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

          const { preSpaces, admonitionType, postSpaces } = extractedFields;

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

          // `from` and `to` range info for switching out **info|warning** text with correct
          // icon further down.
          const iconRange = {
            from: from + 1,
            to: from + preSpaces.length + 2 + admonitionType.length + 2 +
              postSpaces.length + 1,
          };

          const classes = ["sb-admonition"];
          switch (admonitionType) {
            case "note":
              classes.push("sb-admonition-note");
              break;
            case "warning":
              classes.push("sb-admonition-warning");
              break;
            default:
              //
          }

          // The first div is the title, attach relevant css classes
          widgets.push(
            Decoration.line({
              class: "sb-admonition-title " + classes.join(" "),
            }).range(fromOffsets[0]),
          );

          // If cursor is not within the first line, replace the **note|warning** text
          // with the correct icon
          if (
            !isCursorInRange(state, [
              from,
              fromOffsets.length > 1 ? fromOffsets[1] : to,
            ])
          ) {
            widgets.push(
              Decoration.replace({
                widget: new AdmonitionIconWidget(
                  iconRange.from + 1,
                  admonitionType,
                  editor.editorView,
                ),
                inclusive: true,
              }).range(iconRange.from, iconRange.to),
            );
          }

          // Each line of the blockquote is spread across separate divs, attach
          // relevant css classes here.
          fromOffsets.slice(1).forEach((fromOffset) => {
            widgets.push(
              Decoration.line({ class: classes.join(" ") }).range(fromOffset),
            );
          });
        }
      },
    });

    return Decoration.set(widgets, true);
  });
}
