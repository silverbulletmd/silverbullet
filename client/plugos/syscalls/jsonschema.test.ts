import { expect, test } from "vitest";
import { inferFromObject } from "./jsonschema.ts";

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
