import { expect } from "vitest";
import type { KvPrimitives } from "./kv_primitives.ts";

import type { KV } from "../../plug-api/types/datastore.ts";

export async function allTests(db: KvPrimitives) {
  await db.batchSet([
    { key: ["kv", "test2"], value: "Hello2" },
    { key: ["kv", "test1"], value: "Hello1" },
    { key: ["other", "random"], value: "Hello3" },
  ]);
  const result = await db.batchGet([
    ["kv", "test1"],
    ["kv", "test2"],
    ["kv", "test3"],
  ]);
  expect(result.length).toEqual(3);
  expect(result[0]).toEqual("Hello1");
  expect(result[1]).toEqual("Hello2");
  expect(result[2]).toEqual(undefined);
  let counter = 0;
  for await (const _entry of db.query({})) {
    counter++;
  }
  expect(counter).toEqual(3);

  counter = 0;
  for await (const _entry of db.query({ prefix: ["kv"] })) {
    counter++;
    console.log(_entry);
  }
  expect(counter).toEqual(2);

  await db.batchDelete([
    ["kv", "test1"],
    ["other", "random"],
  ]);
  const result2 = await db.batchGet([
    ["kv", "test1"],
    ["kv", "test2"],
    ["other", "random"],
  ]);
  expect(result2.length).toEqual(3);
  expect(result2[0]).toEqual(undefined);
  expect(result2[1]).toEqual("Hello2");
  expect(result2[2]).toEqual(undefined);

  await db.batchSet([{ key: ["kv", "test2"], value: "Hello2.1" }]);
  const [val] = await db.batchGet([["kv", "test2"]]);
  expect(val).toEqual("Hello2.1");

  const largeBatch: KV[] = [];
  for (let i = 0; i < 50; i++) {
    largeBatch.push({ key: ["test", `test${i}`], value: "Hello" });
  }
  await db.batchSet(largeBatch);
  const largeBatchResult: KV[] = [];
  for await (const entry of db.query({ prefix: ["test"] })) {
    largeBatchResult.push(entry);
  }
  expect(largeBatchResult.length).toEqual(50);

  await db.batchDelete(largeBatch.map((e) => e.key));

  for await (const _entry of db.query({ prefix: ["test"] })) {
    throw new Error("This should not happen");
  }

  // A prefix matches whole key parts: ["tag", "work"] doesn't match
  // ["tag", "work/meeting", ...]
  await db.batchSet([
    { key: ["tag", "work", "page1"], value: "Work" },
    { key: ["tag", "work/meeting", "page2"], value: "Meeting" },
  ]);
  const prefixResult: KV[] = [];
  for await (const entry of db.query({ prefix: ["tag", "work"] })) {
    prefixResult.push(entry);
  }
  expect(prefixResult).toEqual([
    { key: ["tag", "work", "page1"], value: "Work" },
  ]);
  expect(await db.countQuery({ prefix: ["tag", "work"] })).toEqual(1);
  expect(await db.countQuery({ prefix: ["tag"] })).toEqual(2);
  expect(await db.countQuery({})).toEqual(3);
}
