import { AssetBundle } from "$lib/asset_bundle/bundle.ts";
import { compileManifest } from "../compile.ts";
import * as esbuild from "esbuild";
import assets from "../../dist/plug_asset_bundle.json" assert { type: "json" };
import { assertEquals } from "$std/testing/asserts.ts";
import { dirname, join } from "$std/path/mod.ts";
import { MemoryKvPrimitives } from "$lib/data/memory_kv_primitives.ts";
import { runPlug } from "../plug_run.ts";

Deno.test("Test plug run", {
  sanitizeResources: false,
  sanitizeOps: false,
}, async () => {
  const assetBundle = new AssetBundle(assets);

  const testFolder = dirname(new URL(import.meta.url).pathname);
  const testSpaceFolder = join(testFolder, "test_space");

  const plugFolder = join(testSpaceFolder, "_plug");
  await Deno.mkdir(plugFolder, { recursive: true });

  await compileManifest(
    join(testFolder, "test_plug_run.plug.yaml"),
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
