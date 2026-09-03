import { expect, test } from "vitest";
import { parse } from "../markdown_parser/parse_tree.ts";
import { extendedMarkdownLanguage } from "../markdown_parser/parser.ts";
import { renderMarkdownToHtml } from "./markdown_render.ts";

function render(md: string): string {
  return renderMarkdownToHtml(parse(extendedMarkdownLanguage, md), {});
}

test("inline img onerror handler is stripped", () => {
  const html = render(`<img src="x" onerror="fetch('/evil')">`);
  expect(html).not.toContain("onerror");
  expect(html).not.toContain("fetch('/evil')");
});

test("svg onload handler is stripped", () => {
  const html = render(`<svg onload="alert(1)"></svg>`);
  expect(html.toLowerCase()).not.toContain("onload");
});

test("script element is dropped", () => {
  const html = render(`before\n\n<script>alert(1)</script>\n\nafter`);
  expect(html.toLowerCase()).not.toContain("<script");
  expect(html).not.toContain("alert(1)");
});

test("safe content still renders", () => {
  const html = render(
    `**bold** and [a link](https://example.com) and *italic*`,
  );
  expect(html).toContain("bold");
  expect(html).toContain("https://example.com");
});

test("self-closing img onerror is stripped", () => {
  const html = render(`<img src="x" onerror="alert(1)" />`);
  expect(html).not.toContain("onerror");
});

test("plain self-closing void tags still render", () => {
  const html = render(`line one<br/>line two`);
  expect(html.toLowerCase()).toContain("<br>");
});

test("href hiding javascript: behind a control character is neutralized", () => {
  const html = render(`<a href="java\tscript:alert(1)">click</a>`);
  expect(html).not.toContain("href=");
  expect(html).toContain("click");
});
