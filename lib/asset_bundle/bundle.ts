import { base64Decode, base64EncodedDataUrl } from "../crypto.ts";

type DataUrl = string;

// Mapping from path -> `data:mimetype;base64,base64-encoded-data` strings
export type AssetJson = Record<string, { data: DataUrl; mtime: number }>;

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
    const data = content.data.split(",", 2)[1];
    return base64Decode(data);
  }

  readFileAsDataUrl(path: string): string {
    const content = this.bundle[path];
    if (!content) {
      throw new Error(`No such file ${path}`);
    }
    return content.data;
  }

  readTextFileSync(
    path: string,
  ): string {
    return new TextDecoder().decode(this.readFileSync(path));
  }

  getMimeType(
    path: string,
  ): string {
    const entry = this.bundle[path];
    if (!entry) {
      throw new Error(`No such file ${path}`);
    }
    return entry.data.split(";")[0].split(":")[1];
  }

  getMtime(path: string): number {
    const entry = this.bundle[path];
    if (!entry) {
      throw new Error(`No such file ${path}`);
    }
    return entry.mtime;
  }

  writeFileSync(
    path: string,
    mimeType: string,
    data: Uint8Array,
    mtime: number = Date.now(),
  ) {
    // Replace \ with / for windows
    path = path.replaceAll("\\", "/");
    this.bundle[path] = {
      data: base64EncodedDataUrl(mimeType, data),
      mtime,
    };
  }

  writeTextFileSync(
    path: string,
    mimeType: string,
    s: string,
    mtime: number = Date.now(),
  ) {
    this.writeFileSync(path, mimeType, new TextEncoder().encode(s), mtime);
  }

  toJSON(): AssetJson {
    return this.bundle;
  }
}
