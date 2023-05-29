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

export function serveCommand(
  options: any,
  folder?: string,
) {
  const hostname = options.hostname || "127.0.0.1";
  const port = options.port ||
    (Deno.env.get("SB_PORT") && +Deno.env.get("SB_PORT")!) || 3000;
  const maxFileSizeMB = options.maxFileSizeMB || 20;

  if (!folder) {
    folder = Deno.env.get("SB_FOLDER");
    if (!folder) {
      console.error(
        "No folder specified. Please pass a folder as an argument or set SB_FOLDER environment variable.",
      );
      Deno.exit(1);
    }
  }

  console.log(
    "Going to start SilverBullet binding to",
    `${hostname}:${port}`,
  );
  if (hostname === "127.0.0.1") {
    console.log(
      `NOTE: SilverBullet will only be available locally (via http://localhost:${port}).
To allow outside connections, pass -L 0.0.0.0 as a flag, and put a TLS terminator on top.`,
    );
  }
  let spacePrimitives: SpacePrimitives | undefined;
  if (folder === "s3://") {
    spacePrimitives = new S3SpacePrimitives({
      accessKey: Deno.env.get("AWS_ACCESS_KEY_ID")!,
      secretKey: Deno.env.get("AWS_SECRET_ACCESS_KEY")!,
      endPoint: Deno.env.get("AWS_ENDPOINT")!,
      region: Deno.env.get("AWS_REGION")!,
      bucket: Deno.env.get("AWS_BUCKET")!,
    });
    console.log("Running in S3 mode");
  } else {
    // Regular disk mode
    folder = path.resolve(Deno.cwd(), folder);
    spacePrimitives = new DiskSpacePrimitives(folder);
  }
  spacePrimitives = new AssetBundlePlugSpacePrimitives(
    spacePrimitives,
    new AssetBundle(plugAssetBundle as AssetJson),
  );

  const httpServer = new HttpServer(spacePrimitives!, {
    hostname,
    port: port,
    pagesPath: folder!,
    clientAssetBundle: new AssetBundle(clientAssetBundle as AssetJson),
    user: options.user ?? Deno.env.get("SB_USER"),
    keyFile: options.key,
    certFile: options.cert,
    maxFileSizeMB: +maxFileSizeMB,
  });
  return httpServer.start();
}
