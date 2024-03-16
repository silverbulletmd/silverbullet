import { Client } from "../client.ts";
import { Range } from "@codemirror/state";
import { DecorationSet } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  ViewUpdate,
  WidgetType,
} from "@codemirror/view";

const ICON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-copy"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';

const EXCLUDE_LANGUAGES = ["template", "include", "query", "toc", "embed"];

class CodeCopyWidget extends WidgetType {
  constructor(readonly value: string, readonly client: Client) {
    super();
  }

  eq(other: CodeCopyWidget) {
    return other.value == this.value;
  }

  toDOM() {
    const wrap = document.createElement("span");
    wrap.setAttribute("aria-hidden", "true");
    wrap.className = "sb-actions";

    const button = wrap.appendChild(document.createElement("button"));
    button.type = "button";
    button.title = "Copy to clipboard";
    button.className = "sb-code-copy-button";
    button.innerHTML = ICON_SVG;
    button.title = "Copy";
    button.onclick = (e) => {
      e.stopPropagation();
      e.preventDefault();
      navigator.clipboard.writeText(this.value)
        .catch((err) => {
          this.client.flashNotification(
            `Error copying to clipboard: ${err}`,
            "error",
          );
        })
        .then(() => {
          this.client.flashNotification("Copied to clipboard", "info");
        });
    };

    return wrap;
  }

  ignoreEvent() {
    return true;
  }
}

function codeCopyDecoration(
  view: EditorView,
  client: Client,
) {
  const widgets: Range<Decoration>[] = [];
  for (const { from, to } of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from,
      to,
      enter: (node) => {
        if (node.name == "FencedCode") {
          const textNode = node.node.getChild("CodeText");
          const infoNode = node.node.getChild("CodeInfo");

          if (!textNode) {
            return;
          }

          const language = infoNode
            ? view.state.doc.sliceString(
              infoNode.from,
              infoNode.to,
            )
            : undefined;

          if (language && EXCLUDE_LANGUAGES.includes(language)) {
            return;
          }

          const text = view.state.doc.sliceString(textNode.from, textNode.to);
          const deco = Decoration.widget({
            widget: new CodeCopyWidget(text, client),
            side: 0,
          });
          widgets.push(deco.range(node.from));
        }
      },
    });
  }
  return Decoration.set(widgets);
}

export const codeCopyPlugin = (client: Client) => {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = codeCopyDecoration(view, client);
      }

      update(update: ViewUpdate) {
        if (
          update.docChanged || update.viewportChanged ||
          syntaxTree(update.startState) != syntaxTree(update.state)
        ) {
          this.decorations = codeCopyDecoration(update.view, client);
        }
      }
    },
    {
      decorations: (v) => v.decorations,
    },
  );
};
