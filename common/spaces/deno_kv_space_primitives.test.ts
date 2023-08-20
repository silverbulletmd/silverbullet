import { assertEquals } from "../../test_deps.ts";
import { DenoKVSpacePrimitives } from "./deno_kv_space_primitives.ts";

Deno.test("deno_kv_space_primitives", async () => {
  const tempFile = await Deno.makeTempFile({ suffix: ".db" });
  const spacePrimitives = new DenoKVSpacePrimitives();
  await spacePrimitives.init(tempFile);
  await spacePrimitives.writeFile("test.txt", new TextEncoder().encode("test"));
  let result = await spacePrimitives.readFile("test.txt");
  assertEquals(result.data, new TextEncoder().encode("test"));
  let listing = await spacePrimitives.fetchFileList();
  assertEquals(listing.length, 1);
  await spacePrimitives.writeFile(
    "test.txt",
    new TextEncoder().encode("test2"),
  );
  result = await spacePrimitives.readFile("test.txt");
  assertEquals(result.data, new TextEncoder().encode("test2"));
  await spacePrimitives.deleteFile("test.txt");
  listing = await spacePrimitives.fetchFileList();
  try {
    await spacePrimitives.readFile("test.txt");
    throw new Error("Should not be here");
  } catch (e: any) {
    assertEquals(e.message, "Not found");
  }
  assertEquals(listing.length, 0);

  spacePrimitives.close();
  await Deno.remove(tempFile);
});
