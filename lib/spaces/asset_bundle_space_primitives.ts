import type { SpacePrimitives } from "./space_primitives.ts";
import type { AssetBundle } from "../../lib/asset_bundle/bundle.ts";

import type { FileMeta } from "../../type/index.ts";

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
        contentType: this.assetBundle.getMimeType(p),
        created: this.assetBundle.getMtime(p),
        lastModified: this.assetBundle.getMtime(p),
        perm: "ro",
        size: -1,
      } as FileMeta)).concat(files);
  }

  readFile(
    path: string,
  ): Promise<{ data: Uint8Array; meta: FileMeta }> {
    if (this.assetBundle.has(path)) {
      const data = this.assetBundle.readFileSync(path);
      // console.log("Requested encoding", encoding);
      return Promise.resolve({
        data,
        meta: {
          contentType: this.assetBundle.getMimeType(path),
          created: this.assetBundle.getMtime(path),
          lastModified: this.assetBundle.getMtime(path),
          size: data.byteLength,
          perm: "ro",
        } as FileMeta,
      });
    }
    return this.wrapped.readFile(path);
  }

  getFileMeta(path: string, observing?: boolean): Promise<FileMeta> {
    if (this.assetBundle.has(path)) {
      const data = this.assetBundle.readFileSync(path);
      return Promise.resolve({
        contentType: this.assetBundle.getMimeType(path),
        created: this.assetBundle.getMtime(path),
        lastModified: this.assetBundle.getMtime(path),
        size: data.byteLength,
        perm: "ro",
      } as FileMeta);
    }
    return this.wrapped.getFileMeta(path, observing);
  }

  writeFile(
    path: string,
    data: Uint8Array,
    meta?: FileMeta,
  ): Promise<FileMeta> {
    if (this.assetBundle.has(path)) {
      console.warn("Attempted to write to read-only asset file", path);
      return this.getFileMeta(path);
    }
    return this.wrapped.writeFile(
      path,
      data,
      meta,
    );
  }

  deleteFile(path: string): Promise<void> {
    if (this.assetBundle.has(path)) {
      // Quietly ignore
      return Promise.resolve();
    }
    return this.wrapped.deleteFile(path);
  }
}
