import { Plug } from "../../plugos/plug.ts";
import { FileMeta } from "../types.ts";
import { FileData, FileEncoding, SpacePrimitives } from "./space_primitives.ts";
import { AssetBundle } from "../../plugos/asset_bundle/bundle.ts";

const bootTime = Date.now();
export class AssetBundlePlugSpacePrimitives implements SpacePrimitives {
  constructor(
    private wrapped: SpacePrimitives,
    private assetBundle: AssetBundle,
  ) {
  }

  async fetchFileList(): Promise<{ files: FileMeta[]; timestamp: number }> {
    const { files, timestamp } = await this.wrapped.fetchFileList();
    return {
      files: this.assetBundle.listFiles().filter((p) => p.startsWith("_plug/"))
        .map((p) => ({
          name: p,
          contentType: "application/json",
          lastModified: bootTime,
          perm: "ro",
          size: -1,
        } as FileMeta)).concat(files),
      timestamp,
    };
  }

  readFile(
    name: string,
    encoding: FileEncoding,
  ): Promise<{ data: FileData; meta: FileMeta }> {
    if (this.assetBundle.has(name)) {
      const data = this.assetBundle.readFileSync(name);
      // console.log("Requested encoding", encoding);
      return Promise.resolve({
        data: encoding === "string" ? new TextDecoder().decode(data) : data,
        meta: {
          lastModified: bootTime,
          size: data.byteLength,
          perm: "ro",
          contentType: "application/json",
        } as FileMeta,
      });
    }
    return this.wrapped.readFile(name, encoding);
  }

  getFileMeta(name: string): Promise<FileMeta> {
    if (this.assetBundle.has(name)) {
      const data = this.assetBundle.readFileSync(name);
      return Promise.resolve({
        lastModified: bootTime,
        size: data.byteLength,
        perm: "ro",
        contentType: "application/json",
      } as FileMeta);
    }
    return this.wrapped.getFileMeta(name);
  }

  writeFile(
    name: string,
    encoding: FileEncoding,
    data: FileData,
    selfUpdate?: boolean,
    timestamp?: number,
  ): Promise<FileMeta> {
    return this.wrapped.writeFile(name, encoding, data, selfUpdate, timestamp);
  }

  deleteFile(name: string): Promise<void> {
    if (this.assetBundle.has(name)) {
      // Quietly ignore
      return Promise.resolve();
    }
    return this.wrapped.deleteFile(name);
  }

  // deno-lint-ignore no-explicit-any
  proxySyscall(plug: Plug<any>, name: string, args: any[]): Promise<any> {
    return this.wrapped.proxySyscall(plug, name, args);
  }

  invokeFunction(
    plug: Plug<any>,
    env: string,
    name: string,
    args: any[],
  ): Promise<any> {
    return this.wrapped.invokeFunction(plug, env, name, args);
  }
}
