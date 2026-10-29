import { EditorState } from "@codemirror/state";
import { describe, expect, test } from "vitest";
import {
  movedKeyOrder,
  normalizeTags,
  selectionShowsSource,
  selectRenderer,
  yamlContext,
  yamlValueOffset,
} from "./object_preview.ts";

describe("yamlValueOffset", () => {
  const yaml = 'tags: team\n"my key": 1\nlist:\n- a';

  test("finds the value of plain and quoted keys", () => {
    expect(yamlValueOffset(yaml, "tags")).toBe(yaml.indexOf("team"));
    expect(yamlValueOffset(yaml, "my key")).toBe(yaml.indexOf("1\n"));
  });

  test("lands at the end of the key line for block values", () => {
    expect(yamlValueOffset(yaml, "list")).toBe(yaml.indexOf("list:") + 5);
  });

  test("ignores prefixes and missing keys", () => {
    expect(yamlValueOffset(yaml, "tag")).toBeUndefined();
    expect(yamlValueOffset(yaml, "missing")).toBeUndefined();
  });
});

describe("selectRenderer", () => {
  const own = () => "own";
  const root = () => "root";
  const lookup = (tag: string) =>
    ({ person: own, data: root })[tag as "person" | "data"];

  test("takes the first tag with a renderer, then the root tag's", () => {
    expect(selectRenderer(["other", "person"], "data", lookup)).toBe(own);
    expect(selectRenderer(["other"], "data", lookup)).toBe(root);
    expect(selectRenderer([], "page", lookup)).toBeUndefined();
  });
});

describe("yamlContext", () => {
  test("keeps keys, types and cleaned values aligned", () => {
    const { context, parsed } = yamlContext({
      "a.b": 1,
      due: new Date("2026-12-01T00:00:00Z"),
      tags: "x y",
    });
    expect(context.keys).toEqual(["a.b", "due", "tags"]);
    expect(context.types).toEqual({
      "a.b": "number",
      due: "date",
      tags: "string",
    });
    expect(context.values).toEqual({
      "a.b": 1,
      due: "2026-12-01",
      tags: "x y",
    });
    expect(parsed.due).toBe("2026-12-01");
  });

  test("normalizeTags accepts lists and strings", () => {
    expect(normalizeTags("#a, b c")).toEqual(["a", "b", "c"]);
    expect(normalizeTags(["a", "#a"])).toEqual(["a"]);
    expect(normalizeTags(undefined)).toEqual([]);
  });
});

describe("selectionShowsSource", () => {
  const doc = "abc\nRANGE\nxyz";
  const from = 4;
  const to = 9;
  const at = (anchor: number) =>
    selectionShowsSource(
      EditorState.create({ doc, selection: { anchor } }),
      from,
      to,
    );

  test("counts a cursor right after the range as inside", () => {
    expect(at(from)).toBe(true);
    expect(at(to)).toBe(true);
    expect(at(to + 1)).toBe(false);
    expect(at(from - 1)).toBe(false);
  });
});

describe("movedKeyOrder", () => {
  const yaml = "a: 1\nb:\n  - x\nc: 3";
  test("moves a key one place up or down", () => {
    expect(movedKeyOrder(yaml, { key: "b", delta: -1 })).toEqual([
      "b",
      "a",
      "c",
    ]);
    expect(movedKeyOrder(yaml, { key: "b", delta: 1 })).toEqual([
      "a",
      "c",
      "b",
    ]);
  });
  test("can't move past the ends, an unknown key or broken YAML", () => {
    expect(movedKeyOrder(yaml, { key: "a", delta: -1 })).toBeUndefined();
    expect(movedKeyOrder(yaml, { key: "c", delta: 1 })).toBeUndefined();
    expect(movedKeyOrder(yaml, { key: "z", delta: 1 })).toBeUndefined();
    expect(movedKeyOrder('a: "open', { key: "a", delta: 1 })).toBeUndefined();
  });
});

describe("integer-like keys", () => {
  const yaml = "b: 1\n2: x\na: 3";
  test("ctx.keys follow the text, not Object.keys", () => {
    const { context } = yamlContext({ b: 1, 2: "x", a: 3 }, yaml);
    expect(context.keys).toEqual(["b", "2", "a"]);
    expect(context.values).toEqual({ b: 1, 2: "x", a: 3 });
  });
  test("a move reorders only the moved key", () => {
    expect(movedKeyOrder(yaml, { key: "a", delta: -1 })).toEqual([
      "b",
      "a",
      "2",
    ]);
  });
  test("a key YAML reads differently keeps its value", () => {
    const { context } = yamlContext({ 1: "y", x: 1 }, "x: 1\n1.0: y");
    expect(context.keys).toEqual(["x", "1"]);
    expect(context.values["1"]).toBe("y");
  });
});

test("escaped keys share one identity in previews and navigation", () => {
  const yaml = String.raw`"key\u0020name": example`;
  const { context } = yamlContext({ "key name": "example" }, yaml);
  expect(context.keys).toEqual(["key name"]);
  expect(context.values).toEqual({ "key name": "example" });
  expect(yamlValueOffset(yaml, "key name")).toBe(yaml.indexOf("example"));
});
