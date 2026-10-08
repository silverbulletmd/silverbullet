import { expect, test, vi } from "vitest";
import { renderLiteralMarkdown } from "./widget_markdown.ts";

test("literal markdown keeps Lua directives as text", () => {
  const html = renderLiteralMarkdown("Total: ${1 + 1} items", []);
  expect(html).toContain("${1 + 1}");
  expect(html).not.toContain(">2<");
});

test("literal markdown does not transclude other pages", () => {
  const resolve = vi.fn();
  const html = renderLiteralMarkdown("See ![[Secret Page]]", [], {
    resolveTransclusion: resolve,
  });
  expect(resolve).not.toHaveBeenCalled();
  expect(html).toContain("Secret Page");
});

test("literal markdown still renders ordinary formatting and links", () => {
  const html = renderLiteralMarkdown(
    "**bold** and [[Some Page]]\n\n* item",
    [],
  );
  expect(html).toContain("<strong>bold</strong>");
  expect(html).toContain("Some Page");
  expect(html).toContain("<li>");
});
