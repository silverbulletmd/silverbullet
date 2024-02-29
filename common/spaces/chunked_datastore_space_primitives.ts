import type { SpacePrimitives } from "./space_primitives.ts";
import { KvKey } from "../../plug-api/types.ts";
import { KvPrimitives } from "$lib/data/kv_primitives.ts";
import { KvMetaSpacePrimitives } from "./kv_meta_space_primitives.ts";
import { PrefixedKvPrimitives } from "$lib/data/prefixed_kv_primitives.ts";

/**
 * A space primitives implementation that stores files in chunks in a KV store.
 * This is useful for KV stores that have a size limit per value, such as DenoKV.
 * Meta data will be kept with a "meta" prefix and content will be kept with a "content" prefix
 * Example use with DenoKV:
 *  const denoKv = new DenoKvPrimitives(await Deno.openKv());
 *  const spacePrimitives = new ChunkedDataStoreSpacePrimitives(denoKv, 65536); // max 64kb per chunk
 */
export class ChunkedKvStoreSpacePrimitives extends KvMetaSpacePrimitives {
  /**
   * @param baseKv the underlying kv primitives (not prefixed with e.g. meta and content)
   * @param chunkSize
   * @param metaPrefix
   * @param contentPrefix
   */
  constructor(
    baseKv: KvPrimitives,
    chunkSize: number,
    metaPrefix = ["meta"],
    contentPrefix = ["content"],
  ) {
    // Super call with a metaPrefix for storing the file metadata
    super(new PrefixedKvPrimitives(baseKv, metaPrefix), {
      async readFile(name: string, spacePrimitives: SpacePrimitives) {
        const meta = await spacePrimitives.getFileMeta(name);

        // Buffer to store the concatenated chunks
        const concatenatedChunks = new Uint8Array(meta.size);
        let offset = 0;
        // Implicit assumption, chunks are ordered by chunk id by the underlying store
        for await (
          const { value } of baseKv.query({
            prefix: [...contentPrefix, name],
          })
        ) {
          concatenatedChunks.set(value, offset);
          offset += value.length;
        }

        return concatenatedChunks;
      },
      async writeFile(
        name: string,
        data: Uint8Array,
      ) {
        // Persist the data, chunk by chunk
        let chunkId = 0;
        for (let i = 0; i < data.byteLength; i += chunkSize) {
          const chunk = data.slice(i, i + chunkSize);
          await baseKv.batchSet([{
            // "3 digits ought to be enough for anybody" — famous last words
            key: [...contentPrefix, name, String(chunkId).padStart(3, "0")],
            value: chunk,
          }]);
          chunkId++;
        }
      },
      async deleteFile(name: string, spacePrimitives: SpacePrimitives) {
        const fileMeta = await spacePrimitives.getFileMeta(name);
        // Using this we can calculate the chunk keys
        const keysToDelete: KvKey[] = [];
        let chunkId = 0;
        for (let i = 0; i < fileMeta.size; i += chunkSize) {
          keysToDelete.push([
            ...contentPrefix,
            name,
            String(chunkId).padStart(3, "0"),
          ]);
          chunkId++;
        }
        return baseKv.batchDelete(keysToDelete);
      },
    });
  }
}
