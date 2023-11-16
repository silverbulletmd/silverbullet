import { WidgetContent } from "../../plug-api/app_event.ts";
import { Decoration, EditorState, syntaxTree, WidgetType } from "../deps.ts";
import type { Client } from "../client.ts";
import {
  decoratorStateField,
  invisibleDecoration,
  isCursorInRange,
} from "./util.ts";
import { createWidgetSandboxIFrame } from "../components/widget_sandbox_iframe.ts";
import type { CodeWidgetCallback } from "$sb/types.ts";

class IFrameWidget extends WidgetType {
  iframe?: HTMLIFrameElement;

  constructor(
    readonly from: number,
    readonly to: number,
    readonly client: Client,
    readonly bodyText: string,
    readonly codeWidgetCallback: CodeWidgetCallback,
  ) {
    super();
  }

  toDOM(): HTMLElement {
    const from = this.from;
    const iframe = createWidgetSandboxIFrame(
      this.client,
      this.bodyText,
      this.codeWidgetCallback(this.bodyText, this.client.currentPage!),
      (message) => {
        switch (message.type) {
          case "blur":
            this.client.editorView.dispatch({
              selection: { anchor: from },
            });
            this.client.focus();

            break;
          case "reload":
            this.codeWidgetCallback(this.bodyText, this.client.currentPage!)
              .then(
                (widgetContent: WidgetContent) => {
                  iframe.contentWindow!.postMessage({
                    type: "html",
                    html: widgetContent.html,
                    script: widgetContent.script,
                    theme:
                      document.getElementsByTagName("html")[0].dataset.theme,
                  });
                },
              );
            break;
        }
      },
    );

    const estimatedHeight = this.estimatedHeight;
    iframe.height = `${estimatedHeight}px`;

    return iframe;
  }

  get estimatedHeight(): number {
    const cachedHeight = this.client.space.getCachedWidgetHeight(this.bodyText);
    // console.log("Calling estimated height", cachedHeight);
    return cachedHeight > 0 ? cachedHeight : 150;
  }

  eq(other: WidgetType): boolean {
    return (
      other instanceof IFrameWidget &&
      other.bodyText === this.bodyText
    );
  }
}

export function fencedCodePlugin(editor: Client) {
  return decoratorStateField((state: EditorState) => {
    const widgets: any[] = [];
    syntaxTree(state).iterate({
      enter({ from, to, name, node }) {
        if (name === "FencedCode") {
          if (isCursorInRange(state, [from, to])) return;
          const text = state.sliceDoc(from, to);
          const [_, lang] = text.match(/^```(\w+)?/)!;
          const codeWidgetCallback = editor.system.codeWidgetHook
            .codeWidgetCallbacks
            .get(lang);
          if (codeWidgetCallback) {
            // We got a custom renderer!
            const lineStrings = text.split("\n");

            const lines: { from: number; to: number }[] = [];
            let fromIt = from;
            for (const line of lineStrings) {
              lines.push({
                from: fromIt,
                to: fromIt + line.length,
              });
              fromIt += line.length + 1;
            }

            const firstLine = lines[0], lastLine = lines[lines.length - 1];

            // In case of doubt, back out
            if (!firstLine || !lastLine) return;

            widgets.push(
              invisibleDecoration.range(firstLine.from, firstLine.to),
            );
            widgets.push(
              invisibleDecoration.range(lastLine.from, lastLine.to),
            );
            widgets.push(
              Decoration.line({
                class: "sb-fenced-code-iframe",
              }).range(firstLine.from),
            );
            widgets.push(
              Decoration.line({
                class: "sb-fenced-code-hide",
              }).range(lastLine.from),
            );

            lines.slice(1, lines.length - 1).forEach((line) => {
              widgets.push(
                Decoration.line({ class: "sb-line-table-outside" }).range(
                  line.from,
                ),
              );
            });

            widgets.push(
              Decoration.widget({
                widget: new IFrameWidget(
                  from + lineStrings[0].length + 1,
                  to - lineStrings[lineStrings.length - 1].length - 1,
                  editor,
                  lineStrings.slice(1, lineStrings.length - 1).join("\n"),
                  codeWidgetCallback,
                ),
              }).range(from),
            );
            return false;
          }
          return true;
        }
        if (
          name === "CodeMark"
        ) {
          const parent = node.parent!;
          // Hide ONLY if CodeMark is not insine backticks (InlineCode) and the cursor is placed outside
          if (
            parent.node.name !== "InlineCode" &&
            !isCursorInRange(state, [parent.from, parent.to])
          ) {
            widgets.push(
              Decoration.line({
                class: "sb-line-code-outside",
              }).range(state.doc.lineAt(from).from),
            );
          }
        }
      },
    });
    return Decoration.set(widgets, true);
  });
}
