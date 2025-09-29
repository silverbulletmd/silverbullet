import { assertEquals } from "@std/assert";
import { Augmenter } from "./data_augmenter.ts";
import { DataStore } from "./datastore.ts";
import { MemoryKvPrimitives } from "./memory_kv_primitives.ts";

Deno.test("Test data augmentation", async () => {
  const ds = new DataStore(new MemoryKvPrimitives());
  const john: any = {
    ref: "john",
    name: "John",
    age: 1234,
  };
  const mary: any = {
    ref: "mary",
    name: "Mary",
    age: 5678,
  };
  ds.batchSet([{
    key: ["john"],
    value: john,
  }, {
    key: ["mary"],
    value: mary,
  }]);
  const augm = new Augmenter(ds, ["aug"]);
  // Augment only john
  await augm.setAugmentation("john", { augmented: true });
  // Fetch them back
  const objs = [john, mary];
  await augm.augmentObjectArray(objs, "ref");
  assertEquals(objs[0].augmented, true);
  assertEquals(objs[1].augmented, undefined);
});
