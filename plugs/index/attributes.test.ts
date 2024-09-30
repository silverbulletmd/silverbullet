import { assertEquals } from "@std/assert/equals";
import { determineType, jsonTypeToString } from "./attributes.ts";

Deno.test("JSON Determine type", () => {
  // Determine type tests
  assertEquals(determineType(null), { type: "null" });
  assertEquals(determineType(undefined), { type: "null" });
  assertEquals(determineType("hello"), { type: "string" });
  assertEquals(determineType(10), { type: "number" });
  assertEquals(determineType(true), { type: "boolean" });
  assertEquals(determineType({}), { type: "object", properties: {} });
  assertEquals(determineType([]), { type: "array" });
  assertEquals(determineType([1]), {
    type: "array",
    items: { type: "number" },
  });
  assertEquals(
    determineType({ name: "Pete", age: 10, siblings: ["Sarah"] }),
    {
      type: "object",
      properties: {
        name: { type: "string" },
        age: { type: "number" },
        siblings: { type: "array", items: { type: "string" } },
      },
    },
  );
});

Deno.test("Serialize JSON Type to string", () => {
  assertEquals(jsonTypeToString({ type: "string" }), "string");
  assertEquals(jsonTypeToString({ type: "null" }), "null");
  assertEquals(jsonTypeToString({ type: "number" }), "number");
  assertEquals(jsonTypeToString({ type: "boolean" }), "boolean");
  assertEquals(jsonTypeToString({ type: "array" }), "any[]");
  assertEquals(
    jsonTypeToString({ type: "array", items: { type: "number" } }),
    "number[]",
  );
  assertEquals(
    jsonTypeToString({ type: "object", properties: {} }),
    "{}",
  );
  assertEquals(
    jsonTypeToString({
      type: "object",
      properties: {
        name: { type: "string" },
        age: { type: "number" },
      },
    }),
    "{name: string; age: number;}",
  );
  assertEquals(
    jsonTypeToString({
      anyOf: [
        { type: "string" },
        { type: "number" },
        { type: "boolean" },
      ],
    }),
    "string | number | boolean",
  );
});
