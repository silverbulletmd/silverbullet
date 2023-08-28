import { Application, path } from "../server/deps.ts";
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
import { Authenticator } from "../server/auth.ts";
import { JSONKVStore } from "../plugos/lib/kv_store.json_file.ts";
import { sleep } from "../common/async_util.ts";
import { ServerSystem } from "../server/server_system.ts";
import { SilverBulletHooks } from "../common/manifest.ts";
import { System } from "../plugos/system.ts";

export async function serveCommand(
  options: {
    hostname?: string;
    port?: number;
    user?: string;
    auth?: string;
    cert?: string;
    key?: string;
    // Thin client mode
    thinClient?: boolean;
    reindex?: boolean;
    db?: string;
  },
  folder?: string,
) {
  const hostname = options.hostname || Deno.env.get("SB_HOSTNAME") ||
    "127.0.0.1";
  const port = options.port ||
    (Deno.env.get("SB_PORT") && +Deno.env.get("SB_PORT")!) || 3000;

  const thinClientMode = options.thinClient || Deno.env.has("SB_THIN_CLIENT");
  let dbFile = options.db || Deno.env.get("SB_DB_FILE") || ".silverbullet.db";

  const app = new Application();

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
    folder = Deno.cwd();
  } else {
    // Regular disk mode
    folder = path.resolve(Deno.cwd(), folder);
    spacePrimitives = new DiskSpacePrimitives(folder);
  }

  spacePrimitives = new AssetBundlePlugSpacePrimitives(
    spacePrimitives,
    new AssetBundle(plugAssetBundle as AssetJson),
  );

  let system: System<SilverBulletHooks> | undefined;
  if (thinClientMode) {
    dbFile = path.resolve(folder, dbFile);
    console.log(`Running in thin client mode, keeping state in ${dbFile}`);
    const serverSystem = new ServerSystem(spacePrimitives, dbFile, app);
    await serverSystem.init();
    spacePrimitives = serverSystem.spacePrimitives;
    system = serverSystem.system;
    if (options.reindex) {
      console.log("Reindexing space (requested via --reindex flag)");
      await serverSystem.system.loadedPlugs.get("index")!.invoke(
        "reindexSpace",
        [],
      );
    }
  }

  const authStore = new JSONKVStore();
  const authenticator = new Authenticator(authStore);

  const flagUser = options.user ?? Deno.env.get("SB_USER");
  if (flagUser) {
    // If explicitly added via env/parameter, add on the fly
    const [username, password] = flagUser.split(":");
    await authenticator.register(username, password, ["admin"], "");
  }

  if (options.auth) {
    // Load auth file
    const authFile: string = options.auth;
    console.log("Loading authentication credentials from", authFile);
    await authStore.load(authFile);
    (async () => {
      // Asynchronously kick off file watcher
      for await (const _event of Deno.watchFs(options.auth!)) {
        console.log("Authentication file changed, reloading...");
        await authStore.load(authFile);
      }
    })().catch(console.error);
  }

  const envAuth = Deno.env.get("SB_AUTH");
  if (envAuth) {
    console.log("Loading authentication from SB_AUTH");
    authStore.loadString(envAuth);
  }

  const httpServer = new HttpServer(spacePrimitives!, app, system, {
    hostname,
    port: port,
    pagesPath: folder!,
    clientAssetBundle: new AssetBundle(clientAssetBundle as AssetJson),
    authenticator,
    keyFile: options.key,
    certFile: options.cert,
  });
  await httpServer.start();

  // Wait in an infinite loop (to keep the HTTP server running, only cancelable via Ctrl+C or other signal)
  while (true) {
    await sleep(10000);
  }
}
