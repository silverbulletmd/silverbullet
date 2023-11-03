/// <reference lib="deno.unstable" />

import { FileMeta } from "$sb/types.ts";
import type { SpacePrimitives } from "./space_primitives.ts";
import { mime } from "https://deno.land/x/mimetypes@v1.0.0/mod.ts";

export class DenoKVSpacePrimitives implements SpacePrimitives {
  private kv!: Deno.Kv;
  private dataAttribute = "file";
  private metaAttribute = "meta";

  async init(path?: string) {
    this.kv = await Deno.openKv(path);
  }

  close() {
    this.kv.close();
  }

  async fetchFileList(): Promise<FileMeta[]> {
    const results: FileMeta[] = [];
    for await (
      const result of this.kv.list({
        prefix: [this.metaAttribute],
      })
    ) {
      results.push(result.value as FileMeta);
    }
    return results;
  }
  async readFile(name: string): Promise<{ data: Uint8Array; meta: FileMeta }> {
    const [meta, data] = await this.kv.getMany([[this.metaAttribute, name], [
      this.dataAttribute,
      name,
    ]]);
    if (!meta.value) {
      throw new Error("Not found");
    }
    return {
      data: data.value as Uint8Array,
      meta: meta.value as FileMeta,
    };
  }
  async getFileMeta(name: string): Promise<FileMeta> {
    const result = await this.kv.get([this.metaAttribute, name]);
    if (result.value) {
      return result.value as FileMeta;
    } else {
      throw new Error("Not found");
    }
  }
  async writeFile(
    name: string,
    data: Uint8Array,
    _selfUpdate?: boolean | undefined,
    suggestedMeta?: FileMeta | undefined,
  ): Promise<FileMeta> {
    const meta: FileMeta = {
      name,
      created: suggestedMeta?.created || Date.now(),
      lastModified: suggestedMeta?.lastModified || Date.now(),
      contentType: mime.getType(name) || "application/octet-stream",
      size: data.byteLength,
      perm: suggestedMeta?.perm || "rw",
    };
    const res = await this.kv.atomic()
      .set([this.dataAttribute, name], data)
      .set([this.metaAttribute, name], meta)
      .commit();
    if (!res.ok) {
      throw res;
    }
    return meta;
  }
  async deleteFile(name: string): Promise<void> {
    const res = await this.kv.atomic()
      .delete([this.dataAttribute, name])
      .delete([this.metaAttribute, name])
      .commit();
    if (!res.ok) {
      throw res;
    }
  }
}
