import { expect, test } from "vitest";
import {
  LuaBuiltinFunction,
  LuaNativeJSFunction,
  LuaTable,
} from "../space_lua/runtime.ts";
import {
  container,
  previewValue,
  valueChildren,
  valueKind,
} from "./value_preview.ts";

test("primitives", () => {
  expect(previewValue("hi")).toBe('"hi"');
  expect(previewValue(3)).toBe("3");
  expect(previewValue(null)).toBe("nil");
  expect(previewValue(undefined)).toBe("nil");
});

test("array-like lua tables preview as counted lists, peeking into items", () => {
  const t = new LuaTable([
    new LuaTable({ name: "Draft plan", done: false, page: "Projects" }),
    new LuaTable({ name: "Water plants" }),
    3,
  ]);
  expect(valueKind(t)).toBe("table");
  expect(container(t)?.list).toBe(true);
  expect(previewValue(t, { width: 2 })).toBe(
    '(3) [{name: "Draft plan", done: false, …}, {name: "Water plants"}, …]',
  );
});

test("record lua tables preview as records with nested lists", () => {
  const t = new LuaTable({ name: "Sample", tags: new LuaTable(["a", "b"]) });
  expect(container(t)?.list).toBe(false);
  expect(previewValue(t)).toBe('{name: "Sample", tags: (2) ["a", "b"]}');
});

test("an empty table previews as an empty list", () => {
  expect(previewValue(new LuaTable())).toBe("(0) []");
});

test("past the peek depth, nested values collapse by shape", () => {
  const t = new LuaTable([new LuaTable([new LuaTable({ a: 1 })])]);
  expect(previewValue(t)).toBe("(1) [(1) [{…}]]");
});

test("long strings are cut short", () => {
  expect(previewValue("x".repeat(200))).toBe(`"${"x".repeat(80)}…"`);
});

test("circular JS objects are marked, not followed", () => {
  const a: Record<string, unknown> = { label: "a" };
  a.self = a;
  expect(previewValue(a, { depth: 3 })).toBe('{label: "a", self: <cycle>}');
});

test("huge arrays are truncated", () => {
  const big = Array.from({ length: 10_000 }, (_, i) => i);
  expect(previewValue(big, { width: 3 })).toBe("(10000) [0, 1, 2, …]");
});

test("a throwing getter yields an unrenderable marker", () => {
  const o = {
    get bad(): unknown {
      throw new Error("nope");
    },
  };
  expect(previewValue(o)).toBe("{bad: <unrenderable: nope>}");
});

test("children are paged", () => {
  const t = new LuaTable([10, 20, 30, 40]);
  expect(valueChildren(t, 1, 2)).toEqual({
    entries: [
      ["2", 20],
      ["3", 30],
    ],
    more: 1,
  });
});

test("lua function instances are classified and previewed as functions", () => {
  const builtin = new LuaBuiltinFunction(() => null);
  const native = new LuaNativeJSFunction(() => null);
  expect(valueKind(builtin)).toBe("function");
  expect(valueKind(native)).toBe("function");
  expect(previewValue(builtin)).toBe("function");
  expect(previewValue({ fn: native })).toBe("{fn: function}");
});

test("huge arrays are previewed and paged without enumerating them", () => {
  const length = 1_000_000;
  const indexReads: string[] = [];
  let ownKeysCalls = 0;
  const big = new Proxy(new Array(length).fill(0), {
    get(target, prop, receiver) {
      if (typeof prop === "string" && /^\d+$/.test(prop)) indexReads.push(prop);
      return Reflect.get(target, prop, receiver);
    },
    has(target, prop) {
      if (typeof prop === "string" && /^\d+$/.test(prop)) indexReads.push(prop);
      return Reflect.has(target, prop);
    },
    ownKeys(target) {
      ownKeysCalls++;
      return Reflect.ownKeys(target);
    },
  });

  expect(previewValue(big, { width: 3 })).toBe("(1000000) [0, 0, 0, …]");
  expect(indexReads.length).toBeLessThanOrEqual(3);

  indexReads.length = 0;
  const page = valueChildren(big, 999_998, 5);
  expect(page).toEqual({
    entries: [
      ["999998", 0],
      ["999999", 0],
    ],
    more: 0,
  });
  expect(indexReads.length).toBeLessThanOrEqual(2);
  expect(ownKeysCalls).toBe(0);
});
