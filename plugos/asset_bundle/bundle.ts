import { base64Decode, base64EncodedDataUrl } from "./base64.ts";
import { mime } from "../deps.ts";

type DataUrl = string;

// Mapping from path -> `data:mimetype;base64,base64-encoded-data` strings
export type AssetJson = Record<string, DataUrl>;

export class AssetBundle {
  readonly bundle: AssetJson;

  constructor(bundle: AssetJson = {}) {
    this.bundle = bundle;
  }

  has(path: string): boolean {
    return path in this.bundle;
  }

  listFiles(): string[] {
    return Object.keys(this.bundle);
  }

  readFileSync(
    path: string,
  ): Uint8Array {
    const content = this.bundle[path];
    if (!content) {
      throw new Error(`No such file ${path}`);
    }
    const data = content.split(",", 2)[1];
    return base64Decode(data);
  }

  readFileAsDataUrl(path: string): string {
    const content = this.bundle[path];
    if (!content) {
      throw new Error(`No such file ${path}`);
    }
    return content;
  }

  readTextFileSync(
    path: string,
  ): string {
    return new TextDecoder().decode(this.readFileSync(path));
  }

  getMimeType(
    path: string,
  ): string {
    const content = this.bundle[path];
    if (!content) {
      throw new Error(`No such file ${path}`);
    }
    return content.split(";")[0].split(":")[1];
  }

  writeFileSync(path: string, data: Uint8Array) {
    // Replace \ with / for windows
    path = path.replaceAll("\\", "/");
    const mimeType = mime.getType(path) || "application/octet-stream";
    this.bundle[path] = base64EncodedDataUrl(mimeType, data);
  }

  writeTextFileSync(path: string, s: string) {
    this.writeFileSync(path, new TextEncoder().encode(s));
  }

  toJSON(): AssetJson {
    return this.bundle;
  }
}
