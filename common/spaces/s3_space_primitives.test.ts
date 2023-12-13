import { S3SpacePrimitives } from "./s3_space_primitives.ts";
import { MemoryKvPrimitives } from "../../plugos/lib/memory_kv_primitives.ts";
import { testSpacePrimitives } from "./space_primitives.test.ts";

Deno.test("s3_space_primitives", async () => {
  return;
  const options = {
    accessKey: Deno.env.get("AWS_ACCESS_KEY_ID")!,
    secretKey: Deno.env.get("AWS_SECRET_ACCESS_KEY")!,
    endPoint: Deno.env.get("AWS_ENDPOINT")!,
    region: Deno.env.get("AWS_REGION")!,
    bucket: Deno.env.get("AWS_BUCKET")!,
  };

  const primitives = new S3SpacePrimitives(
    new MemoryKvPrimitives(),
    ["meta"],
    "test",
    options,
  );
  await testSpacePrimitives(primitives);
});
