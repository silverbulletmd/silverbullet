import type { Client } from "./client.ts";
import { timeout } from "@silverbulletmd/silverbullet/lib/async";
import type { DocumentMeta } from "@silverbulletmd/silverbullet/type/index";
import type { Ref } from "@silverbulletmd/silverbullet/lib/ref";

type DocumentEditorIframeWindow = Window & {
  silverbullet: EventTarget & {
    syscall: (name: string, ...args: any[]) => any;
    sendMessage: (type: string, data?: any) => void;
  };
};

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

    const [iframe, ready] = DocumentEditor.createIframe(content.html);

    // These two have to happen in quick succession
    this.parent.appendChild(iframe);
    this.setupIframe(iframe);

    this.iframe = iframe;
    await ready;

    // This is only for legacy support
    if ((content as any).script) {
      console.warn(
        "Providing a `script` property with your document editor is deprecated. Inline the script into your HTML instead.",
      );

      if (this.iframe.contentDocument) {
        // Load the legacy script
        const script = this.iframe.contentDocument.createElement("script");
        script.type = "text/javascript";
        script.text = (content as any).script;
        this.iframe.contentDocument.head.appendChild(script);

        // Because now an html and body tag will be auto created, it can happen
        // that the content is not properly stretching those elements and the
        // content will stay small, let's try to mitgate this
        const style = this.iframe.contentDocument.createElement("style");
        style.textContent =
          "html, body { width: 100%; height: 100%; margin: 0; }";
        this.iframe.contentDocument.head.appendChild(style);
      }
    }

    this.updateTheme();
  }

  async destroy() {
    // If name isn't initalized the editor is probably dead
    if (!this.name) return;

    await this.waitForSave();

    this.iframe.remove();
  }

  sendPublicMessage(message: { type: string; data?: any }) {
    this.dispatchEvent(message);
  }

  openFile(
    data: Uint8Array,
    meta: DocumentMeta,
    details: Ref["details"],
  ) {
    this.dispatchEvent({
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

    this.dispatchEvent({
      type: "request-save",
    });
  }

  focus() {
    this.dispatchEvent({
      type: "focus",
    });
  }

  updateTheme() {
    if (!this.iframe?.contentDocument) return;

    const html = this.iframe.contentDocument.querySelector("html");
    if (!html) return;

    const theme = this.client.ui.viewState.uiOptions.darkMode
      ? "dark"
      : "light";

    html.setAttribute("data-theme", theme);
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

  private dispatchEvent(message: { type: string; data?: any }) {
    if (!this.iframe.contentWindow) return;

    const iframeWindow = this.iframe
      .contentWindow as DocumentEditorIframeWindow;

    iframeWindow.silverbullet.dispatchEvent(
      new CustomEvent(message.type, { detail: message.data }),
    );
  }

  private handleMessage(type: string, data?: any) {
    switch (type) {
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
      default:
        console.warn("Unknown event sent from document editor: ", type);
    }
  }

  private setupIframe(iframe: HTMLIFrameElement) {
    if (!iframe.contentWindow || !iframe.contentDocument) {
      // This will bubble up to the navigation and be catched there
      throw new Error("Something went wrong while setting up the iframe");
    }

    const iframeWindow = iframe.contentWindow as DocumentEditorIframeWindow;

    iframeWindow.silverbullet =
      new EventTarget() as DocumentEditorIframeWindow["silverbullet"];

    iframeWindow.silverbullet.syscall = (name: string, ...args: any[]) => {
      return this.client.clientSystem.localSyscall(name, args);
    };

    iframeWindow.silverbullet.sendMessage = (type: string, data?: any) => {
      this.handleMessage(type, data);
    };

    // When an iframe is focused, all keyboard events will be captured by the
    // iframe. This is bad because we obviously want stuff like the command
    // picker to keep working. This is done by listening to the event **in the
    // capture phase** (so we get it first), sending it to the actual SB DOM,
    // and only if it doesn't have defaultPrevented set, we send it further
    // down.
    iframeWindow.addEventListener("keydown", (event) => {
      const keyEvent = new KeyboardEvent("keydown", event);

      Object.defineProperty(keyEvent, "target", {
        value: globalThis.document.body,
      });

      globalThis.document.dispatchEvent(keyEvent);

      if (keyEvent.defaultPrevented) {
        event.preventDefault();
        event.stopPropagation();
      }
    }, true);
  }

  private static createIframe(
    srcdoc: string,
  ): [HTMLIFrameElement, Promise<void>] {
    const iframe = document.createElement("iframe");
    iframe.srcdoc = srcdoc;

    // Avoid possible loading artifcats
    iframe.style.visibility = "hidden";

    const ready = new Promise<void>((resolve) => {
      iframe.addEventListener("load", () => {
        iframe.style.visibility = "";

        resolve();
      }, { once: true });
    });

    return [iframe, ready];
  }
}
