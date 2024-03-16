import { EditorState } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { Decoration } from "@codemirror/view";
import type { Client } from "../client.ts";
import {
  decoratorStateField,
  invisibleDecoration,
  isCursorInRange,
  shouldRenderAsCode,
} from "./util.ts";
import { MarkdownWidget } from "./markdown_widget.ts";
import { IFrameWidget } from "./iframe_widget.ts";
import { isTemplate } from "../../lib/cheap_yaml.ts";

export function fencedCodePlugin(editor: Client) {
  return decoratorStateField((state: EditorState) => {
    const widgets: any[] = [];
    syntaxTree(state).iterate({
      enter({ from, to, name, node }) {
        if (name === "FencedCode") {
          if (shouldRenderAsCode(state, [from, to])) {
            // Don't render the widget if the cursor is inside the fenced code
            return;
          }
          const text = state.sliceDoc(from, to);
          const [_, lang] = text.match(/^(?:```+|~~~+)(\w+)?/)!;
          const codeWidgetCallback = editor.clientSystem.codeWidgetHook
            .codeWidgetCallbacks
            .get(lang);
          const renderMode = editor.clientSystem.codeWidgetHook.codeWidgetModes
            .get(
              lang,
            );
          // Only custom render when we have a custom renderer, and the current page is not a template
          if (codeWidgetCallback && !isTemplate(state.sliceDoc(0, from))) {
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

            const bodyText = lineStrings.slice(1, lineStrings.length - 1).join(
              "\n",
            );
            const widget = renderMode === "markdown"
              ? new MarkdownWidget(
                from + lineStrings[0].length + 1,
                editor,
                `widget:${editor.currentPage}:${bodyText}`,
                bodyText,
                codeWidgetCallback,
                "sb-markdown-widget",
              )
              : new IFrameWidget(
                from + lineStrings[0].length + 1,
                to - lineStrings[lineStrings.length - 1].length - 1,
                editor,
                lineStrings.slice(1, lineStrings.length - 1).join("\n"),
                codeWidgetCallback,
              );
            widgets.push(
              Decoration.widget({
                widget: widget,
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
