import { DiskSpacePrimitives } from "$common/spaces/disk_space_primitives.ts";
import { SpacePrimitives } from "$common/spaces/space_primitives.ts";
import { resolve } from "$std/path/mod.ts";
import { S3SpacePrimitives } from "$common/spaces/s3_space_primitives.ts";
import { KvPrimitives } from "$lib/data/kv_primitives.ts";
import { ChunkedKvStoreSpacePrimitives } from "$common/spaces/chunked_datastore_space_primitives.ts";
import { HttpSpacePrimitives } from "$common/spaces/http_space_primitives.ts";

export async function determineStorageBackend(
  kvPrimitives: KvPrimitives,
  folder: string,
): Promise<SpacePrimitives> {
  if (folder.startsWith("s3://")) {
    console.info("Using S3 as a storage backend");
    let objectPrefix = folder.slice("s3://".length);
    if (objectPrefix !== "") {
      // Add a suffix /
      objectPrefix += "/";
    }
    const spacePrimitives = new S3SpacePrimitives(
      kvPrimitives,
      ["meta"],
      objectPrefix,
      {
        accessKey: Deno.env.get("AWS_ACCESS_KEY_ID")!,
        secretKey: Deno.env.get("AWS_SECRET_ACCESS_KEY")!,
        endPoint: Deno.env.get("AWS_ENDPOINT")!,
        region: Deno.env.get("AWS_REGION")!,
        bucket: Deno.env.get("AWS_BUCKET")!,
      },
    );
    if (Deno.env.get("SB_S3_PERFORM_SYNC") === "true") {
      console.log("Performing S3 file list sync");
      await spacePrimitives.syncFileList();
      console.info("S3 file list sync complete");
    }
    return spacePrimitives;
  } else if (folder === "db://") {
    console.info(`Using the database as a storage backend`);
    return new ChunkedKvStoreSpacePrimitives(
      kvPrimitives,
      65536, // For DenoKV, this is the maximum size of a single value
    );
  } else if (folder.startsWith("http://") || folder.startsWith("https://")) {
    return new HttpSpacePrimitives(
      folder,
      undefined,
      Deno.env.get("SB_AUTH_TOKEN"),
    );
  } else {
    folder = resolve(Deno.cwd(), folder);
    console.info(`Using local disk as a storage backend: ${folder}`);
    return new DiskSpacePrimitives(folder);
  }
}
