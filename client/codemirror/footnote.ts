import { syntaxTree } from "@codemirror/language";
import { Decoration, EditorView, WidgetType } from "@codemirror/view";
import { hoverTooltip } from "@codemirror/view";
import type { EditorState, Extension } from "@codemirror/state";
import { decoratorStateField, isCursorInRange } from "./util.ts";
import { parseMarkdown } from "../markdown_parser/parser.ts";
import { renderMarkdownToHtml } from "../markdown_renderer/markdown_render.ts";

function outdentFootnoteBody(text: string): string {
  return text.replace(/^(?:    |\t)/gm, "");
}

function renderMarkdownTooltip(markdownText: string): HTMLElement {
  const dom = document.createElement("div");
  dom.className = "sb-footnote-tooltip";
  const tree = parseMarkdown(outdentFootnoteBody(markdownText.trim()));
  dom.innerHTML = renderMarkdownToHtml(tree);
  return dom;
}

class InlineFootnoteWidget extends WidgetType {
  constructor(readonly content: string) {
    super();
  }

  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "sb-footnote-ref";
    span.textContent = "…";
    return span;
  }

  override eq(other: WidgetType): boolean {
    return (
      other instanceof InlineFootnoteWidget && this.content === other.content
    );
  }
}

class FootnoteRefWidget extends WidgetType {
  constructor(
    readonly label: string,
    readonly resolved: boolean,
    readonly callback: (e: MouseEvent) => void,
  ) {
    super();
  }

  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = this.resolved
      ? "sb-footnote-ref"
      : "sb-footnote-ref sb-footnote-ref-unresolved";
    span.textContent = "…";
    // Use mousedown to intercept before CodeMirror moves the cursor
    // (which would remove the widget via isCursorInRange)
    span.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.callback(e);
    });
    return span;
  }

  override eq(other: WidgetType): boolean {
    return (
      other instanceof FootnoteRefWidget &&
      this.label === other.label &&
      this.resolved === other.resolved
    );
  }
}

type FootnoteDefInfo = { bodyText: string; from: number } | null;

function findFootnoteDef(
  state: EditorState,
  targetLabel: string,
): FootnoteDefInfo {
  let result: FootnoteDefInfo = null;
  syntaxTree(state).iterate({
    enter: ({ type, from, to, node }) => {
      if (type.name === "FootnoteDefinition" && !result) {
        const cursor = node.cursor();
        cursor.firstChild();
        do {
          if (cursor.name === "FootnoteDefLabel") {
            const labelText = state.sliceDoc(cursor.from, cursor.to);
            if (labelText === targetLabel) {
              const bodyCursor = node.cursor();
              bodyCursor.firstChild();
              do {
                if (bodyCursor.name === "FootnoteDefBody") {
                  result = {
                    bodyText: state.sliceDoc(bodyCursor.from, bodyCursor.to),
                    from: from,
                  };
                  break;
                }
              } while (bodyCursor.nextSibling());
            }
            break;
          }
        } while (cursor.nextSibling());
      }
    },
  });
  return result;
}

function footnoteRefDecorator(editorView: () => EditorView) {
  return decoratorStateField((state) => {
    const widgets: any[] = [];

    syntaxTree(state).iterate({
      enter: ({ type, from, to, node }) => {
        if (type.name !== "FootnoteRef") {
          return;
        }

        if (isCursorInRange(state, [from, to])) {
          return;
        }

        // Extract label from the FootnoteRefLabel child
        const cursor = node.cursor();
        let labelText = "";
        cursor.firstChild();
        do {
          if (cursor.name === "FootnoteRefLabel") {
            labelText = state.sliceDoc(cursor.from, cursor.to);
            break;
          }
        } while (cursor.nextSibling());

        if (labelText) {
          const resolved = findFootnoteDef(state, labelText) !== null;
          const refFrom = from;
          widgets.push(
            Decoration.replace({
              widget: new FootnoteRefWidget(labelText, resolved, (e) => {
                const view = editorView();
                if (e.altKey || !resolved) {
                  // Alt-click or unresolved: move cursor into the ref marker
                  view.dispatch({
                    selection: { anchor: refFrom + 2 }, // after [^
                  });
                  view.focus();
                } else {
                  // Normal click: jump to definition
                  const def = findFootnoteDef(state, labelText);
                  if (def) {
                    view.dispatch({
                      selection: { anchor: def.from },
                      scrollIntoView: true,
                    });
                    view.focus();
                  }
                }
              }),
            }).range(from, to),
          );
        }
      },
    });

    return Decoration.set(widgets, true);
  });
}

const inlineFootnoteDecorator = decoratorStateField((state) => {
  const widgets: any[] = [];

  syntaxTree(state).iterate({
    enter: ({ type, from, to, node }) => {
      if (type.name !== "InlineFootnote") {
        return;
      }

      if (isCursorInRange(state, [from, to])) {
        return;
      }

      // Extract content from the InlineFootnoteContent child
      const cursor = node.cursor();
      let content = "";
      cursor.firstChild();
      do {
        if (cursor.name === "InlineFootnoteContent") {
          content = state.sliceDoc(cursor.from, cursor.to);
          break;
        }
      } while (cursor.nextSibling());

      if (content) {
        widgets.push(
          Decoration.replace({
            widget: new InlineFootnoteWidget(content),
          }).range(from, to),
        );
      }
    },
  });

  return Decoration.set(widgets, true);
});

const footnoteDefDecorator = decoratorStateField((state) => {
  const widgets: any[] = [];

  syntaxTree(state).iterate({
    enter: ({ type, from, to }) => {
      if (type.name !== "FootnoteDefinition") {
        return;
      }

      const firstLine = state.doc.lineAt(from);
      const lastLine = state.doc.lineAt(to);
      for (let l = firstLine.number; l <= lastLine.number; l++) {
        widgets.push(
          Decoration.line({
            class: "sb-footnote-def-line",
          }).range(state.doc.line(l).from),
        );
      }
    },
  });

  return Decoration.set(widgets, true);
});

const footnoteTooltip = hoverTooltip((view, pos) => {
  const tree = syntaxTree(view.state);
  const node = tree.resolveInner(pos, 1);

  // Check if we're hovering over a FootnoteRef or its children
  let refNode = node;
  while (refNode && refNode.name !== "FootnoteRef") {
    refNode = refNode.parent!;
  }
  if (!refNode || refNode.name !== "FootnoteRef") {
    return null;
  }

  // Extract label
  const cursor = refNode.cursor();
  let labelText = "";
  cursor.firstChild();
  do {
    if (cursor.name === "FootnoteRefLabel") {
      labelText = view.state.sliceDoc(cursor.from, cursor.to);
      break;
    }
  } while (cursor.nextSibling());

  if (!labelText) {
    return null;
  }

  const def = findFootnoteDef(view.state, labelText);

  return {
    pos: refNode.from,
    end: refNode.to,
    above: true,
    create() {
      if (def) {
        return { dom: renderMarkdownTooltip(def.bodyText) };
      }
      const dom = document.createElement("div");
      dom.className = "sb-footnote-tooltip sb-footnote-tooltip-error";
      dom.textContent = `Footnote [^${labelText}] is not defined`;
      return { dom };
    },
  };
});

const inlineFootnoteTooltip = hoverTooltip((view, pos) => {
  const tree = syntaxTree(view.state);
  const node = tree.resolveInner(pos, 1);

  // Check if we're hovering over an InlineFootnote or its children
  let fnNode = node;
  while (fnNode && fnNode.name !== "InlineFootnote") {
    fnNode = fnNode.parent!;
  }
  if (!fnNode || fnNode.name !== "InlineFootnote") {
    return null;
  }

  // Extract content
  const cursor = fnNode.cursor();
  let content = "";
  cursor.firstChild();
  do {
    if (cursor.name === "InlineFootnoteContent") {
      content = view.state.sliceDoc(cursor.from, cursor.to);
      break;
    }
  } while (cursor.nextSibling());

  if (!content) {
    return null;
  }

  return {
    pos: fnNode.from,
    end: fnNode.to,
    above: true,
    create() {
      return { dom: renderMarkdownTooltip(content) };
    },
  };
});

export function footnotePlugin(editorView: () => EditorView): Extension[] {
  return [
    footnoteRefDecorator(editorView),
    inlineFootnoteDecorator,
    footnoteDefDecorator,
    footnoteTooltip,
    inlineFootnoteTooltip,
  ];
}
