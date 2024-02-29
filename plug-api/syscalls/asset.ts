import { base64DecodeDataUrl } from "../../lib/crypto.ts";
import { syscall } from "../syscall.ts";

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
