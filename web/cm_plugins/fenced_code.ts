import { WidgetContent } from "../../plug-api/app_event.ts";
import { Decoration, EditorState, syntaxTree, WidgetType } from "../deps.ts";
import type { Client } from "../client.ts";
import { CodeWidgetCallback } from "../hooks/code_widget.ts";
import {
  decoratorStateField,
  invisibleDecoration,
  isCursorInRange,
} from "./util.ts";
import { panelHtml } from "../components/panel_html.ts";

class IFrameWidget extends WidgetType {
  iframe?: HTMLIFrameElement;

  constructor(
    readonly from: number,
    readonly to: number,
    readonly editor: Client,
    readonly bodyText: string,
    readonly codeWidgetCallback: CodeWidgetCallback,
  ) {
    super();
  }

  toDOM(): HTMLElement {
    const iframe = document.createElement("iframe");
    this.iframe = iframe;
    iframe.srcdoc = panelHtml;
    // iframe.style.height = "150px";

    const messageListener = (evt: any) => {
      (async () => {
        if (evt.source !== iframe.contentWindow) {
          return;
        }
        const data = evt.data;
        if (!data) {
          return;
        }
        switch (data.type) {
          case "event":
            await this.editor.dispatchAppEvent(data.name, ...data.args);
            break;
          case "syscall": {
            const { id, name, args } = data;
            try {
              const result = await this.editor.system.localSyscall(name, args);
              if (!iframe.contentWindow) {
                // iFrame already went away
                return;
              }
              iframe.contentWindow!.postMessage({
                type: "syscall-response",
                id,
                result,
              });
            } catch (e: any) {
              if (!iframe.contentWindow) {
                // iFrame already went away
                return;
              }
              iframe.contentWindow!.postMessage({
                type: "syscall-response",
                id,
                error: e.message,
              });
            }
            break;
          }
          case "setHeight":
            iframe.style.height = data.height + "px";
            this.editor.space.setCachedWidgetHeight(this.bodyText, data.height);
            break;
          case "setBody":
            this.editor.editorView.dispatch({
              changes: {
                from: this.from,
                to: this.to,
                insert: data.body,
              },
            });
            break;
          case "blur":
            this.editor.editorView.dispatch({
              selection: { anchor: this.from },
            });
            this.editor.focus();
            break;
        }
      })().catch((e) => {
        console.error("Message listener error", e);
      });
    };

    iframe.onload = () => {
      // Subscribe to message event on global object (to receive messages from iframe)
      globalThis.addEventListener("message", messageListener);
      // Only run this code once
      iframe.onload = null;
      this.codeWidgetCallback(this.bodyText).then(
        (widgetContent: WidgetContent) => {
          if (widgetContent.html) {
            iframe.contentWindow!.postMessage({
              type: "html",
              html: widgetContent.html,
              script: widgetContent.script,
            });
          } else if (widgetContent.url) {
            iframe.contentWindow!.location.href = widgetContent.url;
            if (widgetContent.height) {
              iframe.style.height = widgetContent.height + "px";
            }
            if (widgetContent.width) {
              iframe.style.width = widgetContent.width + "px";
            }
          }
        },
      );
    };
    return iframe;
  }

  get estimatedHeight(): number {
    const cachedHeight = this.editor.space.getCachedWidgetHeight(this.bodyText);
    // console.log("Calling estimated height", cachedHeight);
    return cachedHeight || 150;
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
