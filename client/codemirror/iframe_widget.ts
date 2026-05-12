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
    readonly client: Client,
    readonly bodyText: string,
    readonly codeWidgetCallback: CodeWidgetCallback,
  ) {
    super();
    // Eagerly kick off the callback so the result is in flight before
    // CodeMirror mounts the widget. Idempotent on bodyText.
    this.client.widgetCache.prewarmResult(this.bodyText, () =>
      this.codeWidgetCallback(this.bodyText, this.client.currentName()),
    ).catch(() => {
      // renderContent / iframe message handler will surface errors.
    });
  }

  override get estimatedHeight(): number {
    const cachedHeight = this.client.widgetCache.getCachedWidgetHeight(
      this.bodyText,
    );
    // console.log("Calling estimated height", this.bodyText, cachedHeight);
    return cachedHeight > 0 ? cachedHeight : 150;
  }

  toDOM(): HTMLElement {
    const iframe = createWidgetSandboxIFrame(
      this.client,
      this.bodyText,
      this.client.widgetCache.prewarmResult(this.bodyText, () =>
        this.codeWidgetCallback(this.bodyText, this.client.currentName()),
      ),
      (message) => {
        switch (message.type) {
          case "blur": {
            const pos = this.client.editorView.posAtDOM(iframe, 0);
            this.client.editorView.dispatch({
              selection: { anchor: pos },
            });
            this.client.focus();

            break;
          }
          case "reload":
            // Force-refresh: drop any prewarmed result and re-run.
            this.client.widgetCache.invalidatePrewarm(this.bodyText);
            void this.codeWidgetCallback(
              this.bodyText,
              this.client.currentName(),
            ).then((widgetContent: CodeWidgetContent | null) => {
              if (widgetContent === null) {
                iframe.contentWindow!.postMessage({
                  type: "html",
                  html: "",
                  theme: document.getElementsByTagName("html")[0].dataset.theme,
                });
              } else {
                iframe.contentWindow!.postMessage({
                  type: "html",
                  html: widgetContent.html,
                  script: widgetContent.script,
                  theme: document.getElementsByTagName("html")[0].dataset.theme,
                });
              }
            });
            break;
        }
      },
    );

    const estimatedHeight = this.estimatedHeight;
    iframe.style.height = `${estimatedHeight}px`;

    return iframe;
  }

  override eq(other: WidgetType): boolean {
    return other instanceof IFrameWidget && other.bodyText === this.bodyText;
  }
}
