import { S3SpacePrimitives } from "./s3_space_primitives.ts";
import { assert, assertEquals } from "../../test_deps.ts";

Deno.test("s3_space_primitives", async () => {
  return;
  const options = {
    accessKey: Deno.env.get("AWS_ACCESS_KEY_ID")!,
    secretKey: Deno.env.get("AWS_SECRET_ACCESS_KEY")!,
    endPoint: "s3.eu-central-1.amazonaws.com",
    region: "eu-central-1",
    bucket: "zef-sb-space",
  };

  const primitives = new S3SpacePrimitives(options);
  console.log(await primitives.fetchFileList());
  console.log(
    await primitives.writeFile("test+'s.txt", stringToBytes("Hello world!")),
  );
  assertEquals(
    stringToBytes("Hello world!"),
    (await primitives.readFile("test+'s.txt")).data,
  );
  await primitives.deleteFile("test+'s.txt");

  try {
    await primitives.getFileMeta("test+'s.txt");
    assert(false);
  } catch (e: any) {
    assertEquals(e.message, "Not found");
  }

  //   console.log(await primitives.readFile("SETTINGS.md", "utf8"));
});

function stringToBytes(str: string): Uint8Array {
  return new TextEncoder().encode(str);
}
