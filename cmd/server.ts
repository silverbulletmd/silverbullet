import { HttpServer } from "../server/http_server.ts";
import clientAssetBundle from "../dist/client_asset_bundle.json" assert {
  type: "json",
};
import plugAssetBundle from "../dist/plug_asset_bundle.json" assert {
  type: "json",
};
import { AssetBundle, AssetJson } from "../plugos/asset_bundle/bundle.ts";
import { sleep } from "$sb/lib/async.ts";

import { determineDatabaseBackend } from "../server/db_backend.ts";
import { SpaceServerConfig } from "../server/instance.ts";

export async function serveCommand(
  options: {
    hostname?: string;
    port?: number;
    user?: string;
    auth?: string;
    cert?: string;
    key?: string;
    reindex?: boolean;
    syncOnly?: boolean;
    clientEncryption?: boolean;
  },
  folder?: string,
) {
  const hostname = options.hostname || Deno.env.get("SB_HOSTNAME") ||
    "127.0.0.1";
  const port = options.port ||
    (Deno.env.get("SB_PORT") && +Deno.env.get("SB_PORT")!) || 3000;

  const clientEncryption = options.clientEncryption ||
    !!Deno.env.get("SB_CLIENT_ENCRYPTION");

  if (clientEncryption) {
    console.log(
      "Running in client encryption mode, this will implicitly enable sync-only mode",
    );
  }

  const syncOnly = options.syncOnly || !!Deno.env.get("SB_SYNC_ONLY");

  if (syncOnly) {
    console.log("Running in sync-only mode (no backend processing)");
  }

  if (!folder) {
    // Didn't get a folder as an argument, check if we got it as an environment variable
    folder = Deno.env.get("SB_FOLDER");
    if (!folder) {
      console.error(
        "No folder specified. Please pass a folder as an argument or set SB_FOLDER environment variable.",
      );
      Deno.exit(1);
    }
  }

  const baseKvPrimitives = await determineDatabaseBackend(folder);

  console.log(
    "Going to start SilverBullet binding to",
    `${hostname}:${port}`,
  );
  if (hostname === "127.0.0.1") {
    console.info(
      `SilverBullet will only be available locally, to allow outside connections, pass -L0.0.0.0 as a flag, and put a TLS terminator on top.`,
    );
  }

  const userAuth = options.user ?? Deno.env.get("SB_USER");

  let userCredentials: { user: string; pass: string } | undefined;
  if (userAuth) {
    const [user, pass] = userAuth.split(":");
    userCredentials = { user, pass };
  }
  const configs = new Map<string, SpaceServerConfig>();
  configs.set("*", {
    hostname,
    namespace: "*",
    auth: userCredentials,
    authToken: Deno.env.get("SB_AUTH_TOKEN"),
    syncOnly,
    clientEncryption,
    pagesPath: folder,
  });

  const httpServer = new HttpServer({
    hostname,
    port,
    clientAssetBundle: new AssetBundle(clientAssetBundle as AssetJson),
    plugAssetBundle: new AssetBundle(plugAssetBundle as AssetJson),
    baseKvPrimitives,
    keyFile: options.key,
    certFile: options.cert,
    configs,
  });
  httpServer.start();

  // Wait in an infinite loop (to keep the HTTP server running, only cancelable via Ctrl+C or other signal)
  while (true) {
    await sleep(10000);
  }
}
