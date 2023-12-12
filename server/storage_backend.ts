import { DiskSpacePrimitives } from "../common/spaces/disk_space_primitives.ts";
import { SpacePrimitives } from "../common/spaces/space_primitives.ts";
import { path } from "./deps.ts";
import { S3SpacePrimitives } from "../common/spaces/s3_space_primitives.ts";
import { KvPrimitives } from "../plugos/lib/kv_primitives.ts";

export function determineStorageBackend(
  kvPrimitives: KvPrimitives,
  folder: string,
): SpacePrimitives {
  if (folder.startsWith("s3://")) {
    console.info("Using S3 as a storage backend");
    let objectPrefix = folder.slice("s3://".length);
    if (objectPrefix !== "") {
      // Add a suffix /
      objectPrefix += "/";
    }
    return new S3SpacePrimitives(
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
  } else {
    folder = path.resolve(Deno.cwd(), folder);
    console.info(`Using local disk as a storage backend: ${folder}`);
    return new DiskSpacePrimitives(folder);
  }
}
