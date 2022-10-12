import { base64Decode } from "../../plugos/asset_bundle/base64.ts";
import type { FileMeta } from "./fs.ts";
import { syscall } from "./syscall.ts";

export async function readAsset(
  name: string,
  encoding: "utf8" | "dataurl" = "utf8",
): Promise<{ text: string; meta: FileMeta }> {
  const { data, meta } = await syscall("asset.readAsset", name);
  switch (encoding) {
    case "utf8":
      return {
        text: new TextDecoder().decode(base64Decode(data)),
        meta,
      };
    case "dataurl":
      return {
        text: "data:application/octet-stream," + data,
        meta,
      };
  }
}
