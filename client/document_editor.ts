import type { Client } from "./client.ts";
import { timeout } from "@silverbulletmd/silverbullet/lib/async";
import type { DocumentMeta } from "@silverbulletmd/silverbullet/type/index";
import type { Ref } from "@silverbulletmd/silverbullet/lib/ref";
import documentEditorJS from "./document_editor_js.ts";
import type { DocumentEditorContent } from "@silverbulletmd/silverbullet/type/client";

export class DocumentEditor {
  iframe!: HTMLIFrameElement;
  name!: string;
  extension!: string;
  currentPath: string | null = null;
  savePromise: PromiseWithResolvers<void> | null = null;

  constructor(
    readonly parent: HTMLElement,
    readonly client: Client,
    readonly saveMethod: (path: string, content: Uint8Array) => void,
  ) {
  }

  async init(extension: string) {
    this.extension = extension;

    const entry = Array.from(
      this.client.clientSystem.documentEditorHook.documentEditors
        .entries(),
    ).find(([_, { extensions }]) => extensions.includes(this.extension));

    if (!entry) {
      throw new Error("Couldn't find plug for specified extension");
    }

    const [name, { callback }] = entry;
    this.name = name;

    const content = await callback();

    globalThis.addEventListener("message", this.handleMessage.bind(this));

    const { iframe, ready } = DocumentEditor.createIframe(content);
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
    data: Uint8Array,
    meta: DocumentMeta,
    details: Ref["details"],
  ) {
    this.sendMessage({
      type: "file-open",
      data: {
        data,
        meta,
        details,
      },
    });

    this.currentPath = meta.name;
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
        await Promise.race([
          this.savePromise.promise,
          timeout(2500),
        ]);
      } catch {
        this.savePromise.resolve();
        this.savePromise = null;

        console.log(
          "Unable to save content of document editor in 2.5s. Aborting save",
        );
      }
    }
  }

  private sendMessage(
    message: { type: string; internal?: boolean; data?: any },
  ) {
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

  private static createIframe(
    content: DocumentEditorContent,
  ): { iframe: HTMLIFrameElement; ready: Promise<void> } {
    const doc = new DOMParser().parseFromString(content.html, "text/html");

    // This is only for legacy support
    if ((content as any).script) {
      console.warn(
        "Providing a `script` property with your document editor is deprecated. Inline the script into your HTML instead.",
      );

      // Load the legacy script
      const script = doc.createElement("script");
      script.type = "text/javascript";
      script.text = (content as any).script;
      doc.body.appendChild(script);

      // Because now an html and body tag will be auto created, it can happen
      // that the content is not properly stretching those elements and the
      // content will stay small, let's try to mitgate this
      const style = doc.createElement("style");
      style.textContent =
        "html, body { width: 100%; height: 100%; margin: 0; }";
      doc.head.appendChild(style);
    }

    const script = doc.createElement("script");
    script.type = "text/javascript";
    script.text = documentEditorJS;
    doc.head.prepend(script);

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
