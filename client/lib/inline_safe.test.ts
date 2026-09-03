// client/lib/inline_safe.test.ts
import { expect, test } from "vitest";
import { isInlineSafeContentType } from "./inline_safe.ts";

test("mirrors the server allowlist", () => {
  for (const ok of [
    "image/png",
    "image/jpeg",
    "application/pdf",
    "video/mp4",
    "audio/mpeg",
    "IMAGE/PNG",
  ]) {
    expect(isInlineSafeContentType(ok)).toBe(true);
  }
  for (const no of [
    "image/svg+xml",
    "text/html",
    "application/xml",
    "text/xml",
    "application/octet-stream",
    "",
    "IMAGE/SVG+XML",
  ]) {
    expect(isInlineSafeContentType(no)).toBe(false);
  }
});
