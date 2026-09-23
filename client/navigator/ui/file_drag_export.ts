import {
  encodePageURI,
  isValidName,
  isValidPath,
} from "../../../plug-api/lib/ref.ts";

export const FILE_DRAG_MIME = "application/x-sb-space-file";

export type FileDragPayload = {
  path: string;
  kind: "page" | "document";
  contentType?: string;
};

export function fileDragData(
  obj: {
    name: string;
    tag?: string;
    contentType?: string;
    isFolder?: boolean;
    isAspiring?: boolean;
  },
  fsBase: string,
): { mime: string; payload: string; downloadURL: string } | null {
  if (obj.isAspiring) return null;
  const kind = obj.tag;
  if (kind !== "page" && kind !== "document") return null;
  if (!(kind === "page" ? isValidName(obj.name) : isValidPath(obj.name)))
    return null;
  const path = obj.name;
  const filePath = kind === "page" ? `${path}.md` : path;
  const filename = filePath
    .split("/")
    .at(-1)!
    .replace(/[\r\n:]/g, "_");
  const contentType =
    kind === "page"
      ? "text/markdown"
      : obj.contentType || "application/octet-stream";
  const payload = JSON.stringify({
    path,
    kind,
    ...(kind === "document" && obj.contentType
      ? { contentType: obj.contentType }
      : {}),
  });
  return {
    mime: FILE_DRAG_MIME,
    payload,
    downloadURL: `${contentType}:${filename}:${fsBase}/${encodePageURI(filePath)}`,
  };
}

export function parseFileDragData(data: string): FileDragPayload | null {
  try {
    const value: unknown = JSON.parse(data);
    if (!value || typeof value !== "object") return null;
    const { path, kind, contentType } = value as Record<string, unknown>;
    if (kind !== "page" && kind !== "document") return null;
    if (typeof path !== "string") return null;
    if (!(kind === "page" ? isValidName(path) : isValidPath(path))) return null;
    if (contentType !== undefined && typeof contentType !== "string")
      return null;
    return { path, kind, ...(contentType ? { contentType } : {}) };
  } catch {
    return null;
  }
}
