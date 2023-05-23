import { FileMeta } from "../types.ts";
import { SpacePrimitives } from "./space_primitives.ts";
import { AssetBundle } from "../../plugos/asset_bundle/bundle.ts";
import { mime } from "../deps.ts";

const bootTime = Date.now();
export class AssetBundlePlugSpacePrimitives implements SpacePrimitives {
  constructor(
    private wrapped: SpacePrimitives,
    private assetBundle: AssetBundle,
  ) {
  }

  async fetchFileList(): Promise<FileMeta[]> {
    const files = await this.wrapped.fetchFileList();
    return this.assetBundle.listFiles()
      .map((p) => ({
        name: p,
        contentType: mime.getType(p) || "application/octet-stream",
        lastModified: bootTime,
        perm: "ro",
        size: -1,
      } as FileMeta)).concat(files);
  }

  readFile(
    name: string,
  ): Promise<{ data: Uint8Array; meta: FileMeta }> {
    if (this.assetBundle.has(name)) {
      const data = this.assetBundle.readFileSync(name);
      // console.log("Requested encoding", encoding);
      return Promise.resolve({
        data,
        meta: {
          lastModified: bootTime,
          size: data.byteLength,
          perm: "ro",
          contentType: this.assetBundle.getMimeType(name),
        } as FileMeta,
      });
    }
    return this.wrapped.readFile(name);
  }

  getFileMeta(name: string): Promise<FileMeta> {
    if (this.assetBundle.has(name)) {
      const data = this.assetBundle.readFileSync(name);
      return Promise.resolve({
        lastModified: bootTime,
        size: data.byteLength,
        perm: "ro",
        contentType: this.assetBundle.getMimeType(name),
      } as FileMeta);
    }
    return this.wrapped.getFileMeta(name);
  }

  writeFile(
    name: string,
    data: Uint8Array,
    selfUpdate?: boolean,
    lastModified?: number,
  ): Promise<FileMeta> {
    if (this.assetBundle.has(name)) {
      console.warn("Attempted to write to read-only asset file", name);
      return this.getFileMeta(name);
    }
    return this.wrapped.writeFile(
      name,
      data,
      selfUpdate,
      lastModified,
    );
  }

  deleteFile(name: string): Promise<void> {
    if (this.assetBundle.has(name)) {
      // Quietly ignore
      return Promise.resolve();
    }
    return this.wrapped.deleteFile(name);
  }
}
