import { path } from "../server/deps.ts";
import { HttpServer } from "../server/http_server.ts";
import clientAssetBundle from "../dist/client_asset_bundle.json" assert {
  type: "json",
};
import plugAssetBundle from "../dist/plug_asset_bundle.json" assert {
  type: "json",
};
import { AssetBundle, AssetJson } from "../plugos/asset_bundle/bundle.ts";

export function serveCommand(options: any, folder: string) {
  const pagesPath = path.resolve(Deno.cwd(), folder);
  const hostname = options.hostname || "127.0.0.1";
  const port = options.port || 3000;

  console.log(
    "Going to start SilverBullet binding to",
    `${hostname}:${port}`,
  );
  console.log("Serving pages from", pagesPath);

  if (hostname === "127.0.0.1") {
    console.log(
      `_Note:_ SilverBullet will only be available locally (via http://localhost:${port}), to allow outside connections, pass --host 0.0.0.0 as a flag.`,
    );
  }

  const httpServer = new HttpServer({
    hostname,
    port: port,
    pagesPath: pagesPath,
    clientAssetBundle: new AssetBundle(clientAssetBundle as AssetJson),
    plugAssetBundle: new AssetBundle(plugAssetBundle as AssetJson),
    user: options.user,
  });
  httpServer.start();
}
