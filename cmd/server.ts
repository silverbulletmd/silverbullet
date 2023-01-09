import { path } from "../server/deps.ts";
import { HttpServer } from "../server/http_server.ts";
import assetBundle from "../dist/asset_bundle.json" assert { type: "json" };
import { AssetBundle, AssetJson } from "../plugos/asset_bundle/bundle.ts";
import { TrashSpacePrimitives } from "../common/spaces/trash_space_primitives.ts";
import { SpaceSync } from "../common/spaces/sync.ts";
import { HttpSpacePrimitives } from "../common/spaces/http_space_primitives.ts";

export function serveCommand(options: any, folder: string) {
  const pagesPath = path.resolve(Deno.cwd(), folder);
  const hostname = options.hostname || "127.0.0.1";
  const port = options.port || 3000;
  console.log("Options", options);
  const syncUrl: string | undefined = options.sync;
  const bareMode = options.bare;

  console.log(
    "Going to start Silver Bullet binding to",
    `${hostname}:${port}`,
  );
  console.log("Serving pages from", pagesPath);

  if (hostname === "127.0.0.1") {
    console.log(
      `_Note:_ Silver Bullet will only be available locally (via http://localhost:${port}), to allow outside connections, pass --host 0.0.0.0 as a flag.`,
    );
  }

  const httpServer = new HttpServer({
    hostname,
    port: port,
    pagesPath: pagesPath,
    dbPath: path.join(pagesPath, options.db),
    assetBundle: new AssetBundle(assetBundle as AssetJson),
    user: options.user,
    bareMode,
  });
  httpServer.start().catch((e) => {
    console.error("HTTP Server error", e);
    Deno.exit(1);
  });

  if (syncUrl) {
    console.log("Starting sync");
    const syncSpace = new TrashSpacePrimitives(
      new HttpSpacePrimitives(syncUrl),
      "_trash",
    );
    let localTimestamp = 0, remoteTimestamp = 0;
    try {
      [localTimestamp, remoteTimestamp] = JSON.parse(
        Deno.readTextFileSync("sync.json"),
      );
    } catch {
      console.log("No old sync timestamp found");
    }
    const spaceSync = new SpaceSync(
      httpServer.systemBoot.spacePrimitives,
      syncSpace,
      localTimestamp,
      remoteTimestamp,
    );

    setInterval(() => {
      console.log("Initiating sync");
      spaceSync.syncFiles(
        SpaceSync.primaryConflictResolver(
          httpServer.systemBoot.spacePrimitives,
          syncSpace,
        ),
      ).then((r) => {
        console.log("Sync results", r);
        Deno.writeTextFileSync(
          "sync.json",
          JSON.stringify([
            spaceSync.primaryLastSync,
            spaceSync.secondaryLastSync,
          ]),
        );
      }).catch((e) => {
        console.error("Sync error", e);
      });
    }, 5000);
  }
}
