import type { EditorState } from "@codemirror/state";
import { Decoration } from "@codemirror/view";
import type { Client } from "../client.ts";
import { decoratorStateField } from "./util.ts";
import { MarkdownWidget } from "./markdown_widget.ts";
import { LuaWidget, type LuaWidgetContent } from "./lua_widget.ts";

export function postScriptPrefacePlugin(
  editor: Client,
) {
  const panelWidgetHook = editor.clientSystem.panelWidgetHook;
  return decoratorStateField((state: EditorState) => {
    if (!editor.clientSystem.scriptsLoaded) {
      console.info("System not yet ready, not rendering panel widgets.");
      return Decoration.none;
    }
    const widgets: any[] = [];

    // Plug based hooks
    const topCallback = panelWidgetHook.callbacks.get("top");
    if (topCallback) {
      widgets.push(
        Decoration.widget({
          widget: new MarkdownWidget(
            undefined,
            editor,
            `top:${editor.currentPage}`,
            "top",
            topCallback,
            "sb-markdown-top-widget",
          ),
          side: -1,
          block: true,
        }).range(0),
      );
    }
    // Event driven hooks
    widgets.push(
      Decoration.widget({
        widget: new LuaWidget(
          editor,
          `top:lua:${editor.currentPage}`,
          "top",
          async () => {
            const widgetResults = await client.dispatchAppEvent(
              "hooks:renderTopWidgets",
            );
            // console.log("Widget results", widgetResults);
            const accumulatedWidget: LuaWidgetContent = {
              _isWidget: true,
              html: "",
              markdown: "",
              display: "block",
              cssClasses: ["sb-lua-top-widget"],
            };
            for (const widget of widgetResults) {
              if (widget.html) {
                accumulatedWidget.html += widget.html;
              }
              if (widget.markdown) {
                accumulatedWidget.markdown += widget.markdown + "\n";
              }
            }
            if (accumulatedWidget.markdown || accumulatedWidget.html) {
              return accumulatedWidget;
            } else {
              return null;
            }
          },
          false,
          false,
        ),
        side: -1,
        block: true,
      }).range(0),
    );

    // Bottom widgets
    // Hook driven widgets
    const bottomCallback = panelWidgetHook.callbacks.get("bottom");
    if (bottomCallback) {
      widgets.push(
        Decoration.widget({
          widget: new MarkdownWidget(
            undefined,
            editor,
            `bottom:${editor.currentPage}`,
            "bottom",
            bottomCallback,
            "sb-markdown-bottom-widget",
          ),
          side: 1,
          block: true,
        }).range(state.doc.length),
      );
    }

    // Event driven widgets
    widgets.push(
      Decoration.widget({
        widget: new LuaWidget(
          editor,
          `bottom:lua:${editor.currentPage}`,
          "bottom",
          async () => {
            const widgetResults = await client.dispatchAppEvent(
              "hooks:renderBottomWidgets",
            );
            const accumulatedWidget: LuaWidgetContent = {
              _isWidget: true,
              html: "",
              markdown: "",
              display: "block",
              cssClasses: ["sb-lua-bottom-widget"],
            };
            for (const widget of widgetResults) {
              if (widget.html) {
                accumulatedWidget.html += widget.html;
              }
              if (widget.markdown) {
                accumulatedWidget.markdown += widget.markdown + "\n";
              }
            }
            if (accumulatedWidget.markdown || accumulatedWidget.html) {
              return accumulatedWidget;
            } else {
              return null;
            }
          },
          false,
          false,
        ),
        side: 1,
        block: true,
      }).range(state.doc.length),
    );
    return Decoration.set(widgets);
  });
}
