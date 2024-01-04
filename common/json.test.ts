import { assertEquals } from "../test_deps.ts";
import { traverseAndRewriteJSON } from "./json.ts";

Deno.test("traverseAndRewrite should recursively traverse and rewrite object properties", () => {
  const bufArray = new Uint8Array([1, 2, 3]);
  const obj = {
    foo: "bar",
    list: ["hello", { sup: "world" }],
    nested: {
      baz: "qux",
    },
    special: {
      value: () => {
        return bufArray;
      },
    },
  };

  const rewritten = traverseAndRewriteJSON(obj, (val) => {
    if (typeof val?.value === "function") {
      return val.value();
    }
    if (typeof val === "string") {
      return val.toUpperCase();
    }
    return val;
  });

  assertEquals(rewritten, {
    foo: "BAR",
    list: ["HELLO", { sup: "WORLD" }],
    nested: {
      baz: "QUX",
    },
    special: bufArray,
  });
});
