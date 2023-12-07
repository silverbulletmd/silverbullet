import { DiskSpacePrimitives } from "../common/spaces/disk_space_primitives.ts";
import { SpacePrimitives } from "../common/spaces/space_primitives.ts";
import { path } from "./deps.ts";
import { S3SpacePrimitives } from "./spaces/s3_space_primitives.ts";

export function determineStorageBackend(folder: string): SpacePrimitives {
  if (folder === "s3://") {
    console.log("Running in S3 mode");
    return new S3SpacePrimitives({
      accessKey: Deno.env.get("AWS_ACCESS_KEY_ID")!,
      secretKey: Deno.env.get("AWS_SECRET_ACCESS_KEY")!,
      endPoint: Deno.env.get("AWS_ENDPOINT")!,
      region: Deno.env.get("AWS_REGION")!,
      bucket: Deno.env.get("AWS_BUCKET")!,
    });
  }
  folder = path.resolve(Deno.cwd(), folder);
  return new DiskSpacePrimitives(folder);
}
