import { AssetBundle } from "./bundle.ts";
import { assertEquals } from "$std/testing/asserts.ts";

Deno.test("Asset bundle", () => {
  const assetBundle = new AssetBundle();
  assetBundle.writeTextFileSync("test.txt", "text/plain", "Sup yo");
  assertEquals("text/plain", assetBundle.getMimeType("test.txt"));
  assertEquals("Sup yo", assetBundle.readTextFileSync("test.txt"));
  const buf = new Uint8Array(3);
  buf[0] = 1;
  buf[1] = 2;
  buf[2] = 3;
  assetBundle.writeFileSync("test.bin", "application/octet-stream", buf);
  assertEquals("application/octet-stream", assetBundle.getMimeType("test.bin"));
  assertEquals(buf, assetBundle.readFileSync("test.bin"));
});
