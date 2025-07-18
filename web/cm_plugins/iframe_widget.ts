import { WidgetType } from "@codemirror/view";
import type { Client } from "../client.ts";
import { createWidgetSandboxIFrame } from "../components/widget_sandbox_iframe.ts";
import type {
  CodeWidgetCallback,
  CodeWidgetContent,
} from "@silverbulletmd/silverbullet/type/client";

export class IFrameWidget extends WidgetType {
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

  override get estimatedHeight(): number {
    const cachedHeight = this.client.getCachedWidgetHeight(this.bodyText);
    // console.log("Calling estimated height", this.bodyText, cachedHeight);
    return cachedHeight > 0 ? cachedHeight : 150;
  }

  toDOM(): HTMLElement {
    const from = this.from;
    const iframe = createWidgetSandboxIFrame(
      this.client,
      this.bodyText,
      this.codeWidgetCallback(this.bodyText, this.client.currentPage),
      (message) => {
        switch (message.type) {
          case "blur":
            this.client.editorView.dispatch({
              selection: { anchor: from },
            });
            this.client.focus();

            break;
          case "reload":
            this.codeWidgetCallback(this.bodyText, this.client.currentPage)
              .then(
                (widgetContent: CodeWidgetContent | null) => {
                  if (widgetContent === null) {
                    iframe.contentWindow!.postMessage({
                      type: "html",
                      html: "",
                      theme:
                        document.getElementsByTagName("html")[0].dataset.theme,
                    });
                  } else {
                    iframe.contentWindow!.postMessage({
                      type: "html",
                      html: widgetContent.html,
                      script: widgetContent.script,
                      theme:
                        document.getElementsByTagName("html")[0].dataset.theme,
                    });
                  }
                },
              );
            break;
        }
      },
    );

    const estimatedHeight = this.estimatedHeight;
    iframe.style.height = `${estimatedHeight}px`;

    return iframe;
  }

  override eq(other: WidgetType): boolean {
    return (
      other instanceof IFrameWidget &&
      other.bodyText === this.bodyText
    );
  }
}
