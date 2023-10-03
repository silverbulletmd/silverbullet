import { Decoration, EditorState, WidgetType } from "../deps.ts";
import type { Client } from "../client.ts";
import { decoratorStateField } from "./util.ts";
import { PanelConfig } from "../types.ts";
import { createWidgetSandboxIFrame } from "../components/widget_sandbox_iframe.ts";

class IFrameWidget extends WidgetType {
  constructor(
    readonly editor: Client,
    readonly panel: PanelConfig,
  ) {
    super();
  }

  toDOM(): HTMLElement {
    const iframe = createWidgetSandboxIFrame(this.editor, null, this.panel);
    iframe.classList.add("sb-ps-iframe");
    return iframe;
  }

  eq(other: WidgetType): boolean {
    return this.panel.html ===
        (other as IFrameWidget).panel.html &&
      this.panel.script ===
        (other as IFrameWidget).panel.script;
  }
}

export function postScriptPlugin(editor: Client) {
  return decoratorStateField((state: EditorState) => {
    const widgets: any[] = [];
    if (editor.ui.viewState.panels.ps.html) {
      widgets.push(
        Decoration.widget({
          widget: new IFrameWidget(
            editor,
            editor.ui.viewState.panels.ps,
          ),
          side: 1,
          block: true,
        }).range(state.doc.length),
      );
    }
    return Decoration.set(widgets);
  });
}
