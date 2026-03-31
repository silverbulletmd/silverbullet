import { expect, test } from "vitest";
import { Fragment, RawHtml, renderHtml } from "./html_render.ts";

test("HTML Render", () => {
  expect(
    renderHtml({
      name: "b",
      body: "hello",
    }),
  ).toEqual(`<b>hello</b>`);
  expect(
    renderHtml({
      name: "a",
      attrs: {
        href: "https://example.com",
      },
      body: "hello",
    }),
  ).toEqual(`<a href="https://example.com">hello</a>`);
  expect(
    renderHtml({
      name: "span",
      body: "<>",
    }),
  ).toEqual(`<span>&lt;&gt;</span>`);
});

test("RawHtml with string body passes through unescaped", () => {
  expect(
    renderHtml({
      name: RawHtml,
      body: '<em>italic</em> & "quoted"',
    }),
  ).toEqual('<em>italic</em> & "quoted"');
});

test("RawHtml with array body passes strings through unescaped", () => {
  expect(
    renderHtml({
      name: RawHtml,
      body: [
        "<b>bold</b>",
        { name: "i", body: "normal" },
      ],
    }),
  ).toEqual("<b>bold</b><i>normal</i>");
});

test("Fragment renders children without wrapper", () => {
  expect(
    renderHtml({
      name: Fragment,
      body: [
        { name: "b", body: "one" },
        { name: "i", body: "two" },
      ],
    }),
  ).toEqual("<b>one</b><i>two</i>");
});
