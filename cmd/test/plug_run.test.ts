import { AssetBundle } from "$lib/asset_bundle/bundle.ts";
import { compileManifest } from "../compile.ts";
import * as esbuild from "esbuild";
import assets from "../../dist/plug_asset_bundle.json" with { type: "json" };
import { assertEquals } from "@std/assert";
import { dirname, join } from "@std/path";
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
  await Deno.writeFile(
    `${testSpaceFolder}/SETTINGS.md`,
    new TextEncoder().encode("```space-config\nindexPage: index\n```"),
  );

  await compileManifest(
    join(testFolder, "test_plug_run.plug.yaml"),
    plugFolder,
    {
      configPath: new URL("../../deno.json", import.meta.url).pathname,
    },
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
