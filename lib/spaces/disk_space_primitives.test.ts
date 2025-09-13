import "fake-indexeddb/auto";
import { testSpacePrimitives } from "./space_primitives.test.ts";
import { DiskSpacePrimitives } from "./disk_space_primitives.ts";

Deno.test("DataStoreSpacePrimitives", {
  sanitizeResources: false,
  sanitizeOps: false,
}, async () => {
  // Create a temporary folder
  const tempDir = await Deno.makeTempDir();
  const space = new DiskSpacePrimitives(tempDir);
  await testSpacePrimitives(space);
  Deno.remove(tempDir, { recursive: true });
});
