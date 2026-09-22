import type { FileMeta } from "@silverbulletmd/silverbullet/type/index";
import { isInlineFileContentType } from "../lib/inline_safe.ts";
import { fileMetaToHeaders, utcDateString } from "../lib/util.ts";

export type ByteRangeResult =
  | { type: "full" }
  | { type: "partial"; start: number; end: number }
  | { type: "unsatisfiable" };

const maxU64 = 18_446_744_073_709_551_615n;

function parseU64(value: string): bigint | undefined {
  if (!/^\d+$/.test(value)) {
    return undefined;
  }
  const parsed = BigInt(value);
  return parsed <= maxU64 ? parsed : undefined;
}

export function parseByteRange(
  value: string | null,
  size: number,
): ByteRangeResult {
  if (value === null) {
    return { type: "full" };
  }
  const separator = value.indexOf("=");
  if (separator < 0) {
    return { type: "full" };
  }
  const unit = value.slice(0, separator);
  const interval = value.slice(separator + 1);
  if (unit.toLowerCase() !== "bytes" || interval.includes(",")) {
    return { type: "full" };
  }
  const dash = interval.indexOf("-");
  if (dash < 0 || interval.indexOf("-", dash + 1) >= 0) {
    return { type: "full" };
  }

  const startText = interval.slice(0, dash);
  const endText = interval.slice(dash + 1);
  const fileSize = BigInt(size);
  if (startText === "") {
    const length = parseU64(endText);
    if (length === undefined) {
      return { type: "full" };
    }
    if (length === 0n || fileSize === 0n) {
      return { type: "unsatisfiable" };
    }
    return {
      type: "partial",
      start: Number(length >= fileSize ? 0n : fileSize - length),
      end: size - 1,
    };
  }

  const start = parseU64(startText);
  if (start === undefined) {
    return { type: "full" };
  }
  const end = endText === "" ? undefined : parseU64(endText);
  if (endText !== "" && end === undefined) {
    return { type: "full" };
  }
  if (
    fileSize === 0n ||
    start >= fileSize ||
    (end !== undefined && end < start)
  ) {
    return { type: "unsatisfiable" };
  }
  return {
    type: "partial",
    start: Number(start),
    end: Number(end === undefined || end >= fileSize ? fileSize - 1n : end),
  };
}

function localFileHeaders(meta: FileMeta): Headers {
  const headers = new Headers(fileMetaToHeaders(meta));
  headers.set("Accept-Ranges", "bytes");
  if (!isInlineFileContentType(meta.contentType)) {
    headers.set("Content-Disposition", "attachment");
    headers.set("X-Content-Type-Options", "nosniff");
  }
  return headers;
}

export function buildLocalFileResponse(
  meta: FileMeta,
  data: Uint8Array,
  request: Request,
): Response {
  const headers = localFileHeaders(meta);
  const fullResponse = () => {
    headers.set("Content-Length", `${data.byteLength}`);
    return new Response(request.method === "HEAD" ? null : (data as any), {
      headers,
    });
  };

  if (request.method === "HEAD") {
    return fullResponse();
  }

  const requested = parseByteRange(request.headers.get("Range"), meta.size);
  if (requested.type === "full") {
    return fullResponse();
  }
  const ifRange = request.headers.get("If-Range");
  if (ifRange !== null) {
    const lastModified = utcDateString(meta.lastModified);
    if (!ifRange || !lastModified || ifRange !== lastModified) {
      return fullResponse();
    }
  }
  if (requested.type === "unsatisfiable") {
    headers.set("Content-Range", `bytes */${meta.size}`);
    headers.set("Content-Length", "0");
    return new Response(null, { status: 416, headers });
  }

  const body = data.slice(requested.start, requested.end + 1);
  headers.set(
    "Content-Range",
    `bytes ${requested.start}-${requested.end}/${meta.size}`,
  );
  headers.set("Content-Length", `${body.byteLength}`);
  return new Response(body as any, { status: 206, headers });
}
