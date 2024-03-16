import { assert, assertEquals } from "$std/testing/asserts.ts";
import { SpacePrimitives } from "./space_primitives.ts";

export async function testSpacePrimitives(spacePrimitives: SpacePrimitives) {
  const files = await spacePrimitives.fetchFileList();
  assertEquals(files, []);
  // Write text file
  const fileMeta = await spacePrimitives.writeFile(
    "test.txt",
    stringToBytes("Hello World"),
    false,
    {
      name: "test.txt",
      perm: "rw",
      created: 10,
      contentType: "text/plain",
      lastModified: 20,
      size: 11,
    },
  );

  const { data: retrievedData, meta: retrievedMeta } = await spacePrimitives
    .readFile("test.txt");

  assertEquals(retrievedData, stringToBytes("Hello World"));
  // Check that the meta data is persisted
  assertEquals(retrievedMeta.lastModified, 20);

  const fbContent = (await spacePrimitives.readFile("test.txt"))
    .data;
  assertEquals(new TextDecoder().decode(fbContent), "Hello World");

  assertEquals(await spacePrimitives.fetchFileList(), [fileMeta]);
  const buf = new Uint8Array(1024 * 1024);
  buf.set([1, 2, 3, 4, 5]);
  // Write binary file
  await spacePrimitives.writeFile("test.bin", buf);
  const fileData = await spacePrimitives.readFile("test.bin");
  assertEquals(fileData.data.length, 1024 * 1024);
  assertEquals((await spacePrimitives.fetchFileList()).length, 2);
  //   console.log(spacePrimitives);

  await spacePrimitives.deleteFile("test.bin");
  assertEquals(await spacePrimitives.fetchFileList(), [fileMeta]);

  // Clean up
  await spacePrimitives.deleteFile("test.txt");
  assertEquals(await spacePrimitives.fetchFileList(), []);

  // Test weird file names
  await spacePrimitives.writeFile("test+'s.txt", stringToBytes("Hello world!"));
  assertEquals(
    stringToBytes("Hello world!"),
    (await spacePrimitives.readFile("test+'s.txt")).data,
  );
  await spacePrimitives.deleteFile("test+'s.txt");

  // Check deletion of weird file file name
  try {
    await spacePrimitives.getFileMeta("test+'s.txt");
    assert(false);
  } catch (e: any) {
    assertEquals(e.message, "Not found");
  }
}

function stringToBytes(str: string): Uint8Array {
  return new TextEncoder().encode(str);
}
