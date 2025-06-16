import type { EditorState } from "@codemirror/state";
import { Decoration } from "@codemirror/view";
import type { Client } from "../client.ts";
import { decoratorStateField } from "./util.ts";
import { LuaWidget, type LuaWidgetContent } from "./lua_widget.ts";

export function postScriptPrefacePlugin(
  editor: Client,
) {
  return decoratorStateField((state: EditorState) => {
    if (!editor.clientSystem.scriptsLoaded) {
      console.info("System not yet ready, not rendering panel widgets.");
      return Decoration.none;
    }
    const widgets: any[] = [];

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
