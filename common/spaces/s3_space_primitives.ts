// We're explicitly using 0.4.0 to be able to hijack the path encoding, which is inconsisently broken in 0.5.0
import { S3Client } from "https://deno.land/x/s3_lite_client@0.4.0/mod.ts";
import type { ClientOptions } from "https://deno.land/x/s3_lite_client@0.4.0/client.ts";
import { KvMetaSpacePrimitives } from "./kv_meta_space_primitives.ts";
import { KvPrimitives } from "../../plugos/lib/kv_primitives.ts";

export type S3SpacePrimitivesOptions = ClientOptions & { prefix: string };

/**
 * Because S3 cannot store arbitrary metadata (well it can, but you cannot retrieve it when listing objects), we need to store it in a separate KV store
 */
export class S3SpacePrimitives extends KvMetaSpacePrimitives {
  constructor(kv: KvPrimitives, options: S3SpacePrimitivesOptions) {
    const client = new S3Client(options);
    const prefix = options.prefix;
    super(kv, {
      async readFile(
        name: string,
      ): Promise<Uint8Array> {
        try {
          const obj = await client.getObject(encodePath(prefix + name));
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
        await client.putObject(encodePath(prefix + name), data);
      },
      async deleteFile(name: string): Promise<void> {
        await client.deleteObject(encodePath(prefix + name));
      },
    });
  }
}

// Stolen from https://github.com/aws/aws-sdk-js/blob/master/lib/util.js

export function uriEscapePath(string: string): string {
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
