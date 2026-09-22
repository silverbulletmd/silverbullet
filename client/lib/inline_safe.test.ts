import { expect, test } from "vitest";
import {
  isInlineFileContentType,
  isInlineSafeContentType,
} from "./inline_safe.ts";

test("serves trusted HTML, CSS, and JavaScript files inline", () => {
  for (const contentType of [
    "text/html",
    "text/html; charset=utf-8",
    "text/css",
    "text/javascript",
    "application/javascript",
  ]) {
    expect(isInlineFileContentType(contentType)).toBe(true);
  }
  expect(isInlineSafeContentType("text/html")).toBe(false);
  expect(isInlineFileContentType("image/svg+xml")).toBe(false);
  expect(isInlineFileContentType("application/xml")).toBe(false);
});

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
