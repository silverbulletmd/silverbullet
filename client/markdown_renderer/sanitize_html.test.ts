import { expect, test } from "vitest";
import type { Tag } from "./html_render.ts";
import { isSafeUrl, sanitizeTag } from "./sanitize_html.ts";

test("strips on* event handlers", () => {
  const t: Tag = {
    name: "img",
    attrs: { src: "x", onerror: "alert(1)" },
    body: [],
  };
  const clean = sanitizeTag(t) as Exclude<Tag, string>;
  expect(clean.attrs).toEqual({ src: "x" });
});

test("drops forbidden elements entirely", () => {
  for (const name of ["script", "iframe", "object", "embed"]) {
    const t: Tag = { name, attrs: { src: "evil" }, body: ["payload"] };
    const clean = sanitizeTag(t) as Exclude<Tag, string>;
    expect(clean.name).toBe("FRAGMENT");
    expect(clean.body).toEqual([]);
  }
});

test("drops javascript: and data: URLs but keeps http(s)/relative", () => {
  expect(isSafeUrl("http://a.example")).toBe(true);
  expect(isSafeUrl("https://a.example")).toBe(true);
  expect(isSafeUrl("mailto:a@b.c")).toBe(true);
  expect(isSafeUrl("/page")).toBe(true);
  expect(isSafeUrl("relative/page")).toBe(true);
  expect(isSafeUrl("#anchor")).toBe(true);
  expect(isSafeUrl("javascript:alert(1)")).toBe(false);
  expect(isSafeUrl("data:text/html,x")).toBe(false);
});

test("drops URLs that hide their scheme behind control characters", () => {
  // Browsers strip tab/newline/CR (and other C0 control chars) from a URL
  // before resolving its scheme, so "java\tscript:" resolves to
  // "javascript:" — isSafeUrl must not be fooled into treating the
  // pre-strip string as scheme-less.
  expect(isSafeUrl("java\tscript:alert(1)")).toBe(false);
  expect(isSafeUrl("java\nscript:alert(1)")).toBe(false);
  expect(isSafeUrl("java\rscript:alert(1)")).toBe(false);
  expect(isSafeUrl("\x01javascript:alert(1)")).toBe(false);
  expect(isSafeUrl("\x08javascript:alert(1)")).toBe(false);
  expect(isSafeUrl("\x00javascript:alert(1)")).toBe(false);
  // Normal safe cases are unaffected by the stripping.
  expect(isSafeUrl("http://a.example")).toBe(true);
  expect(isSafeUrl("https://a.example")).toBe(true);
  expect(isSafeUrl("mailto:a@b.c")).toBe(true);
  expect(isSafeUrl("tel:+1234567890")).toBe(true);
  expect(isSafeUrl("/page")).toBe(true);
  expect(isSafeUrl("relative/page")).toBe(true);
  expect(isSafeUrl("#anchor")).toBe(true);
});

test("removes an unsafe href but leaves other attrs", () => {
  const t: Tag = {
    name: "a",
    attrs: { href: "javascript:x", class: "keep" },
    body: ["hi"],
  };
  const clean = sanitizeTag(t) as Exclude<Tag, string>;
  expect(clean.attrs).toEqual({ class: "keep" });
});

test("recurses into nested children", () => {
  const t: Tag = {
    name: "div",
    body: [{ name: "span", attrs: { onclick: "x" }, body: ["y"] }],
  };
  const clean = sanitizeTag(t) as Exclude<Tag, string>;
  const child = (clean.body as Tag[])[0] as Exclude<Tag, string>;
  expect(child.attrs).toEqual({});
});

test("passes strings through untouched", () => {
  expect(sanitizeTag("plain text")).toBe("plain text");
});

test("custom protocols are allowed only in clickable links", () => {
  for (const url of ["message://example-id", "custom-notes:open-item"]) {
    expect(sanitizeTag({ name: "a", attrs: { href: url }, body: [] })).toEqual({
      name: "a",
      body: [],
      attrs: { href: url },
    });
    for (const [name, attr] of [
      ["img", "src"],
      ["form", "action"],
      ["link", "href"],
    ]) {
      expect(sanitizeTag({ name, attrs: { [attr]: url }, body: [] })).toEqual({
        name,
        body: [],
        attrs: {},
      });
    }
  }
});

test("clickable links reject browser and executable protocols", () => {
  for (const url of [
    "javascript:alert(1)",
    "java\tscript:alert(1)",
    "data:text/html,x",
    "vbscript:msgbox(1)",
    "file:///tmp/note",
    "blob:https://example.com/id",
    "filesystem:https://example.com/temporary/note",
    "about:blank",
    "chrome://settings",
    "chrome-extension://example/page",
    "devtools://devtools/",
  ]) {
    expect(sanitizeTag({ name: "a", attrs: { href: url }, body: [] })).toEqual({
      name: "a",
      body: [],
      attrs: {},
    });
  }
});
