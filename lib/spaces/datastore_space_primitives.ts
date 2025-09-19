import type { SpacePrimitives } from "./space_primitives.ts";
import { mime } from "mimetypes";
import type { FileMeta } from "../../plug-api/types/index.ts";
import { notFoundError } from "../constants.ts";
import type { KvPrimitives } from "../data/kv_primitives.ts";

const filesMetaPrefix = ["meta"];
const filesContentPrefix = ["content"];

export class DataStoreSpacePrimitives implements SpacePrimitives {
  constructor(
    private kv: KvPrimitives,
  ) {
  }

  async fetchFileList(): Promise<FileMeta[]> {
    const fileMetas: FileMeta[] = [];
    // Iterate over all keys with the fileMetaPrefix
    for await (const meta of this.kv.query({ prefix: filesMetaPrefix })) {
      fileMetas.push(this.cleanFileMeta(meta.value as FileMeta));
    }
    return fileMetas;
  }

  async readFile(
    path: string,
  ): Promise<{ data: Uint8Array; meta: FileMeta }> {
    // Fetch content and metadata in parallel
    const [fileMeta, fileContent] = await this.kv.batchGet([
      [
        ...filesMetaPrefix,
        path,
      ],
      [
        ...filesContentPrefix,
        path,
      ],
    ]);
    if (!fileMeta) {
      throw notFoundError;
    }

    return {
      meta: this.cleanFileMeta(fileMeta),
      data: fileContent,
    };
  }

  async writeFile(
    path: string,
    data: Uint8Array,
    suggestedMeta?: FileMeta,
  ): Promise<FileMeta> {
    let meta: FileMeta | undefined;
    try {
      // Build off of the existing file meta, if file exists
      meta = await this.getFileMeta(path);
    } catch {
      // Not found, that's fine
    }
    if (!meta) {
      // No existing meta data, let's set some defaults
      meta = {
        name: path,
        created: suggestedMeta?.lastModified || Date.now(),
        perm: "rw",
        contentType: mime.getType(path) || "application/octet-stream",
        // Overwritten in a sec
        lastModified: 0,
        size: 0,
      };
    }
    meta.lastModified = suggestedMeta?.lastModified || Date.now();
    meta.size = data.byteLength;
    if (suggestedMeta?.perm) {
      meta.perm = suggestedMeta.perm;
    }

    // Write metadata and content in same transaction
    await this.kv.batchSet([
      {
        key: [...filesMetaPrefix, path],
        value: meta,
      },
      {
        key: [...filesContentPrefix, path],
        value: data,
      },
    ]);
    return meta;
  }

  async deleteFile(path: string): Promise<void> {
    const [fileMeta] = await this.kv.batchGet([
      [...filesMetaPrefix, path],
    ]);
    if (!fileMeta) {
      throw notFoundError;
    }
    return this.kv.batchDelete([
      [...filesMetaPrefix, path],
      [...filesContentPrefix, path],
    ]);
  }

  async getFileMeta(path: string, _observing?: boolean): Promise<FileMeta> {
    const [fileMeta] = await this.kv.batchGet([[...filesMetaPrefix, path]]);
    if (!fileMeta) {
      throw notFoundError;
    }
    return this.cleanFileMeta(fileMeta);
  }

  cleanFileMeta(fileMeta: FileMeta): FileMeta {
    if (!fileMeta.created) {
      fileMeta.created = fileMeta.lastModified;
    }
    return fileMeta;
  }
}
