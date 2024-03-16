// We're explicitly using 0.4.0 to be able to hijack the path encoding, which is inconsisently broken in 0.5.0
import { S3Client } from "s3_lite_client/mod.ts";
import type { ClientOptions } from "s3_lite_client/client.ts";
import { KvMetaSpacePrimitives } from "./kv_meta_space_primitives.ts";
import { KvPrimitives } from "$lib/data/kv_primitives.ts";
import { mime } from "mimetypes";
import { KV, KvKey } from "../../plug-api/types.ts";
import { PrefixedKvPrimitives } from "$lib/data/prefixed_kv_primitives.ts";

export type S3SpacePrimitivesOptions = ClientOptions;

/**
 * Because S3 cannot store arbitrary metadata (well it can, but you cannot retrieve it when listing objects), we need to store it in a separate KV store
 */
export class S3SpacePrimitives extends KvMetaSpacePrimitives {
  client: S3Client;
  objectPrefix: string;
  constructor(
    baseKv: KvPrimitives,
    metaPrefix: KvKey,
    objectPrefix: string,
    options: S3SpacePrimitivesOptions,
  ) {
    const client = new S3Client(options);
    super(new PrefixedKvPrimitives(baseKv, metaPrefix), {
      async readFile(
        name: string,
      ): Promise<Uint8Array> {
        try {
          const obj = await client.getObject(encodePath(objectPrefix + name));
          return new Uint8Array(await obj.arrayBuffer());
        } catch (e: any) {
          console.error("Got S3 error", e.message);

          if (e.message.includes("does not exist")) {
            throw new Error(`Not found`);
          }
          throw e;
        }
      },
      async writeFile(
        name: string,
        data: Uint8Array,
      ): Promise<void> {
        await client.putObject(encodePath(objectPrefix + name), data);
      },
      async deleteFile(name: string): Promise<void> {
        await client.deleteObject(encodePath(objectPrefix + name));
      },
    });
    this.client = client;
    this.objectPrefix = objectPrefix;
  }

  /**
   * Fetches all objects from S3 bucket, finds any missing files and adds them to the KV store
   * Doesn't delete items, nor update any existing items
   */
  async syncFileList(): Promise<void> {
    const currentFiles = await this.fetchFileList();
    const entriesToAdd: KV[] = [];
    for await (
      const objectData of this.client.listObjects({
        prefix: this.objectPrefix,
      })
    ) {
      // Find the file meta for this object
      let fileMeta = currentFiles.find((f) =>
        f.name === decodePath(objectData.key.slice(this.objectPrefix.length))
      );
      if (fileMeta) {
        // Exists, continue
        continue;
      }
      fileMeta = {
        name: decodePath(objectData.key.slice(this.objectPrefix.length)),
        created: objectData.lastModified.getTime(),
        lastModified: objectData.lastModified.getTime(),
        contentType: mime.getType(objectData.key) || "application/octet-stream",
        size: objectData.size,
        perm: "rw",
      };
      console.log("Adding file metadata to KV", fileMeta.name);
      entriesToAdd.push({
        key: [fileMeta.name],
        value: fileMeta,
      });
    }
    return this.kv.batchSet(entriesToAdd);
  }
}

// Stolen from https://github.com/aws/aws-sdk-js/blob/master/lib/util.js

function uriEscapePath(string: string): string {
  return string.split("/").map(uriEscape).join("/");
}

function uriEscape(string: string): string {
  let output = encodeURIComponent(string);
  output = output.replace(/[^A-Za-z0-9_.~\-%]+/g, escape);

  // AWS percent-encodes some extra non-standard characters in a URI
  output = output.replace(/[*]/g, function (ch) {
    return "%" + ch.charCodeAt(0).toString(16).toUpperCase();
  });

  return output;
}

function encodePath(name: string): string {
  return uriEscapePath(name);
}
function decodePath(encoded: string): string {
  // AWS only returns ' replace with &apos;
  return encoded.replaceAll("&apos;", "'");
}
