import { panelHtml } from "../components/panel.tsx";
import { Decoration, EditorState, WidgetType } from "../deps.ts";
import type { Client } from "../client.ts";
import { decoratorStateField } from "./util.ts";
import { PanelConfig } from "../types.ts";

class IFrameWidget extends WidgetType {
  constructor(
    readonly editor: Client,
    readonly panel: PanelConfig,
  ) {
    super();
  }

  toDOM(): HTMLElement {
    const iframe = document.createElement("iframe");
    iframe.classList.add("sb-ps-iframe");
    iframe.srcdoc = panelHtml;
    console.log("Creating new instance of postscript");
    // iframe.style.height = "0";

    const messageListener = (evt: any) => {
      if (evt.source !== iframe.contentWindow) {
        return;
      }
      const data = evt.data;
      if (!data) {
        return;
      }
      switch (data.type) {
        case "event":
          this.editor.dispatchAppEvent(data.name, ...data.args);
          break;
        case "setHeight":
          iframe.style.height = data.height + "px";
          break;
      }
    };

    iframe.onload = () => {
      // Subscribe to message event on global object (to receive messages from iframe)
      globalThis.addEventListener("message", messageListener);
      // Only run this code once
      iframe.onload = null;
      if (this.panel.html) {
        iframe.contentWindow!.postMessage({
          type: "html",
          html: this.panel.html,
          script: this.panel.script,
        });
      }
    };
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
