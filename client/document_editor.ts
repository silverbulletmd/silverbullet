import type { Client } from "./client.ts";
import { timeout } from "@silverbulletmd/silverbullet/lib/async";
import type { DocumentMeta } from "@silverbulletmd/silverbullet/type/index";
import type { Ref } from "@silverbulletmd/silverbullet/lib/ref";
import documentEditorJS from "./document_editor_js.ts";
import type { DocumentEditorContent } from "@silverbulletmd/silverbullet/type/client";
import type { DocumentEditorResolution } from "./document_editor_resolver.ts";

export type ActiveDocumentEditor = {
  name: string;
  extension: string;
  needsBytes: boolean;
  openFile(
    data: Uint8Array | undefined,
    meta: DocumentMeta,
    details: Ref["details"],
  ): Promise<void> | void;
  requestSave(): Promise<void> | void;
  focus(): void;
  destroy(): Promise<void> | void;
  updateTheme(): void;
  sendPublicMessage?(message: { type: string; data?: any }): void;
};

export class IFrameDocumentEditor implements ActiveDocumentEditor {
  readonly needsBytes = true;
  iframe!: HTMLIFrameElement;
  name!: string;
  extension!: string;
  currentPath: string | null = null;
  savePromise: PromiseWithResolvers<void> | null = null;

  constructor(
    readonly parent: HTMLElement,
    readonly client: Client,
    readonly saveMethod: (path: string, content: Uint8Array) => void,
  ) {}

  async init(resolution: Extract<DocumentEditorResolution, { kind: "plug" }>) {
    this.extension = resolution.extension;
    this.name = resolution.name;

    const content = await resolution.callback();

    globalThis.addEventListener("message", this.handleMessage.bind(this));

    const { iframe, ready } = IFrameDocumentEditor.createIframe(content);
    this.iframe = iframe;

    this.parent.appendChild(this.iframe);

    await ready;
  }

  async destroy() {
    // If name isn't initalized the editor is probably dead
    if (!this.name) return;

    await this.waitForSave();

    this.iframe.remove();
  }

  sendPublicMessage(message: { type: string; data?: any }) {
    this.sendMessage(message);
  }

  openFile(
    data: Uint8Array | undefined,
    meta: DocumentMeta,
    details: Ref["details"],
  ) {
    if (!data) throw new Error("Document editor requires file bytes");
    this.sendMessage({
      type: "file-open",
      data: {
        data,
        meta,
        details,
      },
    });

    this.currentPath = meta.name;
    this.extension = meta.extension.toLowerCase();
  }

  requestSave() {
    if (this.savePromise) {
      console.log(
        "Save was already requested from editor, trying again anyways",
      );
    } else {
      this.savePromise = Promise.withResolvers();
    }

    this.sendMessage({
      type: "request-save",
    });
  }

  focus() {
    this.sendMessage({
      type: "focus",
    });
  }

  private async waitForSave() {
    if (this.savePromise) {
      try {
        await Promise.race([this.savePromise.promise, timeout(2500)]);
      } catch {
        this.savePromise.resolve();
        this.savePromise = null;

        console.log(
          "Unable to save content of document editor in 2.5s. Aborting save",
        );
      }
    }
  }

  private sendMessage(message: {
    type: string;
    internal?: boolean;
    data?: any;
  }) {
    if (!this.iframe?.contentWindow) return;
    message.internal ??= false;
    this.iframe.contentWindow.postMessage(message);
  }

  private async handleMessage(event: any) {
    if (event.source !== this.iframe.contentWindow) return;
    const response = event.data;
    if (!response) return;

    const data = response.data;

    switch (response.type) {
      case "file-changed":
        {
          this.client.ui.viewDispatch({
            type: "document-editor-changed",
          });
          this.client.save().catch((e) => console.error("Couldn't save: ", e));
        }
        break;
      case "file-saved":
        {
          this.savePromise?.resolve();
          this.savePromise = null;

          if (!this.currentPath) return;
          this.saveMethod(this.currentPath, data.data);
        }
        break;
      case "syscall":
        {
          let result: any;

          try {
            const response = await this.client.clientSystem.localSyscall(
              data.name,
              data.args,
            );

            result = { result: response };
          } catch (e: any) {
            result = { error: e.message };
          }

          this.sendMessage({
            type: "syscall-response",
            internal: true,
            data: {
              id: data.id,
              ...result,
            },
          });
        }
        break;
      default:
        console.warn("Unknown event sent from plug: ", data.type);
    }
  }

  updateTheme() {
    this.sendMessage({
      type: "set-theme",
      internal: true,
      data: {
        theme: this.client.ui.viewState.uiOptions.darkMode ? "dark" : "light",
      },
    });
  }

  private static createIframe(content: DocumentEditorContent): {
    iframe: HTMLIFrameElement;
    ready: Promise<void>;
  } {
    const doc = new DOMParser().parseFromString(content.html, "text/html");

    // This is only for legacy support
    if ((content as any).script) {
      console.warn(
        "Providing a `script` property with your document editor is deprecated. Inline the script into your HTML instead.",
      );

      const script = doc.createElement("script");
      script.type = "text/javascript";
      script.text = (content as any).script;
      doc.body.appendChild(script);

      // Ensure the automatically created html/body fill the iframe.
      const style = doc.createElement("style");
      style.textContent =
        "html, body { width: 100%; height: 100%; margin: 0; }";
      doc.head.appendChild(style);
    }

    const script = doc.createElement("script");
    script.type = "text/javascript";
    script.text = documentEditorJS;
    doc.head.prepend(script);

    const base = doc.createElement("base");
    base.href = document.baseURI;
    doc.head.prepend(base);

    // This isn't great, but the only way to get the up-to-date theme without
    // using media queries
    const theme = document.querySelector("html")?.getAttribute("data-theme");
    doc.querySelector("html")!.setAttribute("data-theme", theme ?? "light");

    const iframe = document.createElement("iframe");
    iframe.srcdoc = doc.documentElement.outerHTML;

    const ready = new Promise<void>((resolve) => {
      iframe.addEventListener("load", () => resolve(), { once: true });
    });

    return { iframe, ready };
  }
}
