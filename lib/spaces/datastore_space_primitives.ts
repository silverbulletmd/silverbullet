import type { SpacePrimitives } from "./space_primitives.ts";
import { mime } from "mimetypes";
import type { FileMeta } from "../../type/index.ts";
import { notFoundError } from "../constants.ts";
import { KvPrimitives } from "../data/kv_primitives.ts";

const filesMetaPrefix = ["m"];
const filesContentPrefix = ["c"];

export class DataStoreSpacePrimitives implements SpacePrimitives {
  constructor(
    private kv: KvPrimitives,
  ) {
  }

  async fetchFileList(): Promise<FileMeta[]> {
    const fileMetas: FileMeta[] = [];
    // Iterate over all keys with the fileMetaPrefix
    for await (const meta of this.kv.query({ prefix: filesMetaPrefix })) {
      fileMetas.push(this.ensureFileMeta(meta.value as FileMeta));
    }
    return fileMetas;
  }

  async readFile(
    name: string,
  ): Promise<{ data: Uint8Array; meta: FileMeta }> {
    // Fetch content and metadata in parallel
    const [fileMeta, fileContent] = await this.kv.batchGet([
      [
        ...filesMetaPrefix,
        name,
      ],
      [
        ...filesContentPrefix,
        name,
      ],
    ]);
    if (!fileMeta) {
      throw notFoundError;
    }

    return {
      meta: this.ensureFileMeta(fileMeta),
      data: fileContent,
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

    // Write metadata and content in same transaction
    await this.kv.batchSet([
      {
        key: [...filesMetaPrefix, name],
        value: meta,
      },
      {
        key: [...filesContentPrefix, name],
        value: data,
      },
    ]);
    return meta;
  }

  async deleteFile(name: string): Promise<void> {
    const [fileMeta] = await this.kv.batchGet([
      [...filesMetaPrefix, name],
    ]);
    if (!fileMeta) {
      throw notFoundError;
    }
    return this.kv.batchDelete([
      [...filesMetaPrefix, name],
      [...filesContentPrefix, name],
    ]);
  }

  async getFileMeta(name: string): Promise<FileMeta> {
    const [fileMeta] = await this.kv.batchGet([[...filesMetaPrefix, name]]);
    if (!fileMeta) {
      throw notFoundError;
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
