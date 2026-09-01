import { expect, test, vi } from "vitest";
import { mergeLegacyDocks, normalizeViewDefaults } from "./view_defaults.ts";

test("keeps well-formed entries verbatim", () => {
  expect(
    normalizeViewDefaults({
      "std.toc": { dock: "page-top", open: true, collapsed: false, width: 320 },
    }),
  ).toEqual({
    "std.toc": { dock: "page-top", open: true, collapsed: false, width: 320 },
  });
});

test("drops entries that are not tables", () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  expect(normalizeViewDefaults({ "std.toc": "page-top", ok: { open: true } }))
    .toEqual({ ok: { open: true } });
  expect(warn).toHaveBeenCalled();
  warn.mockRestore();
});

test("drops wrong-typed fields but keeps the rest of the entry", () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  expect(
    normalizeViewDefaults({
      "std.toc": { dock: 7, open: "yes", collapsed: null, width: "wide" },
      "std.pages": { dock: "rhs", open: false },
    }),
  ).toEqual({ "std.pages": { dock: "rhs", open: false } });
  warn.mockRestore();
});

test("keeps an entry's good fields when only some are wrong-typed", () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  expect(normalizeViewDefaults({ "std.toc": { dock: "rhs", width: "wide" } }))
    .toEqual({ "std.toc": { dock: "rhs" } });
  warn.mockRestore();
});

test("drops unknown dock names", () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  expect(normalizeViewDefaults({ v: { dock: "sidebar" } })).toEqual({});
  warn.mockRestore();
});

test("clamps width to the panel bounds", () => {
  expect(normalizeViewDefaults({ a: { width: 40 }, b: { width: 5000 } }))
    .toEqual({ a: { width: 160 }, b: { width: 600 } });
});

test("a non-table argument yields an empty table", () => {
  expect(normalizeViewDefaults(undefined)).toEqual({});
  expect(normalizeViewDefaults("nope")).toEqual({});
  expect(normalizeViewDefaults([1, 2])).toEqual({});
});

test("legacy dock tables fill in only where view.defaults has no dock", () => {
  const merged = mergeLegacyDocks(
    { a: { dock: "rhs" }, b: { open: true } },
    { a: "lhs", b: "lhs", c: "modal" },
    { c: "rhs", d: "lhs" },
  );
  expect(merged).toEqual({
    a: { dock: "rhs" },
    b: { open: true, dock: "lhs" },
    c: { dock: "modal" },
    d: { dock: "lhs" },
  });
});

test("legacy tables contribute nothing for non-string values", () => {
  expect(mergeLegacyDocks({}, { a: 3, b: "rhs" })).toEqual({ b: { dock: "rhs" } });
});
