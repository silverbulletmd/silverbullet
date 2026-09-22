import type { FileMeta } from "@silverbulletmd/silverbullet/type/index";

export function utcDateString(mtime: number): string {
  const date = new Date(mtime);
  return Number.isNaN(date.getTime()) ? "" : date.toUTCString();
}

export function authCookieName(host: string) {
  return `auth_${host.replaceAll(/\W/g, "_")}`;
}

export function fileMetaToHeaders(fileMeta: FileMeta): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": fileMeta.contentType,
    "X-Last-Modified": `${fileMeta.lastModified}`,
    "X-Created": `${fileMeta.created}`,
    "Cache-Control": "no-cache",
    "X-Permission": fileMeta.perm,
    "X-Content-Length": `${fileMeta.size}`,
  };
  const lastModified = utcDateString(fileMeta.lastModified);
  if (lastModified) {
    headers["Last-Modified"] = lastModified;
  }
  return headers;
}

export function headersToFileMeta(
  name: string,
  headers: Headers,
): FileMeta | undefined {
  if (headers.has("X-Last-Modified")) {
    return {
      name,
      // The server may set a custom X-Content-Length header in case a GET request was sent with X-Get-Meta, in which case the body may be omitted
      size: headers.has("X-Content-Length")
        ? +headers.get("X-Content-Length")!
        : +headers.get("Content-Length")!,
      contentType:
        headers.get("X-Content-Type") ?? headers.get("Content-type")!,
      created: +(headers.get("X-Created") || "0"),
      lastModified: +(headers.get("X-Last-Modified") || "0"),
      perm: (headers.get("X-Permission") as "rw" | "ro") || "ro",
    };
  } else {
    return undefined;
  }
}
