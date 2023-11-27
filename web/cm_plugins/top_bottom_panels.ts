import { Decoration, EditorState, WidgetType } from "../deps.ts";
import type { Client } from "../client.ts";
import { decoratorStateField } from "./util.ts";
import { PanelConfig } from "../types.ts";
import { createWidgetSandboxIFrame } from "../components/widget_sandbox_iframe.ts";

class IFrameWidget extends WidgetType {
  widgetHeightCacheKey: string;
  constructor(
    readonly editor: Client,
    readonly panel: PanelConfig,
    readonly className: string,
  ) {
    super();
    this.widgetHeightCacheKey = `${this.editor.currentPage!}#${this.className}`;
  }

  toDOM(): HTMLElement {
    const iframe = createWidgetSandboxIFrame(
      this.editor,
      this.widgetHeightCacheKey,
      this.panel,
    );
    iframe.classList.add(this.className);
    return iframe;
  }

  get estimatedHeight(): number {
    return this.editor.space.getCachedWidgetHeight(
      this.widgetHeightCacheKey,
    );
  }

  eq(other: WidgetType): boolean {
    return this.panel.html ===
        (other as IFrameWidget).panel.html &&
      this.panel.script ===
        (other as IFrameWidget).panel.script;
  }
}

export function postScriptPrefacePlugin(editor: Client) {
  return decoratorStateField((state: EditorState) => {
    const widgets: any[] = [];
    if (editor.ui.viewState.panels.top.html) {
      widgets.push(
        Decoration.widget({
          widget: new IFrameWidget(
            editor,
            editor.ui.viewState.panels.top,
            "sb-top-iframe",
          ),
          side: -1,
          block: true,
        }).range(0),
      );
    }
    if (editor.ui.viewState.panels.bottom.html) {
      widgets.push(
        Decoration.widget({
          widget: new IFrameWidget(
            editor,
            editor.ui.viewState.panels.bottom,
            "sb-bottom-iframe",
          ),
          side: 1,
          block: true,
        }).range(state.doc.length),
      );
    }
    return Decoration.set(widgets);
  });
}
