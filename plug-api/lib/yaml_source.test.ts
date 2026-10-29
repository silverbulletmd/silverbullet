import { expect, test } from "vitest";
import {
  unwrap,
  yamlAllEntries,
  yamlEntries,
  yamlNodes,
  yamlSource,
  yamlTopLevelEntries,
} from "./yaml_source.ts";

test("decoded identities retain original quoted and numeric spelling", () => {
  const text = String.raw`"key\u0020name": example
'it''s': quoted
1.0: number`;
  const entries = yamlTopLevelEntries(text);
  expect(entries.map(({ key, keyText }) => [key, keyText])).toEqual([
    ["key name", String.raw`"key\u0020name"`],
    ["it's", "'it''s'"],
    ["1", "1.0"],
  ]);
  for (const { keyText, keyNode, valueNode } of entries) {
    expect(text.slice(keyNode.from, keyNode.to)).toBe(keyText);
    expect(text.slice(valueNode.from, valueNode.to)).toBe(valueNode.value);
  }
});

test("comments and null values do not absorb neighboring keys", () => {
  const text =
    "# heading\nempty: # absent\n# next\nother: null\nlast: value # tail\n";
  const entries = yamlTopLevelEntries(text);
  expect(entries.map(({ key, valueNode }) => [key, valueNode.value])).toEqual([
    ["empty", null],
    ["other", null],
    ["last", "value"],
  ]);
  expect(entries[0].keyText).toBe("empty");
  expect(text.slice(entries[2].valueNode.from, entries[2].valueNode.to)).toBe(
    "value",
  );
});

test("nested and flow mappings keep scalar spans and decoded values", () => {
  const text = "outer:\n  list: [one, 'two']\nflow: {nested: value}\n";
  const root = yamlSource(text)[0];
  const entries = yamlEntries(text, root);
  expect(
    yamlEntries(text, entries[0].valueNode).map((entry) => entry.key),
  ).toEqual(["list"]);
  expect(
    yamlEntries(text, entries[1].valueNode).map((entry) => entry.key),
  ).toEqual(["nested"]);
  expect(
    yamlNodes(root)
      .filter((node) => node.kind === "scalar" && unwrap(node) === node)
      .map((node) => text.slice(node.from, node.to)),
  ).toEqual(["outer", "list", "one", "'two'", "flow", "nested", "value"]);
});

test("anchors and aliases keep their source spans and shared decoded value", () => {
  const text = "first: &shared {name: value}\nsecond: *shared\n";
  const entries = yamlTopLevelEntries(text);
  expect(entries.map((entry) => entry.key)).toEqual(["first", "second"]);
  expect(entries[1].valueNode.value).toEqual({ name: "value" });
  expect(entries[1].valueNode.value).toBe(entries[0].valueNode.value);
  expect(text.slice(entries[1].valueNode.from, entries[1].valueNode.to)).toBe(
    "*shared",
  );
});

test("unwrap skips the outer node js-yaml composes around flow and item nodes", () => {
  const flow = yamlSource("{one: 1}")[0];
  expect(flow.children).toHaveLength(1);
  expect(unwrap(flow)).toBe(flow.children[0]);
  const item = yamlSource("- x")[0].children[0];
  expect(unwrap(item)).toBe(item.children[0]);
  // A one-item sequence is no wrapper
  const sequence = yamlSource("- x")[0];
  expect(unwrap(sequence)).toBe(sequence);
});

test("yamlAllEntries reports nested entries with their depth", () => {
  const text = "a: 1\nb:\n  - x\n  - c: 2\nd:\n  e: 3";
  expect(yamlAllEntries(text).map(({ key, depth }) => [key, depth])).toEqual([
    ["a", 0],
    ["b", 0],
    ["c", 2],
    ["d", 0],
    ["e", 1],
  ]);
});
