import { expect, test } from "vitest";
import { MemoryKvPrimitives } from "../data/memory_kv_primitives.ts";
import { CheckedSpacePrimitives } from "./checked_space_primitives.ts";
import { DataStoreSpacePrimitives } from "./datastore_space_primitives.ts";

test("folders are created where a page by that name could live", async () => {
  const inner = new DataStoreSpacePrimitives(new MemoryKvPrimitives());
  const space = new CheckedSpacePrimitives(inner, false);

  await space.createFolder("Notes/Ideas");
  expect((await inner.fetchListing()).folders!.sort()).toEqual([
    "Notes",
    "Notes/Ideas",
  ]);
  for (const bad of [".hidden", "Notes/../Up", "Notes//Double", ""]) {
    expect(() => space.createFolder(bad), bad).toThrow("not writable");
  }
});

test("a read-only space refuses folder changes", () => {
  const space = new CheckedSpacePrimitives(
    new DataStoreSpacePrimitives(new MemoryKvPrimitives()),
    true,
  );
  expect(() => space.createFolder("Notes")).toThrow("not writable");
  expect(() => space.deleteFolder("Notes")).toThrow("read-only");
});
