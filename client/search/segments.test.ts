import { expect, test } from "vitest";
import { pageScopes } from "../navigator/views/pages.ts";
import { selectionForScope } from "./segments.ts";

const pages = [
  { name: "Garden", tag: "page", tags: [] },
  { name: "Library/Std/Thing", tag: "page", tags: ["meta"] },
  { name: "Templates/Daily", tag: "page", tags: ["template"] },
  {
    name: "Hidden Note",
    tag: "page",
    tags: [],
    pageDecoration: { hide: true },
  },
];

test("pages excludes meta and hidden pages", () => {
  expect(selectionForScope("pages", pages)).toEqual({
    exclude: ["Library/Std/Thing", "Templates/Daily", "Hidden Note"],
  });
});

test("meta includes visible meta pages only", () => {
  expect(selectionForScope("meta", pages)).toEqual({
    include: ["Library/Std/Thing", "Templates/Daily"],
  });
});

test("all and a missing scope do not filter", () => {
  expect(selectionForScope("all", pages)).toBeUndefined();
  expect(selectionForScope(undefined, pages)).toBeUndefined();
});

test("selections agree with the page picker's scopes", () => {
  const names = pages.map((p) => p.name);
  const excluded = new Set(selectionForScope("pages", pages)?.exclude);
  expect(names.filter((n) => !excluded.has(n))).toEqual(
    pages.filter(pageScopes.pages).map((p) => p.name),
  );
  expect(selectionForScope("meta", pages)?.include).toEqual(
    pages.filter(pageScopes.meta).map((p) => p.name),
  );
});
