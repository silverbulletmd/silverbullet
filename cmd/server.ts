import { path } from "../server/deps.ts";
import { HttpServer } from "../server/http_server.ts";
import assetBundle from "../dist/asset_bundle.json" assert { type: "json" };
import { AssetBundle, AssetJson } from "../plugos/asset_bundle/bundle.ts";

export function serveCommand(options: any, folder: string) {
  const pagesPath = path.resolve(Deno.cwd(), folder);
  const port = options.port || 3000;

  console.log(
    "Going to start Silver Bullet on port",
    port,
    "serving pages from",
    pagesPath,
  );

  const httpServer = new HttpServer({
    port: port,
    pagesPath: pagesPath,
    assetBundle: new AssetBundle(assetBundle as AssetJson),
    password: options.password,
  });
  httpServer.start().catch((e) => {
    console.error("HTTP Server error", e);
    Deno.exit(1);
  });
}
