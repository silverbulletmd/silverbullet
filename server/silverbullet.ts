import { Command } from "https://deno.land/x/cliffy@v0.25.2/command/command.ts";

import * as path from "https://deno.land/std@0.158.0/path/mod.ts";
import { HttpServer } from "./http_server.ts";
import assetBundle from "../dist/asset_bundle.json" assert { type: "json" };
import { AssetBundle, AssetJson } from "../plugos/asset_bundle/bundle.ts";

await new Command()
  .name("silverbullet")
  .description("Markdown as a platform")
  // Main command
  .arguments("<folder:string>")
  .option("-p, --port <port:number>", "Port to listen on")
  .option("--password <password:string>", "Password for basic authentication")
  .action((options, folder) => {
    const pagesPath = path.resolve(Deno.cwd(), folder);
    const port = options.port || 3000;

    console.log("Pages folder:", pagesPath);

    const httpServer = new HttpServer({
      port: port,
      pagesPath: pagesPath,
      assetBundle: new AssetBundle(assetBundle as AssetJson),
      password: options.password,
    });
    httpServer.start().catch((e) => {
      console.error(e);
    });
  })
  // Upgrade command
  .command("upgrade", "Upgrade Silver Bullet")
  .action(async () => {
    console.log("Attempting upgrade...");
    const p = Deno.run({
      cmd: ["deno", "cache", "--reload", Deno.mainModule],
    });
    const exitCode = await p.status();
    if (exitCode.success) {
      console.log("Upgrade succeeded");
    } else {
      console.error("Upgrade failed");
    }
  })
  .parse(Deno.args);
