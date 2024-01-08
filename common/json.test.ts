import { assertEquals } from "../test_deps.ts";
import { decodeBSON, encodeBSON, traverseAndRewriteJSON } from "./json.ts";

Deno.test("traverseAndRewrite", () => {
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

Deno.test("BSON encoding", () => {
  // Test some primitives
  assertEquals(decodeBSON(encodeBSON("test")), "test");
  assertEquals(decodeBSON(encodeBSON([1, 2, 3])), [1, 2, 3]);
  assertEquals(decodeBSON(encodeBSON(true)), true);
  assertEquals(decodeBSON(encodeBSON(false)), false);
  assertEquals(decodeBSON(encodeBSON(null)), null);
  assertEquals(decodeBSON(encodeBSON(0)), 0);

  assertEquals(decodeBSON(encodeBSON(undefined)), undefined);

  const blob = new Uint8Array([1, 2, 3]);
  assertEquals(decodeBSON(encodeBSON(blob)), blob);

  // Then move to more advanced wrapped content
  const obj = {
    foo: "bar",
    list: ["hello", { sup: "world" }],
    nested: {
      baz: "qux",
    },
    bin: blob,
  };
  assertEquals(decodeBSON(encodeBSON(obj)), obj);
});
