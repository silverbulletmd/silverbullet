import {
  Decoration,
  EditorState,
  EditorView,
  SyntaxNodeRef,
  syntaxTree,
  WidgetType,
} from "../deps.ts";
import { Editor } from "../editor.tsx";
import { decoratorStateField, isCursorInRange } from "./util.ts";

type AdmonitionType = "note" | "warning";

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
    outerDiv.addEventListener("click", (e) => {
      this.editorView.dispatch({
        selection: {
          anchor: this.pos,
        },
      });
    });

    switch (this.type) {
      case "note":
        outerDiv.insertAdjacentHTML("beforeend", '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>');
        break;
      case "warning":
        outerDiv.insertAdjacentHTML("beforeend", '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>');
        break;
      default:
        //
    }

    return outerDiv;
  }
}

export function admonitionPlugin(editor: Editor) {
  return decoratorStateField((state: EditorState) => {
    const widgets: any[] = [];

    syntaxTree(state).iterate({
      enter: (node: SyntaxNodeRef) => {
        const { type, from, to } = node;

        if (type.name !== "QuoteMark") {
          // extract raw text from admonition block
          const text = state.sliceDoc(from, to);

          // split text into type, title and content using regex capture groups
          const regexResults = text.match(/^>( *)\*{2}(Note|Warning)\*{2}( *)(.*)(?:\n([\s\S]*))?/im);
          if (!regexResults) {
            return;
          }

          const preSpaces = regexResults[1] || '';
          const admonitionType = regexResults[2].toLowerCase() as AdmonitionType;
          const postSpaces = regexResults[3] || '';
          const admonitionTitle: string = regexResults[4] || '';
          const admonitionContent: string = regexResults[5] || '';

          const fromOffsets: number[] = [];
          const lines = text.slice(1).split(/\n>/gm);
          let accum = from;
          lines.forEach(line => {
            fromOffsets.push(accum);
            accum += line.length + 2;
          });

          const iconRange = {
            from: from + 1,
            fromNoSpaces: from + preSpaces.length + 1,
            to: from + preSpaces.length + 2 + admonitionType.length + 2 + postSpaces.length + 1,
          };

          const classes = ["sb-admonition"];
          switch (admonitionType) {
            case 'note':
              classes.push("sb-admonition-note");
              break;
            case 'warning':
              classes.push("sb-admonition-warning");
              break;
            default:
              //
          }

          widgets.push(
            Decoration.line({ class: "sb-admonition-title " + classes.join(" ") }).range(fromOffsets[0]),
          );

          if (!isCursorInRange(state, [iconRange.fromNoSpaces, iconRange.to - 1])) {
            widgets.push(
              Decoration.replace({
                widget: new AdmonitionIconWidget(
                  iconRange.to,
                  admonitionType,
                  editor.editorView!,
                ),
                inclusive: true,
              }).range(iconRange.from, iconRange.to)
            );
          }

          fromOffsets.slice(1).forEach(fromOffset => {
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
