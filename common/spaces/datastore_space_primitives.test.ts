import "https://esm.sh/fake-indexeddb@4.0.2/auto";
import { assertEquals } from "../../test_deps.ts";
import { DataStore } from "../../plugos/lib/datastore.ts";
import { IndexedDBKvPrimitives } from "../../plugos/lib/indexeddb_kv_primitives.ts";
import { DataStoreSpacePrimitives } from "./datastore_space_primitives.ts";

Deno.test("DataStoreSpacePrimitives", {
  sanitizeResources: false,
  sanitizeOps: false,
}, async () => {
  const db = new IndexedDBKvPrimitives("test");
  await db.init();

  const space = new DataStoreSpacePrimitives(new DataStore(db));
  const files = await space.fetchFileList();
  assertEquals(files, []);
  // Write text file
  const fileMeta = await space.writeFile(
    "test.txt",
    stringToBytes("Hello World"),
  );
  assertEquals(
    (await space.readFile("test.txt")).data,
    stringToBytes("Hello World"),
  );
  const fbContent = (await space.readFile("test.txt"))
    .data;
  assertEquals(new TextDecoder().decode(fbContent), "Hello World");
  assertEquals(await space.fetchFileList(), [fileMeta]);
  const buf = new Uint8Array([1, 2, 3, 4, 5]);
  // Write binary file
  await space.writeFile("test.bin", buf);
  const fMeta = await space.getFileMeta("test.bin");
  assertEquals(fMeta.size, 5);
  assertEquals((await space.fetchFileList()).length, 2);

  await space.deleteFile("test.bin");
  assertEquals(await space.fetchFileList(), [fileMeta]);

  db.close();
});

function stringToBytes(str: string): Uint8Array {
  return new TextEncoder().encode(str);
}
