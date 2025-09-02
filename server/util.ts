import type { FileMeta } from "@silverbulletmd/silverbullet/type/index";

export function utcDateString(mtime: number): string {
  return new Date(mtime).toUTCString();
}

export function authCookieName(host: string) {
  return `auth_${host.replaceAll(/\W/g, "_")}`;
}

export function fileMetaToHeaders(fileMeta: FileMeta) {
  return {
    "Content-Type": fileMeta.contentType,
    "X-Last-Modified": "" + fileMeta.lastModified,
    "X-Created": "" + fileMeta.created,
    "Cache-Control": "no-cache",
    "X-Permission": fileMeta.perm,
    "X-Content-Length": "" + fileMeta.size,
  };
}
