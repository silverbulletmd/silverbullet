import { expect, test } from "vitest";
import {
  applyLineEnding,
  Disposers,
  detectLineEnding,
  normalizeLineEndings,
} from "./util.ts";

test("Disposers runs callbacks last-in-first-out and is reusable", () => {
  const calls: string[] = [];
  const d = new Disposers();
  d.add(() => calls.push("a"));
  d.add(() => calls.push("b"));
  d.dispose();
  expect(calls).toEqual(["b", "a"]);
  d.dispose();
  expect(calls).toEqual(["b", "a"]);
  d.add(() => calls.push("c"));
  d.dispose();
  expect(calls).toEqual(["b", "a", "c"]);
});

test("line endings round-trip through the LF editor form", () => {
  for (const text of ["a\r\nb\r\n", "a\nb\n", "single line", ""]) {
    const lineEnding = detectLineEnding(text);
    const normalized = normalizeLineEndings(text);
    expect(normalized).not.toContain("\r");
    expect(applyLineEnding(normalized, lineEnding)).toBe(text);
  }
  expect(detectLineEnding("a\r\nb\nc")).toBe("\r\n");
  expect(detectLineEnding("a\nb\r\nc")).toBe("\n");
});
