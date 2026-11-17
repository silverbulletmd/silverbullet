import { expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { InMemoryKvPrimitives } from "./in_memory_kv_primitives.ts";
import { allTests } from "./kv_primitives.test.ts";

test("InMemoryKvPrimitives passes the shared KV suite", async () => {
  await allTests(new InMemoryKvPrimitives());
});

// The browser bundle cannot resolve Node built-ins; a "Shared computer"
// session loads this store in the editor.
test("InMemoryKvPrimitives imports nothing from Node", () => {
  const source = readFileSync(
    new URL("./in_memory_kv_primitives.ts", import.meta.url),
    "utf-8",
  );
  expect(source).not.toMatch(/from\s+["']node:/);
});
