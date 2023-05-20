import { path } from "../server/deps.ts";
import { HttpServer } from "../server/http_server.ts";
import clientAssetBundle from "../dist/client_asset_bundle.json" assert {
  type: "json",
};
import plugAssetBundle from "../dist/plug_asset_bundle.json" assert {
  type: "json",
};
import { AssetBundle, AssetJson } from "../plugos/asset_bundle/bundle.ts";
import { AssetBundlePlugSpacePrimitives } from "../common/spaces/asset_bundle_space_primitives.ts";
import { DiskSpacePrimitives } from "../common/spaces/disk_space_primitives.ts";
import { SpacePrimitives } from "../common/spaces/space_primitives.ts";
import { S3SpacePrimitives } from "../server/spaces/s3_space_primitives.ts";

export function serveCommand(options: any, folder: string) {
  const hostname = options.hostname || "127.0.0.1";
  const port = options.port || 3000;
  const maxFileSizeMB = options.maxFileSizeMB || 10;

  console.log(
    "Going to start SilverBullet binding to",
    `${hostname}:${port}`,
  );
  if (hostname === "127.0.0.1") {
    console.log(
      `_Note:_ SilverBullet will only be available locally (via http://localhost:${port}), to allow outside connections, pass --hostname 0.0.0.0 as a flag.`,
    );
  }
  let spacePrimitives: SpacePrimitives | undefined;
  let pagesPath: string | undefined;
  if (folder === "s3://") {
    spacePrimitives = new AssetBundlePlugSpacePrimitives(
      new S3SpacePrimitives({
        accessKey: Deno.env.get("AWS_ACCESS_KEY_ID")!,
        secretKey: Deno.env.get("AWS_SECRET_ACCESS_KEY")!,
        endPoint: Deno.env.get("AWS_ENDPOINT")!,
        region: Deno.env.get("AWS_REGION")!,
        bucket: Deno.env.get("AWS_BUCKET")!,
      }),
      new AssetBundle(plugAssetBundle as AssetJson),
    );
    pagesPath = ".";
  } else {
    pagesPath = path.resolve(Deno.cwd(), folder);
    spacePrimitives = new AssetBundlePlugSpacePrimitives(
      new DiskSpacePrimitives(pagesPath, {
        maxFileSizeMB: options.maxFileSizeMB,
      }),
      new AssetBundle(plugAssetBundle as AssetJson),
    );
  }
  console.log("Serving pages from", pagesPath);

  const httpServer = new HttpServer(spacePrimitives, {
    hostname,
    port: port,
    pagesPath: pagesPath,
    clientAssetBundle: new AssetBundle(clientAssetBundle as AssetJson),
    user: options.user,
    keyFile: options.key,
    certFile: options.cert,
    maxFileSizeMB: +maxFileSizeMB,
  });
  httpServer.start().catch(console.error);
}
