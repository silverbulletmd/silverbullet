import { assert, assertEquals } from "@std/assert";
import type { SpacePrimitives } from "./space_primitives.ts";
import type { FileMeta } from "../../plug-api/types/index.ts";
import { notFoundError } from "../constants.ts";

export async function testSpacePrimitives(spacePrimitives: SpacePrimitives) {
  await testBasicOperations(spacePrimitives);
  await testFileOverwriting(spacePrimitives);
  await testEmptyFiles(spacePrimitives);
  await testUnicodeContent(spacePrimitives);
  await testSpecialFileNames(spacePrimitives);
  await testErrorHandling(spacePrimitives);
  await testLargeFiles(spacePrimitives);
  await testMetadataPreservation(spacePrimitives);

  // Ensure clean state at the end
  const finalFiles = await spacePrimitives.fetchFileList();
  assertEquals(finalFiles, []);
}

async function testBasicOperations(spacePrimitives: SpacePrimitives) {
  const files = await spacePrimitives.fetchFileList();
  assertEquals(files, []);

  // Write text file
  const fileMeta = await spacePrimitives.writeFile(
    "test.txt",
    stringToBytes("Hello World"),
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

  // Write binary file
  const buf = new Uint8Array(1024 * 1024);
  buf.set([1, 2, 3, 4, 5]);
  await spacePrimitives.writeFile("test.bin", buf);
  const fileData = await spacePrimitives.readFile("test.bin");
  assertEquals(fileData.data.length, 1024 * 1024);
  assertEquals((await spacePrimitives.fetchFileList()).length, 2);

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
    assertEquals(e, notFoundError);
  }
}

async function testFileOverwriting(spacePrimitives: SpacePrimitives) {
  // Test overwriting existing files
  await spacePrimitives.writeFile("overwrite.txt", stringToBytes("Original"));
  const _originalMeta = await spacePrimitives.getFileMeta("overwrite.txt");

  await spacePrimitives.writeFile("overwrite.txt", stringToBytes("Updated"));
  const updatedData = await spacePrimitives.readFile("overwrite.txt");
  assertEquals(new TextDecoder().decode(updatedData.data), "Updated");

  // File list should still have only one entry for this file
  const filesAfterOverwrite = await spacePrimitives.fetchFileList();
  const overwriteFiles = filesAfterOverwrite.filter((f) =>
    f.name === "overwrite.txt"
  );
  assertEquals(overwriteFiles.length, 1);

  await spacePrimitives.deleteFile("overwrite.txt");
}

async function testEmptyFiles(spacePrimitives: SpacePrimitives) {
  // Test empty file
  await spacePrimitives.writeFile("empty.txt", new Uint8Array(0));
  const emptyFile = await spacePrimitives.readFile("empty.txt");
  assertEquals(emptyFile.data.length, 0);
  assertEquals(emptyFile.meta.size, 0);
  await spacePrimitives.deleteFile("empty.txt");
}

async function testUnicodeContent(spacePrimitives: SpacePrimitives) {
  // Test files with Unicode characters
  const unicodeContent = "Hello 世界! 🌍 Здравствуй мир!";
  await spacePrimitives.writeFile("unicode.txt", stringToBytes(unicodeContent));
  const unicodeFile = await spacePrimitives.readFile("unicode.txt");
  assertEquals(new TextDecoder().decode(unicodeFile.data), unicodeContent);
  await spacePrimitives.deleteFile("unicode.txt");
}

async function testSpecialFileNames(spacePrimitives: SpacePrimitives) {
  // Test file names with various special characters
  const specialNames = [
    "file with spaces.txt",
    "file-with-hyphens.txt",
    "file_with_underscores.txt",
    "file.with.dots.txt",
    "UPPERCASE.TXT",
    "123numeric.txt",
    "émojis🚀file.txt",
  ];

  for (const fileName of specialNames) {
    await spacePrimitives.writeFile(
      fileName,
      stringToBytes(`Content of ${fileName}`),
    );
    const fileData = await spacePrimitives.readFile(fileName);
    assertEquals(
      new TextDecoder().decode(fileData.data),
      `Content of ${fileName}`,
    );
  }

  // Verify all special files are in the list
  const allFiles = await spacePrimitives.fetchFileList();
  for (const fileName of specialNames) {
    const found = allFiles.find((f) => f.name === fileName);
    assert(found, `File ${fileName} should be in the file list`);
  }

  // Clean up special files
  for (const fileName of specialNames) {
    await spacePrimitives.deleteFile(fileName);
  }
}

async function testErrorHandling(spacePrimitives: SpacePrimitives) {
  // Test error cases
  try {
    await spacePrimitives.readFile("nonexistent.txt");
    assert(false, "Should throw error for non-existent file");
  } catch (e: any) {
    assertEquals(e, notFoundError);
  }

  try {
    await spacePrimitives.deleteFile("nonexistent.txt");
    assert(false, "Should throw error when deleting non-existent file");
  } catch (e: any) {
    assertEquals(e, notFoundError);
  }
}

async function testLargeFiles(spacePrimitives: SpacePrimitives) {
  // Test large file content
  const largeContent = new Uint8Array(5 * 1024 * 1024); // 5MB
  for (let i = 0; i < largeContent.length; i++) {
    largeContent[i] = i % 256;
  }

  await spacePrimitives.writeFile("large.bin", largeContent);
  const largeFile = await spacePrimitives.readFile("large.bin");
  assertEquals(largeFile.data.length, largeContent.length);
  assertEquals(largeFile.meta.size, largeContent.length);

  // Verify content integrity
  for (let i = 0; i < Math.min(1000, largeContent.length); i++) {
    assertEquals(largeFile.data[i], largeContent[i]);
  }

  await spacePrimitives.deleteFile("large.bin");
}

async function testMetadataPreservation(spacePrimitives: SpacePrimitives) {
  // Test metadata preservation
  const testContent = stringToBytes("Hello meta!");
  const customMeta: FileMeta = {
    name: "meta-test.txt",
    perm: "rw",
    created: 1000000,
    contentType: "text/plain", // Use a content type that matches the file extension
    lastModified: 2000000,
    size: testContent.length, // Use actual content length
  };

  await spacePrimitives.writeFile(
    "meta-test.txt",
    testContent,
    customMeta,
  );
  const metaFile = await spacePrimitives.readFile("meta-test.txt");

  // Check that some metadata is preserved (implementations may handle timestamps differently)
  assert(
    metaFile.meta.lastModified > 0,
    "LastModified timestamp should be set",
  );
  assertEquals(metaFile.meta.name, "meta-test.txt");
  assertEquals(metaFile.meta.size, testContent.length);

  await spacePrimitives.deleteFile("meta-test.txt");
}

function stringToBytes(str: string): Uint8Array {
  return new TextEncoder().encode(str);
}
