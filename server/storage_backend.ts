import { DiskSpacePrimitives } from "../lib/spaces/disk_space_primitives.ts";
import type { SpacePrimitives } from "../lib/spaces/space_primitives.ts";
import { resolve } from "@std/path";
import { HttpSpacePrimitives } from "../lib/spaces/http_space_primitives.ts";
import { GCSSpacePrimitives } from "../lib/spaces/gcs_space_primitives.ts";

export function determineStorageBackend(
  folder: string,
): SpacePrimitives {
  // HTTP(S) remote space
  if (folder.startsWith("http://") || folder.startsWith("https://")) {
    return new HttpSpacePrimitives(
      folder,
      undefined,
      Deno.env.get("SB_AUTH_TOKEN"),
    );
  } else if (Deno.env.get("SB_GCS_BUCKET")) {
    // GCS space when SB_GCS_BUCKET is provided
    const bucket = Deno.env.get("SB_GCS_BUCKET")!;
    const prefix = Deno.env.get("SB_GCS_PREFIX");
    console.info(
      `Using Google Cloud Storage as a storage backend: bucket=${bucket}${
        prefix ? `, prefix=${prefix}` : ""
      }`,
    );
    return new GCSSpacePrimitives(bucket, prefix);
  } else {
    // Local disk fallback
    folder = resolve(Deno.cwd(), folder);
    console.info(`Using local disk as a storage backend: ${folder}`);
    return new DiskSpacePrimitives(folder);
  }
}
