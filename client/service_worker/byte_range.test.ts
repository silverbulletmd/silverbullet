import type { FileMeta } from "@silverbulletmd/silverbullet/type/index";
import { expect, test } from "vitest";
import { buildLocalFileResponse, parseByteRange } from "./byte_range.ts";

const textEncoder = new TextEncoder();

function bytes(value: string): Uint8Array {
  return textEncoder.encode(value);
}

function fileMeta(name: string, size: number, contentType: string): FileMeta {
  return {
    name,
    size,
    contentType,
    created: 0,
    lastModified: Date.parse("Wed, 21 Oct 2015 07:28:00 GMT"),
    perm: "rw",
  };
}

test.each([
  ["bytes=0-3", { type: "partial", start: 0, end: 3 }],
  ["bytes=7-", { type: "partial", start: 7, end: 9 }],
  ["bytes=-4", { type: "partial", start: 6, end: 9 }],
  ["bytes=7-99", { type: "partial", start: 7, end: 9 }],
  ["bytes=-11", { type: "partial", start: 0, end: 9 }],
])("parses the single range %s", (value, expected) => {
  expect(parseByteRange(value, 10)).toEqual(expected);
});

test.each([
  "bytes=10-12",
  "bytes=5-4",
  "bytes=-0",
])("marks the range %s as unsatisfiable", (value) => {
  expect(parseByteRange(value, 10)).toEqual({ type: "unsatisfiable" });
});

test.each([
  "bytes=0-0",
  "bytes=0-",
  "bytes=-1",
])("marks the range %s on an empty file as unsatisfiable", (value) => {
  expect(parseByteRange(value, 0)).toEqual({ type: "unsatisfiable" });
});

test.each([
  null,
  "",
  "bytes=",
  "bytes=-",
  "bytes=abc-1",
  "bytes=0-abc",
  "bytes=--1",
  "bytes=+1-2",
  "bytes=0-1-2",
  "bytes= 0-1",
  "bytes=0 -1",
  " bytes=0-1",
  "bytes=0-1,4-5",
  "items=0-1",
  "bytes=18446744073709551616-",
  "bytes=0-18446744073709551616",
])("falls back to the full representation for malformed range %s", (value) => {
  expect(parseByteRange(value, 10)).toEqual({ type: "full" });
});

test("builds a full local response with file metadata headers", async () => {
  const response = buildLocalFileResponse(
    fileMeta("clip.bin", 10, "video/mp4"),
    bytes("0123456789"),
    new Request("http://local/.fs/clip.bin"),
  );

  expect(response.status).toBe(200);
  expect(response.headers.get("Content-Length")).toBe("10");
  expect(response.headers.get("X-Content-Length")).toBe("10");
  expect(response.headers.get("Accept-Ranges")).toBe("bytes");
  expect(response.headers.get("Last-Modified")).toBe(
    "Wed, 21 Oct 2015 07:28:00 GMT",
  );
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(
    bytes("0123456789"),
  );
});

test("builds a partial local response", async () => {
  const meta = fileMeta("clip.bin", 10, "video/mp4");
  const request = new Request("http://local/.fs/clip.bin", {
    headers: { Range: "bytes=2-5" },
  });

  const response = buildLocalFileResponse(meta, bytes("0123456789"), request);

  expect(response.status).toBe(206);
  expect(response.headers.get("Content-Range")).toBe("bytes 2-5/10");
  expect(response.headers.get("Content-Length")).toBe("4");
  expect(response.headers.get("X-Content-Length")).toBe("10");
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes("2345"));
});

test.each([
  ["bytes=7-", "bytes 7-9/10", "789"],
  ["bytes=-4", "bytes 6-9/10", "6789"],
])("builds a local response for %s", async (range, contentRange, body) => {
  const response = buildLocalFileResponse(
    fileMeta("clip.bin", 10, "video/mp4"),
    bytes("0123456789"),
    new Request("http://local/.fs/clip.bin", { headers: { Range: range } }),
  );

  expect(response.status).toBe(206);
  expect(response.headers.get("Content-Range")).toBe(contentRange);
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes(body));
});

test("builds an empty unsatisfiable local response", async () => {
  const response = buildLocalFileResponse(
    fileMeta("clip.bin", 10, "video/mp4"),
    bytes("0123456789"),
    new Request("http://local/.fs/clip.bin", {
      headers: { Range: "bytes=10-12" },
    }),
  );

  expect(response.status).toBe(416);
  expect(response.headers.get("Content-Range")).toBe("bytes */10");
  expect(response.headers.get("Content-Length")).toBe("0");
  expect(response.headers.get("X-Content-Length")).toBe("10");
  expect((await response.arrayBuffer()).byteLength).toBe(0);
});

test.each([
  "bytes=abc-1",
  "bytes=0-1,4-5",
])("serves the full representation for unsupported range %s", async (range) => {
  const response = buildLocalFileResponse(
    fileMeta("clip.bin", 10, "video/mp4"),
    bytes("0123456789"),
    new Request("http://local/.fs/clip.bin", { headers: { Range: range } }),
  );

  expect(response.status).toBe(200);
  expect(response.headers.get("Content-Range")).toBeNull();
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(
    bytes("0123456789"),
  );
});

test("HEAD returns full metadata without a body", async () => {
  const response = buildLocalFileResponse(
    fileMeta("clip.bin", 10, "video/mp4"),
    bytes("0123456789"),
    new Request("http://local/.fs/clip.bin", {
      method: "HEAD",
      headers: { Range: "bytes=2-5" },
    }),
  );

  expect(response.status).toBe(200);
  expect(response.headers.get("Content-Length")).toBe("10");
  expect(response.headers.get("Content-Range")).toBeNull();
  expect((await response.arrayBuffer()).byteLength).toBe(0);
});

test("a matching date If-Range serves the requested range", async () => {
  const response = buildLocalFileResponse(
    fileMeta("clip.bin", 10, "video/mp4"),
    bytes("0123456789"),
    new Request("http://local/.fs/clip.bin", {
      headers: {
        Range: "bytes=2-5",
        "If-Range": "Wed, 21 Oct 2015 07:28:00 GMT",
      },
    }),
  );

  expect(response.status).toBe(206);
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes("2345"));
});

test.each([
  "Tue, 20 Oct 2015 07:28:00 GMT",
  '"content-etag"',
])("If-Range %s falls back to the full representation", async (ifRange) => {
  const response = buildLocalFileResponse(
    fileMeta("clip.bin", 10, "video/mp4"),
    bytes("0123456789"),
    new Request("http://local/.fs/clip.bin", {
      headers: { Range: "bytes=2-5", "If-Range": ifRange },
    }),
  );

  expect(response.status).toBe(200);
  expect(response.headers.get("Content-Range")).toBeNull();
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(
    bytes("0123456789"),
  );
});

test("an empty If-Range never matches missing local Last-Modified metadata", async () => {
  const meta = {
    ...fileMeta("clip.bin", 10, "video/mp4"),
    lastModified: Number.NaN,
  };
  const response = buildLocalFileResponse(
    meta,
    bytes("0123456789"),
    new Request("http://local/.fs/clip.bin", {
      headers: { Range: "bytes=2-5", "If-Range": "" },
    }),
  );

  expect(response.status).toBe(200);
  expect(response.headers.get("Content-Range")).toBeNull();
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(
    bytes("0123456789"),
  );
});

test("unsafe partial content is forced to download", () => {
  const response = buildLocalFileResponse(
    fileMeta("page.html", 10, "text/html"),
    bytes("0123456789"),
    new Request("http://local/.fs/page.html", {
      headers: { Range: "bytes=2-5" },
    }),
  );

  expect(response.headers.get("Content-Disposition")).toBe("attachment");
  expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
});
