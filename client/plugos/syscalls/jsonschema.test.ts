import { expect, test } from "vitest";
import { inferFromObject, validateObject } from "./jsonschema.ts";

test("inferFromObject maps primitive field types", () => {
  const schema = inferFromObject({
    name: "Foo",
    count: 3,
    ratio: 1.5,
    done: false,
    missing: null,
  });
  expect(schema.type).toBe("object");
  expect(schema["x-inferred"]).toBe(true);
  expect(schema.properties.name).toEqual({ type: "string" });
  expect(schema.properties.count).toEqual({ type: "integer" });
  expect(schema.properties.ratio).toEqual({ type: "number" });
  expect(schema.properties.done).toEqual({ type: "boolean" });
  expect(schema.properties.missing).toEqual({ type: "null" });
});

test("inferFromObject recurses into arrays and nested objects", () => {
  const schema = inferFromObject({
    tags: ["a", "b"],
    meta: { owner: "z", weight: 2 },
    empty: [],
  });
  expect(schema.properties.tags).toEqual({
    type: "array",
    items: { type: "string" },
  });
  expect(schema.properties.meta).toEqual({
    type: "object",
    properties: { owner: { type: "string" }, weight: { type: "integer" } },
  });
  // An empty array has no element to learn `items` from.
  expect(schema.properties.empty).toEqual({ type: "array" });
});

test("inferFromObject handles a non-object top-level value", () => {
  const schema = inferFromObject("hello");
  expect(schema.type).toBe("string");
  expect(schema["x-inferred"]).toBe(true);
});

const refSchema = {
  type: "object",
  properties: { o: { type: "string", format: "ref", tag: "person" } },
};

test("validateObject accepts a single wikilink for format ref", () => {
  expect(validateObject(refSchema, { o: "[[Person/Alice]]" })).toBeUndefined();
  expect(validateObject(refSchema, { o: "[[$task1]]" })).toBeUndefined();
  expect(validateObject(refSchema, { o: "[[Page$anchor]]" })).toBeUndefined();
});

test("validateObject rejects non-links for format ref", () => {
  expect(validateObject(refSchema, { o: "Alice" })).toContain('format "ref"');
  expect(validateObject(refSchema, { o: "[[A]] and [[B]]" })).toContain(
    'format "ref"',
  );
  expect(validateObject(refSchema, { o: "[[]]" })).toContain('format "ref"');
});

// What schema.tags() and schema.identities() expand to
const listOrString = (item: string, list: string) => ({
  anyOf: [
    { type: "array", items: { type: "string", format: item } },
    { type: "string", format: list },
  ],
});
const tagsSchema = {
  type: "object",
  properties: {
    tags: listOrString("tag", "tags"),
    recipients: listOrString("identity", "identities"),
  },
};

test("tags accept the shapes the indexer reads from frontmatter", () => {
  for (const tags of [
    ["project", "glossary"],
    ["#project", "my tag", "v1.0"],
    "project glossary",
    "project, glossary",
    "project,glossary  #idea",
    "",
  ]) {
    expect(validateObject(tagsSchema, { tags })).toBeUndefined();
  }
});

test("tags reject empty and bare-# entries", () => {
  expect(validateObject(tagsSchema, { tags: ["project", ""] })).toContain(
    'format "tag"',
  );
  expect(validateObject(tagsSchema, { tags: ["#"] })).toContain('format "tag"');
  expect(validateObject(tagsSchema, { tags: "project # idea" })).toBeDefined();
});

test("identities accept @names with or without @, as lists or strings", () => {
  for (const recipients of [
    ["alice", "@bob"],
    "alice @bob",
    "alice, bob",
    "[[Person/Alice]] bob",
  ]) {
    expect(validateObject(tagsSchema, { recipients })).toBeUndefined();
  }
});

test("identities reject empty and bare-@ entries", () => {
  expect(validateObject(tagsSchema, { recipients: ["@"] })).toContain(
    'format "identity"',
  );
  expect(validateObject(tagsSchema, { recipients: ["alice", " "] })).toContain(
    'format "identity"',
  );
  expect(validateObject(tagsSchema, { recipients: "alice @" })).toBeDefined();
});
