import type { SpacePrimitives } from "./space_primitives.ts";
import { mime } from "mimetypes";
import { FileMeta } from "../../plug-api/types.ts";
import { DataStore } from "$lib/data/datastore.ts";

export type FileContent = {
  name: string;
  meta: FileMeta;
  data: Uint8Array;
};

const filesMetaPrefix = ["file", "meta"];
const filesContentPrefix = ["file", "content"];

/**
 * TODO: Replace this with ChunkedDatastoreSpacePrimitives
 */
export class DataStoreSpacePrimitives implements SpacePrimitives {
  constructor(
    private ds: DataStore,
  ) {
  }

  async fetchFileList(): Promise<FileMeta[]> {
    return (await this.ds.query<FileMeta>({ prefix: filesMetaPrefix }))
      .map((kv) => this.ensureFileMeta(kv.value));
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
      meta: this.ensureFileMeta(fileContent.meta),
    };
  }

  async writeFile(
    name: string,
    data: Uint8Array,
    _selfUpdate?: boolean,
    suggestedMeta?: FileMeta,
  ): Promise<FileMeta> {
    let meta: FileMeta | undefined;
    try {
      // Build off of the existing file meta, if file exists
      meta = await this.getFileMeta(name);
    } catch {
      // Not found, that's fine
    }
    if (!meta) {
      meta = {
        name,
        created: suggestedMeta?.lastModified || Date.now(),
        perm: suggestedMeta?.perm || "rw",
        contentType: mime.getType(name) || "application/octet-stream",
        // Overwritten in a sec
        lastModified: 0,
        size: 0,
      };
    }
    meta.lastModified = suggestedMeta?.lastModified || Date.now();
    meta.size = data.byteLength;

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
    return this.ensureFileMeta(fileMeta);
  }

  ensureFileMeta(fileMeta: FileMeta): FileMeta {
    if (!fileMeta.created) {
      fileMeta.created = fileMeta.lastModified;
    }
    return fileMeta;
  }
}
