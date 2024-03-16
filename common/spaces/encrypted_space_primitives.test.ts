import { MemoryKvPrimitives } from "$lib/data/memory_kv_primitives.ts";
import { assert, assertEquals } from "$std/testing/asserts.ts";
import { ChunkedKvStoreSpacePrimitives } from "./chunked_datastore_space_primitives.ts";
import { EncryptedSpacePrimitives } from "./encrypted_space_primitives.ts";
import { testSpacePrimitives } from "./space_primitives.test.ts";

Deno.test("Encrypted Space Primitives", async () => {
  // Using an in-memory store for testing
  const memoryKv = new MemoryKvPrimitives();
  const spacePrimitives = new EncryptedSpacePrimitives(
    new ChunkedKvStoreSpacePrimitives(
      memoryKv,
      1024 * 1024,
    ),
  );
  assertEquals(false, await spacePrimitives.init());
  await spacePrimitives.setup("password");
  assertEquals(await spacePrimitives.fetchFileList(), []);
  await testSpacePrimitives(spacePrimitives);

  // Let's try an incorrect password
  try {
    await spacePrimitives.login("wronk");
    assert(false);
  } catch (e: any) {
    assertEquals(e.message, "Incorrect password");
  }

  // Now let's update the password
  await spacePrimitives.updatePassword("password", "password2");

  try {
    await spacePrimitives.updatePassword("password", "password2");
    assert(false);
  } catch (e: any) {
    assertEquals(e.message, "Incorrect password");
  }

  await spacePrimitives.writeFile(
    "test.txt",
    new TextEncoder().encode("Hello World"),
  );

  // Let's do this again with the new password

  const spacePrimitives2 = new EncryptedSpacePrimitives(
    new ChunkedKvStoreSpacePrimitives(
      memoryKv,
      1024 * 1024,
    ),
  );
  assertEquals(true, await spacePrimitives2.init());
  await spacePrimitives2.login("password2");
  assertEquals(
    new TextDecoder().decode(
      (await spacePrimitives2.readFile("test.txt")).data,
    ),
    "Hello World",
  );
  await spacePrimitives2.deleteFile("test.txt");
  await testSpacePrimitives(spacePrimitives2);
});
