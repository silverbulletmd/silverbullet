import { expect, test } from "vitest";
import { renderHtml } from "./html_render.ts";

test("HTML Render", () => {
  expect(renderHtml({
    name: "b",
    body: "hello",
  })).toEqual(`<b>hello</b>`);
  expect(renderHtml({
    name: "a",
    attrs: {
      href: "https://example.com",
    },
    body: "hello",
  })).toEqual(`<a href="https://example.com">hello</a>`);
  expect(renderHtml({
    name: "span",
    body: "<>",
  })).toEqual(`<span>&lt;&gt;</span>`);
});
