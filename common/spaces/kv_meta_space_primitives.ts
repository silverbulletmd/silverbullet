import { FileMeta } from "../../plug-api/types.ts";
import { mime } from "mimetypes";
import { KvPrimitives } from "$lib/data/kv_primitives.ts";
import { SpacePrimitives } from "./space_primitives.ts";

export type KvMetaSpacePrimitivesCallbacks = {
  readFile: (
    name: string,
    spacePrimitives: SpacePrimitives,
  ) => Promise<Uint8Array>;
  writeFile: (
    name: string,
    data: Uint8Array,
    spacePrimitives: SpacePrimitives,
  ) => Promise<void>;
  deleteFile: (name: string, spacePrimitives: SpacePrimitives) => Promise<void>;
};

export class KvMetaSpacePrimitives implements SpacePrimitives {
  constructor(
    protected kv: KvPrimitives,
    private callbacks: KvMetaSpacePrimitivesCallbacks,
  ) {
  }

  async readFile(
    name: string,
  ): Promise<{ data: Uint8Array; meta: FileMeta }> {
    const [data, [meta]] = await Promise.all([
      this.callbacks.readFile(name, this),
      this.kv.batchGet([[name]]),
    ]);
    return { data, meta: meta };
  }

  async writeFile(
    name: string,
    data: Uint8Array,
    _selfUpdate?: boolean | undefined,
    desiredMeta?: FileMeta | undefined,
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
        perm: "rw",
        created: Date.now(),
        contentType: mime.getType(name) || "application/octet-stream",
        // These will be overwritten in a bit
        lastModified: 0,
        size: 0,
      };
    }
    meta = {
      ...meta,
      lastModified: desiredMeta?.lastModified || Date.now(),
      size: data.byteLength,
    };
    await Promise.all([
      this.callbacks.writeFile(name, data, this),
      this.kv.batchSet([{ key: [name], value: meta }]),
    ]);

    return meta;
  }

  async deleteFile(name: string): Promise<void> {
    await Promise.all([
      this.callbacks.deleteFile(name, this),
      this.kv.batchDelete([[name]]),
    ]);
  }

  async fetchFileList(): Promise<FileMeta[]> {
    const files: FileMeta[] = [];
    for await (const meta of this.kv.query({})) {
      files.push(meta.value);
    }
    return files;
  }

  async getFileMeta(name: string): Promise<FileMeta> {
    const fileMeta = (await this.kv.batchGet([[name]]))[0];
    if (!fileMeta) {
      throw new Error("Not found");
    }
    return fileMeta;
  }
}
