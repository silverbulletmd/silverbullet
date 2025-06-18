import { publicVersion } from "../public_version.ts";

export function versionCommand() {
  console.log(publicVersion);
}
