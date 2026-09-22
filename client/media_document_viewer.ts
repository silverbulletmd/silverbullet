import { encodePageURI, type Ref } from "@silverbulletmd/silverbullet/lib/ref";
import type { DocumentMeta } from "@silverbulletmd/silverbullet/type/index";
import type { Client } from "./client.ts";
import type { ActiveDocumentEditor } from "./document_editor.ts";
import {
  browserMediaCapabilities,
  createMediaElement,
  type MediaCapabilities,
  mediaKindFor,
} from "./media.ts";
import { fsEndpoint } from "./spaces/constants.ts";

export class MediaDocumentViewer implements ActiveDocumentEditor {
  readonly name = "MediaViewer";
  readonly needsBytes = false;
  extension = "";
  private container?: HTMLElement;
  private media?: HTMLElement;
  private externalButton?: HTMLButtonElement;
  private status?: HTMLElement;
  private readyEvent?: "load" | "loadedmetadata";

  constructor(
    readonly parent: HTMLElement,
    readonly client: Client,
    private capabilities: MediaCapabilities = browserMediaCapabilities,
  ) {}

  openFile(
    _data: Uint8Array | undefined,
    meta: DocumentMeta,
    _details: Ref["details"],
  ): void {
    this.releaseMedia();
    this.extension = meta.extension.toLowerCase();
    if (!this.container) {
      this.container = document.createElement("div");
      this.container.className = "sb-media-viewer";
      this.parent.appendChild(this.container);
    }
    this.parent.classList.add("hide-cm");
    const base = document.baseURI.replace(/\/*$/, "");
    const url = `${base}${fsEndpoint}/${encodePageURI(meta.name)}?v=${encodeURIComponent(meta.lastModified)}`;
    this.externalButton = document.createElement("button");
    this.externalButton.type = "button";
    this.externalButton.className = "sb-button";
    this.externalButton.textContent = "Open externally";
    this.externalButton.addEventListener("click", () =>
      this.client.openUrl(url),
    );
    this.status = document.createElement("p");
    this.status.setAttribute("role", "status");
    this.status.textContent = "Loading document…";
    const kind = mediaKindFor(meta.contentType, this.capabilities);
    this.media = kind
      ? (createMediaElement({
          url,
          contentType: meta.contentType,
          title: meta.name,
        }) ?? undefined)
      : undefined;
    this.container.replaceChildren(this.externalButton, this.status);
    if (this.media) {
      this.media.tabIndex = 0;
      this.readyEvent =
        this.media.tagName === "AUDIO" || this.media.tagName === "VIDEO"
          ? "loadedmetadata"
          : "load";
      this.media.addEventListener("error", this.showError);
      this.media.addEventListener(this.readyEvent, this.showReady);
      this.container.appendChild(this.media);
    } else {
      this.showError();
    }
  }

  private showError = (): void => {
    this.removeReadyListener();
    if (this.status) {
      this.status.textContent = "This document could not be displayed.";
      this.status.hidden = false;
    }
    if (this.media) this.media.hidden = true;
  };

  private showReady = (): void => {
    this.removeReadyListener();
    if (this.status) this.status.hidden = true;
  };

  requestSave(): Promise<void> {
    return Promise.resolve();
  }

  focus(): void {
    if (
      this.media &&
      !this.media.hidden &&
      (this.media.tagName === "AUDIO" || this.media.tagName === "VIDEO")
    ) {
      this.media.focus();
    } else {
      this.externalButton?.focus();
    }
  }

  updateTheme(): void {}

  destroy(): void {
    this.releaseMedia();
    this.container?.remove();
    this.container = undefined;
    this.externalButton = undefined;
    this.status = undefined;
    this.parent.classList.remove("hide-cm");
  }

  private releaseMedia(): void {
    if (!this.media) return;
    this.media.removeEventListener("error", this.showError);
    this.removeReadyListener();
    if (this.media.tagName === "AUDIO" || this.media.tagName === "VIDEO") {
      const media = this.media as HTMLMediaElement;
      media.pause();
      media.removeAttribute("src");
      media.load();
    }
    this.media.remove();
    this.media = undefined;
  }

  private removeReadyListener(): void {
    if (!this.media || !this.readyEvent) return;
    this.media.removeEventListener(this.readyEvent, this.showReady);
    this.readyEvent = undefined;
  }
}
