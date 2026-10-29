import YAML from "js-yaml";
import { beforeEach, expect, test } from "vitest";
import { yamlTopLevelKeys } from "../../plug-api/lib/yaml_source.ts";
import { createMockSystem } from "../../plug-api/system_mock.ts";
import {
  applyEdits,
  checkWritable,
  editedSpans,
  findTarget,
  inlineYaml,
  isPageTarget,
  kindOf,
  minimalEdit,
  patchYaml,
} from "./object_edit.ts";
import { inlineHandler } from "./object_edit_inline.ts";
import { PAGE_READ_ONLY } from "./object_edit_page.ts";
import { objectsOf } from "./object_test_util.ts";

beforeEach(() => {
  createMockSystem();
});

test("applyEdits applies non-overlapping edits and rejects overlaps", () => {
  expect(
    applyEdits("abcdef", [
      { from: 4, to: 5, insert: "E" },
      { from: 0, to: 1, insert: "AA" },
    ]),
  ).toBe("AAbcdEf");
  expect(() =>
    applyEdits("abcdef", [
      { from: 0, to: 3, insert: "" },
      { from: 2, to: 4, insert: "" },
    ]),
  ).toThrow("these changes overlap");
});

test("editedSpans reports where each edit landed in the new text", () => {
  expect(
    editedSpans([
      { from: 4, to: 5, insert: "E" },
      { from: 0, to: 1, insert: "AA" },
    ]),
  ).toEqual([
    [0, 2],
    [5, 6],
  ]);
});

test("minimalEdit trims the common prefix and suffix", () => {
  expect(minimalEdit("abc", "abc")).toEqual([]);
  expect(minimalEdit("a-b-c", "a-XY-c")).toEqual([
    { from: 2, to: 3, insert: "XY" },
  ]);
});

test("inlineYaml keeps strings strings when YAML would read another type", () => {
  expect(inlineYaml("hello")).toBe("hello");
  expect(inlineYaml("2026-11-01")).toBe('"2026-11-01"');
  expect(inlineYaml("true")).toBe('"true"');
  expect(inlineYaml("12")).toBe('"12"');
  expect(inlineYaml("a]b")).toBe('"a\\u005db"');
  expect(inlineYaml(12)).toBe("12");
  expect(inlineYaml(false)).toBe("false");
  expect(inlineYaml(null)).toBe("null");
  expect(inlineYaml(["a", "b"])).toBe('["a","b"]');
});

test("patchYaml keeps quote style and list indentation", () => {
  const yaml = [
    "# people",
    'owner: "[[A]]"',
    "members:",
    '- "[[A]]"',
    "tags: a b",
    "reviewer: '[[D]]'",
    "nested:",
    "    - x",
    "status:   open # kept as is",
  ].join("\n");
  expect(
    patchYaml(
      yaml,
      {
        owner: "[[B]]",
        members: ["[[A]]", "[[B]]"],
        tags: "a b c",
        reviewer: "[[E]]",
        nested: ["x", "y z"],
        x: "[[C]]",
      },
      [],
    ),
  ).toBe(
    [
      "# people",
      'owner: "[[B]]"',
      "members:",
      '- "[[A]]"',
      '- "[[B]]"',
      "tags: a b c",
      "reviewer: '[[E]]'",
      "nested:",
      "    - x",
      "    - y z",
      "status:   open # kept as is",
      'x: "[[C]]"',
    ].join("\n"),
  );
});

test("patchYaml removes a key with the comment lines directly above it", () => {
  expect(
    patchYaml("# intro\n\n# about a\na: 1\n# about b\nb: 2", {}, ["a"]),
  ).toBe("# intro\n\n# about b\nb: 2");
  expect(patchYaml("a: 1\n# about b\nb: 2\nc: 3", {}, ["b"])).toBe(
    "a: 1\nc: 3",
  );
});

test("patchYaml adds a new key before trailing blank lines", () => {
  expect(patchYaml("a: 1\n\n", { b: 2 }, [])).toBe("a: 1\nb: 2\n\n");
  expect(patchYaml("a: 1", { b: 2 }, [])).toBe("a: 1\nb: 2");
  expect(patchYaml("", { b: 2 }, [])).toBe("b: 2");
});

test("patchYaml falls back to double quotes when the style can't hold the value", () => {
  expect(patchYaml("a: plain\nb: 'single'", { a: "12", b: "x\ny" }, [])).toBe(
    'a: "12"\nb: "x\\ny"',
  );
  expect(patchYaml("", { count: 3, ok: true, none: null, list: [] }, [])).toBe(
    "count: 3\nok: true\nnone: null\nlist: []",
  );
});

test("patchYaml empties an existing key set to null, and writes null for a new one", () => {
  expect(patchYaml("tags: project\nstatus: draft", { tags: null }, [])).toBe(
    "tags:\nstatus: draft",
  );
  expect(patchYaml("tags:\n  - a\n  - b", { tags: null }, [])).toBe("tags:");
  expect(patchYaml("", { none: null }, [])).toBe("none: null");
});

test("patchYaml writes Date values as bare dates", () => {
  expect(
    patchYaml(
      "due: 2026-12-01\ntitle: Apollo",
      { due: new Date("2026-12-15") },
      [],
    ),
  ).toBe("due: 2026-12-15\ntitle: Apollo");
  expect(patchYaml("", { at: new Date("2026-12-15T09:30:00Z") }, [])).toBe(
    "at: 2026-12-15T09:30:00.000Z",
  );
  expect(
    patchYaml(
      "",
      { days: [new Date("2026-12-15"), new Date("2026-12-16")] },
      [],
    ),
  ).toBe("days:\n  - 2026-12-15\n  - 2026-12-16");
});

test("patchYaml double-quotes an ISO date string, replacing a bare date or added new", () => {
  expect(
    patchYaml("due: 2026-12-01\ntitle: Apollo", { due: "2026-12-15" }, []),
  ).toBe('due: "2026-12-15"\ntitle: Apollo');
  expect(patchYaml("title: Apollo", { due: "2026-12-15" }, [])).toBe(
    'title: Apollo\ndue: "2026-12-15"',
  );
  expect(
    patchYaml('due: "2026-12-01"\ntitle: Apollo', { due: "2026-12-15" }, []),
  ).toBe('due: "2026-12-15"\ntitle: Apollo');
});

test("patchYaml order moves whole key blocks, each byte-identical", () => {
  const yaml = [
    "tags: project",
    "# Who runs it",
    "owner:   '[[Person/Alice]]'  # lead",
    "members:",
    '  - "[[Person/Bob]]"',
    "",
    '  - "[[Person/Carol]]"',
    "due: 2026-12-01",
  ].join("\n");
  expect(patchYaml(yaml, {}, [], ["due", "members"])).toBe(
    [
      "due: 2026-12-01",
      "members:",
      '  - "[[Person/Bob]]"',
      "",
      '  - "[[Person/Carol]]"',
      "tags: project",
      "# Who runs it",
      "owner:   '[[Person/Alice]]'  # lead",
    ].join("\n"),
  );
});

test("patchYaml order: partial lists, unknown keys and a full order", () => {
  const yaml = "a: 1\nb: 2\nc: 3";
  expect(patchYaml(yaml, {}, [], ["c"])).toBe("c: 3\na: 1\nb: 2");
  expect(patchYaml(yaml, {}, [], ["zz", "b", "b"])).toBe("b: 2\na: 1\nc: 3");
  expect(patchYaml(yaml, {}, [], ["a", "c", "b"])).toBe("a: 1\nc: 3\nb: 2");
  expect(patchYaml(yaml, {}, [], [])).toBe(yaml);
  // A comment above the first key stays attached to it
  expect(patchYaml("# head\na: 1\nb: 2", {}, [], ["b"])).toBe(
    "b: 2\n# head\na: 1",
  );
  // Patch and order in one go
  expect(patchYaml(yaml, { d: 4 }, ["a"], ["d"])).toBe("d: 4\nb: 2\nc: 3");
});

test("patchYaml order keeps block scalars whole and drops dangling blank lines", () => {
  const yaml = "a: 1\ntext: |\n  line one\n\n  line two\nb: 2";
  expect(patchYaml(yaml, {}, [], ["b"])).toBe(
    "b: 2\na: 1\ntext: |\n  line one\n\n  line two",
  );
  expect(patchYaml(yaml, {}, [], ["text"])).toBe(
    "text: |\n  line one\n\n  line two\na: 1\nb: 2",
  );
  const folded = "note: >\n  first\n\n  second\nz: 1";
  expect(patchYaml(folded, {}, [], ["z"])).toBe(
    "z: 1\nnote: >\n  first\n\n  second",
  );
  // A blank line between keys doesn't end up at the end
  expect(patchYaml("name: Ada\n\nage: 36", {}, [], ["age"])).toBe(
    "age: 36\nname: Ada",
  );
  expect(patchYaml("a: 1\n\nb: 2\nc: 3", {}, [], ["c"])).toBe(
    "c: 3\na: 1\n\nb: 2",
  );
});

test("yamlTopLevelKeys keeps decoded integer-like keys in source order", () => {
  expect(yamlTopLevelKeys("b: 1\n2: x\na: 3")).toEqual(["b", "2", "a"]);
  // Move up on a, as the form computes it
  expect(patchYaml("b: 1\n2: x\na: 3", {}, [], ["b", "a", "2"])).toBe(
    "b: 1\na: 3\n2: x",
  );
  expect(yamlTopLevelKeys('x: 1\n1.0: y\n"q k": 2\nlist:\n  - a: 1')).toEqual([
    "x",
    "1",
    "q k",
    "list",
  ]);
});

test("kindOf and isPageTarget", () => {
  expect(kindOf({ tag: "task" })).toBe("task");
  expect(kindOf({ tag: "expense", itags: ["data"] })).toBe("data");
  expect(kindOf({ tag: "anchor" })).toBeNull();
  expect(isPageTarget({ page: "Notes", ref: "Notes", tag: "page" })).toBe(true);
  expect(isPageTarget({ page: "Notes", ref: "Notes" })).toBe(true);
  expect(isPageTarget({ page: "Notes", ref: "Notes@3", range: [3, 9] })).toBe(
    false,
  );
});

test("findTarget picks the task, not the anchor object with the same ref", async () => {
  const text = "* [ ] Call Pete $call-pete\n";
  const fresh = await objectsOf(text);
  const found = findTarget(fresh, {
    page: "Notes",
    ref: "call-pete",
  });
  expect(found.tag).toBe("task");
});

test("findTarget fails on a stale position ref instead of editing a neighbour", async () => {
  const original = "* [ ] A #x\n* [ ] B #x\n";
  const [a] = (await objectsOf(original)).filter((o) => o.tag === "task");
  // Text inserted above shifts every position
  const shifted = await objectsOf(`Intro\n\n${original}`);
  expect(() => findTarget(shifted, a as any)).toThrow(
    "object moved or was removed from Notes, query again",
  );
  // Same position, different object
  const replaced = await objectsOf("* [ ] Z #x\n* [ ] B #x\n");
  expect(() => findTarget(replaced, a as any)).toThrow("object moved");
});

test("findTarget reports a missing anchor", async () => {
  const fresh = await objectsOf("* [ ] A\n");
  expect(() => findTarget(fresh, { page: "Notes", ref: "gone" })).toThrow(
    "Notes has no object $gone",
  );
});

test("checkWritable rejects derived attributes", () => {
  const task = inlineHandler("task").readOnly;
  expect(() => checkWritable("task", task, ["due"])).not.toThrow();
  expect(() => checkWritable("task", task, ["text"])).toThrow(
    '"text" can\'t be changed on a task',
  );
  expect(() => checkWritable("page", PAGE_READ_ONLY, ["name"])).toThrow(
    '"name" can\'t be changed on a page',
  );
});

test("patchYaml writes a string with a newline as valid YAML that reads back the same", () => {
  const load = (yaml: string) => YAML.load(yaml) as Record<string, unknown>;
  // A new key and a plain one are double-quoted with an escaped newline
  const created = patchYaml("a: 1", { note: "a\nb" }, []);
  expect(created).toBe('a: 1\nnote: "a\\nb"');
  expect(load(created).note).toBe("a\nb");
  expect(patchYaml("note: x", { note: "a\nb" }, [])).toBe('note: "a\\nb"');
  // In a list, only the changed item is rewritten; the siblings stay as they are
  const list = "tags:\n  - one\n  - two\nother: kept # comment";
  const edited = patchYaml(list, { tags: ["one", "t\nwo"] }, []);
  expect(edited).toBe('tags:\n  - one\n  - "t\\nwo"\nother: kept # comment');
  expect(load(edited).tags).toEqual(["one", "t\nwo"]);
  const quoted = patchYaml(
    'tags:\n  - "one"\n  - "two"',
    { tags: ["one", "a\nb"] },
    [],
  );
  expect(quoted).toBe('tags:\n  - "one"\n  - "a\\nb"');
  // A line break at either end survives too
  expect(load(patchYaml("", { n: "a\n" }, [])).n).toBe("a\n");
  expect(load(patchYaml("", { n: "\na" }, [])).n).toBe("\na");
});

test("patchYaml leaves single quotes for double quotes when the value has a newline", () => {
  const out = patchYaml("a: 'it''s'", { a: "x\ny" }, []);
  expect(out).toBe('a: "x\\ny"');
  expect(YAML.load(out)).toEqual({ a: "x\ny" });
  // Without a newline the single-quote style is kept
  expect(patchYaml("a: 'x'", { a: "it's" }, [])).toBe("a: 'it''s'");
});

test("decoded keys target writes, removal and ordering while retaining spelling", () => {
  const yaml = String.raw`"key\u0020name": example` + "\n1.0: old\nlast: yes";
  expect(
    patchYaml(
      yaml,
      { "key name": "updated", "1": "new" },
      [],
      ["1", "key name"],
    ),
  ).toBe("1.0: new\n" + String.raw`"key\u0020name": updated` + "\nlast: yes");
  expect(patchYaml(yaml, {}, ["key name", "1"])).toBe("last: yes");
});

test("multiline flow values use the full parsed extent", () => {
  expect(
    patchYaml(
      "items: [\n one,\n two\n]\nneighbor: keep",
      { items: ["new"] },
      [],
    ),
  ).toBe("items:\n  - new\nneighbor: keep");
  expect(() => patchYaml("{one: old, two: keep}", { one: "new" }, [])).toThrow(
    "flow mappings must be edited in source",
  );
});

test("removing an empty value preserves the next property's comment", () => {
  expect(patchYaml("empty: # absent\n# next\nother: keep", {}, ["empty"])).toBe(
    "# next\nother: keep",
  );
});

test("explicit YAML keys cannot be partially removed or reordered", () => {
  const source = "?\n  a\n: old\nb: keep";
  expect(() => patchYaml(source, {}, ["a"])).toThrow("edited in source");
  expect(() => patchYaml(source, {}, [], ["b", "a"])).toThrow(
    "edited in source",
  );
});

test("patchYaml removes the last key with the line break before it", () => {
  expect(patchYaml("a: 1\nb: 2", {}, ["b"])).toBe("a: 1");
  expect(patchYaml("a: 1\nb: 2\n", {}, ["b"])).toBe("a: 1\n");
  expect(patchYaml("a: 1", {}, ["a"])).toBe("");
  // Removing the last key and adding one in the same patch
  expect(patchYaml("a: 1\nb: 2", { c: 3 }, ["b"])).toBe("a: 1\nc: 3");
});

test("patchYaml: remove wins over a patch of the same key, and repeats are ignored", () => {
  expect(patchYaml("a: 1\nb: 2", { a: 5 }, ["a", "a"])).toBe("b: 2");
});
