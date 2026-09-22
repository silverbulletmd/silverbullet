import type {
  DocumentCapability,
  DocumentCapabilityDescriptor,
  DocumentEditorCallback,
} from "@silverbulletmd/silverbullet/type/client";
import type { DocumentMeta } from "@silverbulletmd/silverbullet/type/index";
import { languageNameForExtension } from "./languages.ts";
import { isInlineSafeContentType } from "./lib/inline_safe.ts";
import {
  type MediaCapabilities,
  type MediaKind,
  mediaKindFor,
} from "./media.ts";

export const TEXT_DOCUMENT_LIMIT = 5 * 1024 * 1024;

export type DocumentMediaType = MediaKind;
export type { MediaCapabilities } from "./media.ts";

export type PlugDocumentEditors = ReadonlyMap<
  string,
  { extensions: readonly string[]; callback: DocumentEditorCallback }
>;

export type DocumentEditorResolution =
  | {
      kind: "plug";
      name: string;
      extension: string;
      callback: DocumentEditorCallback;
      needsBytes: true;
    }
  | {
      kind: "text";
      extension: string;
      languageName: string | null;
      requiresUtf8Probe: boolean;
      needsBytes: true;
    }
  | {
      kind: "media";
      extension: string;
      mediaType: DocumentMediaType;
      contentType: string;
      needsBytes: false;
    }
  | {
      kind: "external";
      extension: string;
      reason: "too-large" | "unsupported-media" | "binary";
      needsBytes: false;
    };

const textualContentTypes = new Set([
  "application/json",
  "application/javascript",
  "application/ecmascript",
  "application/xml",
  "application/yaml",
  "application/x-yaml",
  "application/toml",
  "application/sql",
]);

const binaryContentTypes = new Set([
  "application/zip",
  "application/gzip",
  "application/x-gzip",
  "application/x-tar",
  "application/x-7z-compressed",
  "application/vnd.rar",
  "application/x-rar-compressed",
  "application/wasm",
  "application/x-executable",
  "application/x-sharedlib",
]);

export function resolveDocumentEditor(
  meta: Pick<DocumentMeta, "extension" | "contentType" | "size">,
  plugEditors: PlugDocumentEditors,
  mediaCapabilities: MediaCapabilities,
): DocumentEditorResolution {
  const extension = meta.extension.toLowerCase();
  const contentType = meta.contentType.trim().toLowerCase();
  const mimeType = contentType.split(";")[0].trim();
  for (const [name, editor] of plugEditors) {
    if (
      editor.extensions.some(
        (candidate) => candidate.toLowerCase() === extension,
      )
    ) {
      return {
        kind: "plug",
        name,
        extension,
        callback: editor.callback,
        needsBytes: true,
      };
    }
  }

  // Remote spaces may still label TypeScript .ts files as MPEG transport streams.
  if (isInlineSafeContentType(mimeType) && extension !== "ts") {
    const mediaType = mediaKindFor(contentType, mediaCapabilities);
    return mediaType
      ? { kind: "media", extension, mediaType, contentType, needsBytes: false }
      : {
          kind: "external",
          extension,
          reason: "unsupported-media",
          needsBytes: false,
        };
  }

  if (meta.size > TEXT_DOCUMENT_LIMIT) {
    return {
      kind: "external",
      extension,
      reason: "too-large",
      needsBytes: false,
    };
  }

  const languageName = languageNameForExtension(extension);
  const textual =
    mimeType.startsWith("text/") ||
    textualContentTypes.has(mimeType) ||
    mimeType.endsWith("+json") ||
    mimeType.endsWith("+xml");
  if (languageName || textual) {
    return {
      kind: "text",
      extension,
      languageName,
      requiresUtf8Probe: false,
      needsBytes: true,
    };
  }
  if (binaryContentTypes.has(mimeType)) {
    return { kind: "external", extension, reason: "binary", needsBytes: false };
  }
  return {
    kind: "text",
    extension,
    languageName: null,
    requiresUtf8Probe: true,
    needsBytes: true,
  };
}

export function resolveDocumentCapability(
  document: DocumentCapabilityDescriptor,
  plugEditors: PlugDocumentEditors,
  mediaCapabilities: MediaCapabilities,
): DocumentCapability {
  const resolution = resolveDocumentEditor(
    document,
    plugEditors,
    mediaCapabilities,
  );
  switch (resolution.kind) {
    case "plug":
      return { kind: "plug", editor: resolution.name };
    case "text":
      return {
        kind: "text",
        reason: resolution.requiresUtf8Probe ? "probe-required" : undefined,
      };
    case "media":
      return { kind: "media" };
    case "external":
      return { kind: "external", reason: resolution.reason };
  }
}
