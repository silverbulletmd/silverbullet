import { AssetBundle } from "$lib/asset_bundle/bundle.ts";
import { compileManifest } from "$lib/plugos/compile.ts";
import { esbuild } from "$lib/plugos/deps.ts";
import assets from "../dist/plug_asset_bundle.json" assert { type: "json" };
import { assertEquals } from "$std/testing/asserts.ts";
import { path } from "$common/deps.ts";
import { MemoryKvPrimitives } from "$lib/data/memory_kv_primitives.ts";
import { runPlug } from "./plug_run.ts";

Deno.test("Test plug run", {
  sanitizeResources: false,
  sanitizeOps: false,
}, async () => {
  const assetBundle = new AssetBundle(assets);

  const testFolder = path.dirname(new URL(import.meta.url).pathname);
  const testSpaceFolder = path.join(testFolder, "test_space");

  const plugFolder = path.join(testSpaceFolder, "_plug");
  await Deno.mkdir(plugFolder, { recursive: true });

  await compileManifest(
    path.join(testFolder, "test.plug.yaml"),
    plugFolder,
  );
  assertEquals(
    await runPlug(
      testSpaceFolder,
      "test.run",
      [],
      assetBundle,
      new MemoryKvPrimitives(),
    ),
    "Hello",
  );

  // await Deno.remove(tempDir, { recursive: true });
  esbuild.stop();
});
