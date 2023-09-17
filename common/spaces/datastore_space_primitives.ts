import type { SpacePrimitives } from "./space_primitives.ts";
import { mime } from "../deps.ts";
import { FileMeta } from "$sb/types.ts";
import { DataStore } from "../../plugos/lib/datastore.ts";

export type FileContent = {
  name: string;
  meta: FileMeta;
  data: Uint8Array;
};

const filesMetaPrefix = ["file", "meta"];
const filesContentPrefix = ["file", "content"];

export class DataStoreSpacePrimitives implements SpacePrimitives {
  constructor(
    private ds: DataStore,
  ) {
  }

  async fetchFileList(): Promise<FileMeta[]> {
    return (await this.ds.query<FileMeta>({ prefix: filesMetaPrefix }))
      .map((kv) => kv.value);
  }

  async readFile(
    name: string,
  ): Promise<{ data: Uint8Array; meta: FileMeta }> {
    const fileContent = await this.ds.get<FileContent>([
      ...filesContentPrefix,
      name,
    ]);
    if (!fileContent) {
      throw new Error("Not found");
    }

    return {
      data: fileContent.data,
      meta: fileContent.meta,
    };
  }

  async writeFile(
    name: string,
    data: Uint8Array,
    _selfUpdate?: boolean,
    suggestedMeta?: FileMeta,
  ): Promise<FileMeta> {
    const meta: FileMeta = {
      name,
      lastModified: suggestedMeta?.lastModified || Date.now(),
      contentType: mime.getType(name) || "application/octet-stream",
      size: data.byteLength,
      perm: suggestedMeta?.perm || "rw",
    };
    await this.ds.batchSet<FileMeta | FileContent>([
      {
        key: [...filesContentPrefix, name],
        value: { name, data, meta },
      },
      {
        key: [...filesMetaPrefix, name],
        value: meta,
      },
    ]);
    return meta;
  }

  async deleteFile(name: string): Promise<void> {
    const fileMeta = await this.ds.get<FileMeta>([
      ...filesMetaPrefix,
      name,
    ]);
    if (!fileMeta) {
      throw new Error("Not found");
    }
    return this.ds.batchDelete([
      [...filesMetaPrefix, name],
      [...filesContentPrefix, name],
    ]);
  }

  async getFileMeta(name: string): Promise<FileMeta> {
    const fileMeta = await this.ds.get([...filesMetaPrefix, name]);
    if (!fileMeta) {
      throw new Error("Not found");
    }
    return fileMeta;
  }
}
