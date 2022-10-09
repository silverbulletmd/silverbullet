import { Plug } from "../../plugos/plug.ts";
import { AssetBundle, assetReadFileSync } from "../asset_bundle.ts";
import { FileMeta } from "../types.ts";
import { FileData, FileEncoding, SpacePrimitives } from "./space_primitives.ts";

export class AssetBundlePlugSpacePrimitives implements SpacePrimitives {
  constructor(
    private wrapped: SpacePrimitives,
    private assetBundle: AssetBundle,
  ) {
  }

  async fetchFileList(): Promise<FileMeta[]> {
    const l = await this.wrapped.fetchFileList();
    return Object.entries(this.assetBundle).filter(([k, v]) =>
      k.startsWith("_plug/")
    ).map(([_, v]) => v.meta).concat(l);
  }

  readFile(
    name: string,
    encoding: FileEncoding,
  ): Promise<{ data: FileData; meta: FileMeta }> {
    if (this.assetBundle[name]) {
      const data = assetReadFileSync(this.assetBundle, name);
      // console.log("Requested encoding", encoding);
      return Promise.resolve({
        data: encoding === "string" ? new TextDecoder().decode(data) : data,
        meta: {
          lastModified: 0,
          size: data.byteLength,
          perm: "ro",
          contentType: "application/json",
        } as FileMeta,
      });
    }
    return this.wrapped.readFile(name, encoding);
  }

  getFileMeta(name: string): Promise<FileMeta> {
    if (this.assetBundle[name]) {
      const data = assetReadFileSync(this.assetBundle, name);
      return Promise.resolve({
        lastModified: 0,
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
    selfUpdate?: boolean | undefined,
  ): Promise<FileMeta> {
    return this.wrapped.writeFile(name, encoding, data, selfUpdate);
  }

  deleteFile(name: string): Promise<void> {
    if (this.assetBundle[name]) {
      // Quietly ignore
      return Promise.resolve();
    }
    return this.wrapped.deleteFile(name);
  }

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
