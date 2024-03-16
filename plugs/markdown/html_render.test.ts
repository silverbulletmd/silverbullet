import { assertEquals } from "$std/testing/asserts.ts";
import { renderHtml } from "./html_render.ts";

Deno.test("HTML Render", () => {
  assertEquals(
    renderHtml({
      name: "b",
      body: "hello",
    }),
    `<b>hello</b>`,
  );
  assertEquals(
    renderHtml({
      name: "a",
      attrs: {
        href: "https://example.com",
      },
      body: "hello",
    }),
    `<a href="https://example.com">hello</a>`,
  );
  assertEquals(
    renderHtml({
      name: "span",
      body: "<>",
    }),
    `<span>&lt;&gt;</span>`,
  );
});
