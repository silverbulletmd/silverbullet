import type { ContentDimensions } from "@silverbulletmd/silverbullet/lib/transclusion";
import { isInlineSafeContentType } from "./lib/inline_safe.ts";

export type MediaKind = "image" | "audio" | "video" | "pdf";

export type MediaCapabilities = {
  supports(kind: MediaKind, contentType: string): boolean;
};

export const browserMediaCapabilities: MediaCapabilities = {
  supports(kind, contentType) {
    if (kind === "image") return true;
    if (kind === "pdf") {
      return typeof navigator.pdfViewerEnabled === "boolean"
        ? navigator.pdfViewerEnabled
        : true;
    }
    const media = document.createElement(kind);
    const result = media.canPlayType(contentType);
    return result === "maybe" || result === "probably";
  },
};

export function mediaKindFor(
  contentType: string,
  capabilities: MediaCapabilities,
): MediaKind | null {
  const normalized = contentType.trim().toLowerCase();
  if (!isInlineSafeContentType(normalized)) return null;
  const mime = normalized.split(";")[0].trim();
  const kind =
    mime === "application/pdf" ? "pdf" : (mime.split("/")[0] as MediaKind);
  return capabilities.supports(kind, normalized) ? kind : null;
}

export function createMediaElement({
  url,
  contentType,
  title,
  dimensions,
}: {
  url: string;
  contentType: string;
  title: string;
  dimensions?: ContentDimensions;
}): HTMLElement | null {
  const mime = contentType.split(";")[0].trim().toLowerCase();
  let element: HTMLElement;
  if (mime.startsWith("image/")) {
    const image = document.createElement("img");
    image.src = url;
    image.alt = title;
    element = image;
  } else if (mime.startsWith("audio/") || mime.startsWith("video/")) {
    const media = document.createElement(
      mime.startsWith("audio/") ? "audio" : "video",
    );
    media.src = url;
    media.controls = true;
    media.preload = "metadata";
    media.autoplay = false;
    if (media.tagName === "VIDEO")
      (media as HTMLVideoElement).playsInline = true;
    element = media;
  } else if (mime === "application/pdf") {
    const object = document.createElement("object");
    object.type = mime;
    object.data = url;
    element = object;
  } else {
    return null;
  }
  element.title = title;
  element.style.maxWidth = "100%";
  if (dimensions?.width) element.style.width = `${dimensions.width}px`;
  if (dimensions?.height) element.style.height = `${dimensions.height}px`;
  return element;
}
