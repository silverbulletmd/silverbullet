import { assertEquals } from "../../test_deps.ts";
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
  const fMeta = await spacePrimitives.getFileMeta("test.bin");
  assertEquals(fMeta.size, 1024 * 1024);
  assertEquals((await spacePrimitives.fetchFileList()).length, 2);
  //   console.log(spacePrimitives);

  await spacePrimitives.deleteFile("test.bin");
  assertEquals(await spacePrimitives.fetchFileList(), [fileMeta]);
}

function stringToBytes(str: string): Uint8Array {
  return new TextEncoder().encode(str);
}
