import { DenoKvPrimitives } from "$lib/data/deno_kv_primitives.ts";
import { ChunkedKvStoreSpacePrimitives } from "$common/spaces/chunked_datastore_space_primitives.ts";
import { testSpacePrimitives } from "$common/spaces/space_primitives.test.ts";

Deno.test("deno kv test", async () => {
  const tempFile = await Deno.makeTempFile({ suffix: ".db" });
  const denoKv = new DenoKvPrimitives(await Deno.openKv(tempFile));
  const spacePrimitives = new ChunkedKvStoreSpacePrimitives(denoKv, 65536);
  await testSpacePrimitives(spacePrimitives);
  denoKv.close();
  await Deno.remove(tempFile);
});
