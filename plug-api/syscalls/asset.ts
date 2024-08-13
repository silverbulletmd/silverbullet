import { base64DecodeDataUrl } from "../../lib/crypto.ts";
import { syscall } from "../syscall.ts";

/**
 * Reads an asset embedded in a plug (via the `assets` field in the plug manifest).
 * @param plugName name of the plug to read asset from
 * @param name name of the asset to read
 * @param encoding either "utf8" or "dataurl"
 * @returns the content of the asset in the requested encoding
 */
export async function readAsset(
  plugName: string,
  name: string,
  encoding: "utf8" | "dataurl" = "utf8",
): Promise<string> {
  const dataUrl = await syscall("asset.readAsset", plugName, name) as string;
  switch (encoding) {
    case "utf8":
      return new TextDecoder().decode(base64DecodeDataUrl(dataUrl));
    case "dataurl":
      return dataUrl;
  }
}
