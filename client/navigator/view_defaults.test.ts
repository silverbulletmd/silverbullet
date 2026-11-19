import { expect, test, vi } from "vitest";
import {
  layoutDefaults,
  mergeLegacyDocks,
  normalizeViewDefaults,
} from "./view_defaults.ts";

test("keeps well-formed entries verbatim", () => {
  expect(
    normalizeViewDefaults({
      "std.toc": { dock: "page-top", open: true, collapsed: false, width: 320 },
    }),
  ).toEqual({
    "std.toc": { dock: "page-top", open: true, collapsed: false, width: 320 },
  });
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

test("drops unknown dock names", () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  expect(normalizeViewDefaults({ v: { dock: "sidebar" } })).toEqual({});
  warn.mockRestore();
});

test("clamps width to the panel bounds", () => {
  expect(
    normalizeViewDefaults({ a: { width: 40 }, b: { width: 5000 } }),
  ).toEqual({ a: { width: 160 }, b: { width: 600 } });
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

test("layoutDefaults records docked views as open with their size", () => {
  expect(
    layoutDefaults(
      {},
      [
        { slot: "lhs", view: "std.spaceTree", size: 280 },
        { slot: "bhs", view: "x", size: 220 },
      ],
      () => undefined,
    ),
  ).toEqual({
    "std.spaceTree": { dock: "lhs", open: true, width: 280 },
    x: { dock: "bhs", open: true, height: 220 },
  });
});

test("layoutDefaults closes previously open window views that are not docked now", () => {
  expect(
    layoutDefaults(
      { a: { dock: "rhs", open: true, width: 300 } },
      [],
      () => "rhs",
    ),
  ).toEqual({ a: { dock: "rhs", open: false, width: 300 } });
});

test("layoutDefaults leaves page-docked and unrelated entries alone", () => {
  const existing = {
    p: { dock: "page-top", open: true },
    c: { collapsed: true },
  };
  expect(
    layoutDefaults(existing, [], (name) => (name === "p" ? "page-top" : "rhs")),
  ).toEqual(existing);
});

test("layoutDefaults keeps other fields of a docked view's entry", () => {
  const existing = { t: { dock: "rhs", open: false, collapsed: true } };
  expect(
    layoutDefaults(
      existing,
      [{ slot: "lhs", view: "t", size: 260 }],
      () => "rhs",
    ),
  ).toEqual({ t: { dock: "lhs", open: true, collapsed: true, width: 260 } });
  expect(existing.t.dock).toBe("rhs");
});

test("layoutDefaults leaves ignored views out of the snapshot", () => {
  const existing = { w: { dock: "bhs", open: false } };
  expect(
    layoutDefaults(
      existing,
      [
        { slot: "lhs", view: "t", size: 260 },
        { slot: "bhs", view: "w", size: 300 },
      ],
      () => "bhs",
      ["w"],
    ),
  ).toEqual({
    w: { dock: "bhs", open: false },
    t: { dock: "lhs", open: true, width: 260 },
  });
});
