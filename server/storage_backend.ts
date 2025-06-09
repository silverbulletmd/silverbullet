import { DiskSpacePrimitives } from "../lib/spaces/disk_space_primitives.ts";
import type { SpacePrimitives } from "../lib/spaces/space_primitives.ts";
import { resolve } from "@std/path";
import { HttpSpacePrimitives } from "../lib/spaces/http_space_primitives.ts";

export function determineStorageBackend(
  folder: string,
): SpacePrimitives {
  if (folder.startsWith("http://") || folder.startsWith("https://")) {
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
