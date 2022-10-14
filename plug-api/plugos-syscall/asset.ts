import { base64Decode } from "../../plugos/asset_bundle/base64.ts";
import { syscall } from "./syscall.ts";

export async function readAsset(
  name: string,
  encoding: "utf8" | "dataurl" = "utf8",
): Promise<string> {
  const dataUrl = await syscall("asset.readAsset", name) as string;
  switch (encoding) {
    case "utf8":
      return new TextDecoder().decode(base64Decode(dataUrl.split(",")[1]));
    case "dataurl":
      return dataUrl;
  }
}
