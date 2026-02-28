import { expect, test } from "vitest";
import { AssetBundle } from "./bundle.ts";

test("Asset bundle", () => {
  const assetBundle = new AssetBundle();
  assetBundle.writeTextFileSync("test.txt", "text/plain", "Sup yo");
  expect("text/plain").toEqual(assetBundle.getMimeType("test.txt"));
  expect("Sup yo").toEqual(assetBundle.readTextFileSync("test.txt"));
  const buf = new Uint8Array(3);
  buf[0] = 1;
  buf[1] = 2;
  buf[2] = 3;
  assetBundle.writeFileSync("test.bin", "application/octet-stream", buf);
  expect("application/octet-stream").toEqual(assetBundle.getMimeType("test.bin"));
  expect(buf).toEqual(assetBundle.readFileSync("test.bin"));
});
